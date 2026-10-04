//! PTY transport. Blocking I/O and VT parsing run outside the Lynx/UI threads.
use super::grid::{GridSize, GridSnapshot, TerminalGrid};
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

pub struct TerminalSession {
    grid: Arc<Mutex<TerminalGrid>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
    input: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    exited: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
    pub shell: String,
}
impl TerminalSession {
    pub fn default_shell(size: GridSize) -> Result<Self, String> {
        // Resolve the account's shell through portable-pty rather than workspace profiles.
        let mut defaults = CommandBuilder::new_default_prog();
        defaults.env_remove("SHELL");
        let shell = defaults.get_shell();
        let mut command = CommandBuilder::new(&shell);
        command.args(["-l", "-i"]);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        if let Some(home) = std::env::var_os("HOME") {
            command.cwd(home);
        }
        Self::spawn(command, size, shell)
    }
    fn spawn(command: CommandBuilder, size: GridSize, shell: String) -> Result<Self, String> {
        let pair = native_pty_system()
            .openpty(pty_size(size))
            .map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| e.to_string())?;
        drop(pair.slave);
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let grid = Arc::new(Mutex::new(TerminalGrid::new(size, tx.clone())));
        let exited = Arc::new(AtomicBool::new(false));
        let error = Arc::new(Mutex::new(None));
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
                        *write_error.lock().unwrap() = Some(err.to_string());
                        break;
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        thread::Builder::new()
            .name("terminal-pty-reader".into())
            .spawn(move || {
                let mut buffer = [0; 16384];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(count) => grid.lock().unwrap().advance(&buffer[..count]),
                        Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
                        // A closed slave reports EIO on some Unix implementations.
                        Err(err) if err.raw_os_error() == Some(5) => break,
                        Err(err) => {
                            *error.lock().unwrap() = Some(err.to_string());
                            break;
                        }
                    }
                }
                exited.store(true, Ordering::Release);
            })
            .map_err(|e| e.to_string())?;
        Ok(session)
    }
    pub fn write(&self, bytes: Vec<u8>) -> Result<(), String> {
        if self.exited() {
            return Err("Shell has exited".into());
        }
        self.input
            .lock()
            .unwrap()
            .as_ref()
            .ok_or("Terminal is closed")?
            .send(bytes)
            .map_err(|e| e.to_string())
    }
    pub fn key(&self, key: &str, control: bool, alt: bool) -> Result<(), String> {
        let bytes = self.grid.lock().unwrap().key(key, control, alt);
        if let Some(bytes) = bytes {
            self.write(bytes)?;
        }
        Ok(())
    }
    pub fn resize(&self, size: GridSize) -> Result<(), String> {
        let mut grid = self.grid.lock().unwrap();
        if grid.size() != size {
            if let Some(master) = self.master.lock().unwrap().as_ref() {
                master.resize(pty_size(size)).map_err(|e| e.to_string())?;
            }
            grid.resize(size);
        }
        Ok(())
    }
    pub fn snapshot(&self) -> GridSnapshot {
        self.grid.lock().unwrap().snapshot()
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
    pub fn error(&self) -> Option<String> {
        self.error.lock().unwrap().clone()
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
