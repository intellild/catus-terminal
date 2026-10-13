//! PTY transport. Blocking I/O and VT parsing run outside the Lynx/UI threads.
use super::grid::{GridSize, GridSnapshot, TerminalGrid};
use anyhow::{Context, Result, anyhow};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::{
    io::{Read, Write},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
};

type PtyError = Arc<dyn std::error::Error + Send + Sync>;

pub struct TerminalSession {
    grid: Arc<Mutex<TerminalGrid>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
    input: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    exited: Arc<AtomicBool>,
    error: Arc<Mutex<Option<PtyError>>>,
    pub(super) tmux: Option<Arc<Mutex<super::tmux::TmuxClient>>>,
    pub shell: String,
}
impl TerminalSession {
    pub fn default_shell(size: GridSize) -> Result<Self> {
        let (mut command, shell) = crate::platform::default_shell_command();
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        Self::spawn(command, size, shell)
    }
    #[cfg(test)]
    pub(crate) fn command(program: &str, args: &[String], size: GridSize) -> Result<Self> {
        Self::command_in_directory(program, args, None, size)
    }
    #[cfg(test)]
    pub(crate) fn command_in_directory(
        program: &str,
        args: &[String],
        cwd: Option<&str>,
        size: GridSize,
    ) -> Result<Self> {
        Self::command_with_tmux(program, args, cwd, size, None)
    }
    pub(crate) fn command_with_tmux(
        program: &str,
        args: &[String],
        cwd: Option<&str>,
        size: GridSize,
        tmux: Option<super::tmux::TmuxOptions>,
    ) -> Result<Self> {
        let mut command = CommandBuilder::new(program);
        if let Some(cwd) = cwd {
            command.cwd(cwd);
        }
        command.args(args);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        if tmux.is_some() {
            command.env_remove("TMUX");
        }
        Self::spawn_transport(command, size, program.to_owned(), tmux)
    }
    fn spawn(command: CommandBuilder, size: GridSize, shell: String) -> Result<Self> {
        Self::spawn_transport(command, size, shell, None)
    }
    fn spawn_transport(
        command: CommandBuilder,
        size: GridSize,
        shell: String,
        tmux: Option<super::tmux::TmuxOptions>,
    ) -> Result<Self> {
        let pair = native_pty_system()
            .openpty(pty_size(size))
            .context("Open terminal PTY")?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .context("Create PTY reader")?;
        let mut writer = pair.master.take_writer().context("Create PTY writer")?;
        let child = pair
            .slave
            .spawn_command(command)
            .with_context(|| format!("Spawn terminal process {shell}"))?;
        drop(pair.slave);
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let tmux =
            tmux.map(|options| Arc::new(Mutex::new(super::tmux::TmuxClient::new(options, size))));
        // tmux's own VT parser answers terminal queries. A second answer from our
        // rendering grid would be injected as user input into the pane.
        let replies = if tmux.is_some() {
            mpsc::channel().0
        } else {
            tx.clone()
        };
        let grid = Arc::new(Mutex::new(TerminalGrid::new(size, replies)));
        let exited = Arc::new(AtomicBool::new(false));
        let error: Arc<Mutex<Option<PtyError>>> = Arc::new(Mutex::new(None));
        let session = Self {
            grid: grid.clone(),
            master: Mutex::new(Some(pair.master)),
            child: Mutex::new(Some(child)),
            input: Mutex::new(Some(tx.clone())),
            exited: exited.clone(),
            error: error.clone(),
            tmux: tmux.clone(),
            shell,
        };
        let write_error = error.clone();
        let write_exited = exited.clone();
        thread::Builder::new()
            .name("terminal-pty-writer".into())
            .spawn(move || {
                loop {
                    let bytes = match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                        Ok(bytes) => bytes,
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            if write_exited.load(Ordering::Acquire) {
                                break;
                            }
                            continue;
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    };
                    if let Err(err) = writer.write_all(&bytes).and_then(|()| writer.flush()) {
                        *write_error.lock().unwrap() = Some(
                            anyhow::Error::new(err)
                                .context("Write PTY input")
                                .into_boxed_dyn_error()
                                .into(),
                        );
                        break;
                    }
                }
            })
            .context("Start PTY writer thread")?;
        thread::Builder::new()
            .name("terminal-pty-reader".into())
            .spawn(move || {
                let mut buffer = [0; 16384];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(count) => {
                            let mut grid = grid.lock().unwrap();
                            if let Some(tmux) = &tmux {
                                if let Err(err) =
                                    tmux.lock()
                                        .unwrap()
                                        .advance(&buffer[..count], &mut grid, &tx)
                                {
                                    *error.lock().unwrap() = Some(
                                        err.context("Read tmux control output")
                                            .into_boxed_dyn_error()
                                            .into(),
                                    );
                                    break;
                                }
                            } else {
                                grid.advance(&buffer[..count]);
                            }
                        }
                        Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
                        Err(err) if crate::platform::pty_reader_closed(&err) => break,
                        Err(err) => {
                            *error.lock().unwrap() = Some(
                                anyhow::Error::new(err)
                                    .context("Read PTY output")
                                    .into_boxed_dyn_error()
                                    .into(),
                            );
                            break;
                        }
                    }
                }
                exited.store(true, Ordering::Release);
            })
            .context("Start PTY reader thread")?;
        Ok(session)
    }
    pub fn write(&self, bytes: Vec<u8>) -> Result<()> {
        if self.exited() {
            return Err(anyhow!("Shell has exited"));
        }
        self.grid.lock().unwrap().clear_interaction();
        self.send_input(bytes)
    }
    fn send_input(&self, bytes: Vec<u8>) -> Result<()> {
        let input = self.input.lock().unwrap();
        let tx = input.as_ref().context("Terminal is closed")?;
        if let Some(tmux) = &self.tmux {
            tmux.lock().unwrap().input(bytes, tx)
        } else {
            tx.send(bytes).context("Send PTY input")
        }
    }
    #[cfg(feature = "native-view")]
    pub(crate) fn try_scroll_state(&self) -> Result<Option<super::grid::ScrollState>> {
        self.try_grid(|grid| grid.scroll_state())
    }
    pub fn scroll_to(&self, offset: usize) {
        self.grid.lock().unwrap().scroll_to(offset);
    }
    pub fn scroll_multiplier(&self, modifiers: super::grid::MouseModifiers) -> f64 {
        self.grid.lock().unwrap().scroll_multiplier(modifiers)
    }
    pub fn selected_text(&self) -> Option<String> {
        self.grid.lock().unwrap().selected_text()
    }
    #[allow(clippy::too_many_arguments)]
    pub fn pointer(
        &self,
        action: super::grid::PointerAction,
        row: usize,
        column: usize,
        right_half: bool,
        clicks: u8,
        button: u8,
        modifiers: super::grid::MouseModifiers,
    ) -> Result<()> {
        let bytes = self
            .grid
            .lock()
            .unwrap()
            .pointer(action, row, column, right_half, clicks, button, modifiers);
        if let Some(bytes) = bytes {
            self.write_mouse(bytes)?;
        }
        Ok(())
    }
    pub fn scroll(
        &self,
        lines: i32,
        row: usize,
        column: usize,
        modifiers: super::grid::MouseModifiers,
    ) -> Result<()> {
        let bytes = self
            .grid
            .lock()
            .unwrap()
            .scroll(lines, row, column, modifiers);
        if let Some(bytes) = bytes {
            self.write_mouse(bytes)?;
        }
        Ok(())
    }
    fn write_mouse(&self, bytes: Vec<u8>) -> Result<()> {
        self.send_input(bytes)
    }

    pub fn paste(&self, text: &str) -> Result<()> {
        let bytes = self.grid.lock().unwrap().paste(text);
        self.write(bytes)
    }
    pub fn key(&self, key: &str, control: bool, alt: bool) -> Result<()> {
        let bytes = self.grid.lock().unwrap().key(key, control, alt);
        if let Some(bytes) = bytes {
            self.write(bytes)?;
        }
        Ok(())
    }
    pub fn resize(&self, size: GridSize) -> Result<()> {
        let mut grid = self.grid.lock().unwrap();
        if grid.size() != size {
            if let Some(tmux) = &self.tmux {
                if let Some(tx) = self.input.lock().unwrap().as_ref() {
                    tmux.lock().unwrap().resize(size, tx)?;
                }
            } else if let Some(master) = self.master.lock().unwrap().as_ref() {
                master
                    .resize(pty_size(size))
                    .context("Resize terminal PTY")?;
            }
            grid.resize(size);
        }
        Ok(())
    }
    pub fn size(&self) -> GridSize {
        self.grid.lock().unwrap().size()
    }
    pub fn snapshot(&self) -> GridSnapshot {
        self.grid.lock().unwrap().snapshot()
    }
    #[cfg(feature = "native-view")]
    pub(crate) fn try_snapshot(&self) -> Result<Option<GridSnapshot>> {
        self.try_grid(|grid| grid.snapshot())
    }
    #[cfg(feature = "native-view")]
    pub(crate) fn try_revision(&self) -> Result<Option<u64>> {
        self.try_grid(|grid| grid.revision())
    }
    #[cfg(feature = "native-view")]
    fn try_grid<T>(&self, read: impl FnOnce(&TerminalGrid) -> T) -> Result<Option<T>> {
        match self.grid.try_lock() {
            Ok(grid) => Ok(Some(read(&grid))),
            Err(std::sync::TryLockError::WouldBlock) => Ok(None),
            Err(std::sync::TryLockError::Poisoned(_)) => {
                Err(anyhow!("Terminal grid lock poisoned"))
            }
        }
    }
    pub fn revision(&self) -> u64 {
        self.grid.lock().unwrap().revision()
    }
    pub fn exited(&self) -> bool {
        let mut child = self.child.lock().unwrap();
        if let Some(child) = child.as_mut()
            && matches!(child.try_wait(), Ok(Some(_)))
        {
            self.exited.store(true, Ordering::Release);
        }
        self.exited.load(Ordering::Acquire)
    }
    pub fn error(&self) -> Option<anyhow::Error> {
        self.error
            .lock()
            .unwrap()
            .as_ref()
            .map(|error| anyhow::Error::new(error.clone()))
    }
    pub fn close(&self) {
        self.close_transport(false);
    }
    pub fn detach(&self) {
        self.close_transport(true);
    }
    fn close_transport(&self, preserve: bool) {
        if let Some(tmux) = &self.tmux
            && let Some(tx) = self.input.lock().unwrap().as_ref()
        {
            tmux.lock().unwrap().close(preserve, tx);
        }
        if let Some(mut child) = self.child.lock().unwrap().take() {
            // portable-pty's Unix kill waits briefly after SIGHUP. Keep both it and
            // reaping outside the UI thread when closing a tab.
            let control = self.tmux.is_some();
            thread::spawn(move || {
                if control {
                    // Let the writer deliver kill-window/detach-client before
                    // terminating the control connection (including SSH).
                    for _ in 0..50 {
                        if matches!(child.try_wait(), Ok(Some(_))) {
                            return;
                        }
                        thread::sleep(std::time::Duration::from_millis(10));
                    }
                }
                let _ = child.kill();
                let _ = child.wait();
            });
        }
        self.input.lock().unwrap().take();
        self.master.lock().unwrap().take();
        self.exited.store(true, Ordering::Release);
    }
}
impl Drop for TerminalSession {
    fn drop(&mut self) {
        self.detach();
    }
}
fn pty_size(size: GridSize) -> PtySize {
    PtySize {
        rows: size.rows as u16,
        cols: size.columns as u16,
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[cfg(test)]
#[path = "../tests/terminal_pty.rs"]
mod tests;
