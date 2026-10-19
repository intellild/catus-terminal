//! Shared PTY ownership, blocking I/O threads, errors and child-process cleanup.
mod delegate;
mod plain;
mod tmux;
use super::grid::{GridSize, TerminalGrid};
use super::tmux::TmuxSessionInfo;
use anyhow::{Context, Result};
pub(crate) use delegate::PtyDelegate;
pub(crate) use plain::PlainPtyDelegate;
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
pub(crate) use tmux::TmuxPtyDelegate;

type PtyError = Arc<dyn std::error::Error + Send + Sync>;

pub(crate) struct Pty {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
    input: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    exited: Arc<AtomicBool>,
    error: Arc<Mutex<Option<PtyError>>>,
    delegate: Arc<dyn PtyDelegate>,
}
impl Pty {
    pub(super) fn spawn(
        mut command: CommandBuilder,
        size: GridSize,
        shell: String,
        delegate: Arc<dyn PtyDelegate>,
    ) -> Result<(Self, Arc<Mutex<TerminalGrid>>)> {
        delegate.configure_command(&mut command);
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
        // A backend that answers VT queries must not receive duplicate replies
        // from the local rendering grid as user input.
        let replies = if delegate.answers_queries() {
            mpsc::channel().0
        } else {
            tx.clone()
        };
        let grid = Arc::new(Mutex::new(TerminalGrid::new(size, replies)));
        let exited = Arc::new(AtomicBool::new(false));
        let error: Arc<Mutex<Option<PtyError>>> = Arc::new(Mutex::new(None));
        let session = Self {
            master: Mutex::new(Some(pair.master)),
            child: Mutex::new(Some(child)),
            input: Mutex::new(Some(tx.clone())),
            exited: exited.clone(),
            error: error.clone(),
            delegate: delegate.clone(),
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
        let read_grid = grid.clone();
        thread::Builder::new()
            .name("terminal-pty-reader".into())
            .spawn(move || {
                let mut buffer = [0; 16384];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(count) => {
                            let mut grid = read_grid.lock().unwrap();
                            if let Err(err) = delegate.advance(&buffer[..count], &mut grid, &tx) {
                                *error.lock().unwrap() = Some(
                                    err.context("Process terminal output")
                                        .into_boxed_dyn_error()
                                        .into(),
                                );
                                break;
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
        Ok((session, grid))
    }
    pub(super) fn write(&self, bytes: Vec<u8>) -> Result<()> {
        let input = self.input.lock().unwrap();
        let tx = input.as_ref().context("Terminal is closed")?;
        self.delegate.input(bytes, tx)
    }
    pub(super) fn resize(&self, size: GridSize) -> Result<()> {
        if let Some(tx) = self.input.lock().unwrap().as_ref() {
            let master = self.master.lock().unwrap();
            self.delegate.resize(size, master.as_deref(), tx)?;
        }
        Ok(())
    }
    pub(super) fn tmux_info(&self) -> Option<TmuxSessionInfo> {
        self.delegate.tmux_info()
    }
    pub(super) fn select_tmux_window(&self, window_id: &str) -> Result<bool> {
        let input = self.input.lock().unwrap();
        let tx = input.as_ref().context("Terminal is closed")?;
        self.delegate.select_tmux_window(window_id, tx)
    }
    pub(super) fn create_tmux_window(&self) -> Result<bool> {
        let input = self.input.lock().unwrap();
        let tx = input.as_ref().context("Terminal is closed")?;
        self.delegate.create_tmux_window(tx)
    }
    pub(super) fn close_tmux_window(&self, window_id: &str) -> Result<bool> {
        let input = self.input.lock().unwrap();
        let tx = input.as_ref().context("Terminal is closed")?;
        self.delegate.close_tmux_window(window_id, tx)
    }
    #[cfg(test)]
    pub(super) fn ready(&self) -> bool {
        self.delegate.ready()
    }
    #[cfg(test)]
    pub(super) fn recording(tx: mpsc::Sender<Vec<u8>>, delegate: Arc<dyn PtyDelegate>) -> Self {
        Self {
            master: Mutex::new(None),
            child: Mutex::new(None),
            input: Mutex::new(Some(tx)),
            exited: Arc::new(AtomicBool::new(false)),
            error: Arc::new(Mutex::new(None)),
            delegate,
        }
    }
    #[cfg(test)]
    pub(super) fn set_error(&self, error: PtyError) {
        *self.error.lock().unwrap() = Some(error);
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
        let grace = self
            .input
            .lock()
            .unwrap()
            .as_ref()
            .map(|tx| self.delegate.close(preserve, tx))
            .unwrap_or_default();
        if let Some(mut child) = self.child.lock().unwrap().take() {
            // portable-pty's Unix kill waits briefly after SIGHUP. Keep both it and
            // reaping outside the UI thread when closing a tab.
            thread::spawn(move || {
                let deadline = std::time::Instant::now() + grace;
                while std::time::Instant::now() < deadline {
                    if matches!(child.try_wait(), Ok(Some(_))) {
                        return;
                    }
                    thread::sleep(std::time::Duration::from_millis(10));
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
impl Drop for Pty {
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
#[path = "../tests/pty.rs"]
mod tests;
