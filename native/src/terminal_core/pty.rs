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
    pub(crate) fn command_in_directory(
        program: &str,
        args: &[String],
        cwd: Option<&str>,
        size: GridSize,
    ) -> Result<Self> {
        let mut command = CommandBuilder::new(program);
        if let Some(cwd) = cwd {
            command.cwd(cwd);
        }
        command.args(args);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        Self::spawn(command, size, program.to_owned())
    }
    fn spawn(command: CommandBuilder, size: GridSize, shell: String) -> Result<Self> {
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
        let grid = Arc::new(Mutex::new(TerminalGrid::new(size, tx.clone())));
        let exited = Arc::new(AtomicBool::new(false));
        let error: Arc<Mutex<Option<PtyError>>> = Arc::new(Mutex::new(None));
        let session = Self {
            grid: grid.clone(),
            master: Mutex::new(Some(pair.master)),
            child: Mutex::new(Some(child)),
            input: Mutex::new(Some(tx)),
            exited: exited.clone(),
            error: error.clone(),
            shell,
        };
        let write_error = error.clone();
        let write_exited = exited.clone();
        thread::Builder::new()
            .name("terminal-pty-writer".into())
            .spawn(move || {
                while !write_exited.load(Ordering::Acquire) {
                    let bytes = match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                        Ok(bytes) => bytes,
                        Err(mpsc::RecvTimeoutError::Timeout) => continue,
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
                        Ok(count) => grid.lock().unwrap().advance(&buffer[..count]),
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
        self.input
            .lock()
            .unwrap()
            .as_ref()
            .context("Terminal is closed")?
            .send(bytes)
            .context("Send PTY input")
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
        self.input
            .lock()
            .unwrap()
            .as_ref()
            .context("Terminal has exited")?
            .send(bytes)
            .context("Write terminal mouse input")
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
            if let Some(master) = self.master.lock().unwrap().as_ref() {
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
        if let Some(mut child) = self.child.lock().unwrap().take() {
            // portable-pty's Unix kill waits briefly after SIGHUP. Keep both it and
            // reaping outside the UI thread when closing a tab.
            thread::spawn(move || {
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
        self.close();
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
