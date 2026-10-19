//! Terminal computation and interaction, independent of transport protocol and rendering.
use super::{
    grid::{GridSize, GridSnapshot, TerminalGrid},
    pty::{PlainPtyDelegate, Pty, PtyDelegate},
    tmux::TmuxSessionInfo,
};
use anyhow::{Result, anyhow};
use portable_pty::CommandBuilder;
#[cfg(test)]
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

pub struct TerminalSession {
    grid: Arc<Mutex<TerminalGrid>>,
    pty: Pty,
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
        Self::command_with_delegate(program, args, cwd, size, Arc::new(PlainPtyDelegate))
    }
    pub(crate) fn command_with_delegate(
        program: &str,
        args: &[String],
        cwd: Option<&str>,
        size: GridSize,
        delegate: Arc<dyn PtyDelegate>,
    ) -> Result<Self> {
        let mut command = CommandBuilder::new(program);
        if let Some(cwd) = cwd {
            command.cwd(cwd);
        }
        command.args(args);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        Self::spawn_with_delegate(command, size, program.to_owned(), delegate)
    }
    fn spawn(command: CommandBuilder, size: GridSize, shell: String) -> Result<Self> {
        Self::spawn_with_delegate(command, size, shell, Arc::new(PlainPtyDelegate))
    }
    fn spawn_with_delegate(
        command: CommandBuilder,
        size: GridSize,
        shell: String,
        delegate: Arc<dyn PtyDelegate>,
    ) -> Result<Self> {
        let (pty, grid) = Pty::spawn(command, size, shell.clone(), delegate)?;
        Ok(Self { grid, pty, shell })
    }
    pub fn write(&self, bytes: Vec<u8>) -> Result<()> {
        if self.exited() {
            return Err(anyhow!("Shell has exited"));
        }
        self.grid.lock().unwrap().clear_interaction();
        self.send_input(bytes)
    }
    fn send_input(&self, bytes: Vec<u8>) -> Result<()> {
        self.pty.write(bytes)
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
            self.pty.resize(size)?;
            grid.resize(size);
        }
        Ok(())
    }
    pub fn tmux_info(&self) -> Option<TmuxSessionInfo> {
        self.pty.tmux_info()
    }
    pub fn select_tmux_window(&self, window_id: &str) -> Result<bool> {
        self.pty.select_tmux_window(window_id)
    }
    pub fn create_tmux_window(&self) -> Result<bool> {
        self.pty.create_tmux_window()
    }
    pub fn close_tmux_window(&self, window_id: &str) -> Result<bool> {
        self.pty.close_tmux_window(window_id)
    }
    #[cfg(test)]
    pub(crate) fn ready(&self) -> bool {
        self.pty.ready()
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
        self.pty.exited()
    }
    pub fn error(&self) -> Option<anyhow::Error> {
        self.pty.error()
    }
    pub fn close(&self) {
        self.pty.close();
    }
    pub fn detach(&self) {
        self.pty.detach();
    }
}

#[cfg(test)]
#[path = "../tests/terminal_pty.rs"]
mod tests;
