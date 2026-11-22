//! Terminal session ownership, input handling and renderer binding.
use super::{
    grid::{GridSize, GridSnapshot, TerminalGrid},
    pty::{PlainPtyDelegate, Pty, PtyDelegate, WriterSender, block_on},
    tmux::TmuxSessionInfo,
};
use anyhow::{Result, anyhow};
use portable_pty::{CommandBuilder, PtySize};
use std::sync::Arc;
use tokio::sync::Mutex;
#[cfg(feature = "native-view")]
use {crate::renderer::Renderer, arc_swap::ArcSwapWeak, std::sync::Weak, tokio::sync::MutexGuard};

pub struct TerminalSession {
    grid: Mutex<TerminalGrid>,
    #[cfg(feature = "native-view")]
    renderer: ArcSwapWeak<Renderer>,
    pub(super) pty: Pty,
    pub shell: String,
}
impl TerminalSession {
    pub fn default_shell(size: GridSize) -> Result<Arc<Self>> {
        let (mut command, shell) = crate::platform::default_shell_command();
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        Self::spawn(command, size, shell)
    }
    pub(crate) fn command_in_directory(
        program: &str,
        args: &[String],
        cwd: Option<&str>,
        size: GridSize,
    ) -> Result<Arc<Self>> {
        Self::command_with_delegate(program, args, cwd, size, Arc::new(PlainPtyDelegate))
    }
    pub(crate) fn command_with_delegate(
        program: &str,
        args: &[String],
        cwd: Option<&str>,
        size: GridSize,
        delegate: Arc<dyn PtyDelegate>,
    ) -> Result<Arc<Self>> {
        let mut command = CommandBuilder::new(program);
        if let Some(cwd) = cwd {
            command.cwd(cwd);
        }
        command.args(args);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        Self::spawn_with_delegate(command, size, program.to_owned(), delegate)
    }
    fn spawn(command: CommandBuilder, size: GridSize, shell: String) -> Result<Arc<Self>> {
        Self::spawn_with_delegate(command, size, shell, Arc::new(PlainPtyDelegate))
    }
    fn spawn_with_delegate(
        command: CommandBuilder,
        size: GridSize,
        shell: String,
        delegate: Arc<dyn PtyDelegate>,
    ) -> Result<Arc<Self>> {
        let (pty, grid, output) = Pty::spawn(command, size, &shell, delegate)?;
        let session = Arc::new(Self {
            grid: Mutex::new(grid),
            pty,
            shell,
            #[cfg(feature = "native-view")]
            renderer: ArcSwapWeak::default(),
        });
        session.pty.start_parser(Arc::downgrade(&session), output);
        Ok(session)
    }

    pub(super) async fn process_output(&self, bytes: &[u8], writer: &WriterSender) -> Result<()> {
        let mut grid = self.grid.lock().await;
        #[cfg(feature = "native-view")]
        let revision = grid.revision();
        let result = self.pty.advance(bytes, &mut grid, writer).await;
        #[cfg(feature = "native-view")]
        self.schedule_render_if_changed(grid, revision);
        result
    }

    pub fn write(&self, bytes: Vec<u8>) -> Result<()> {
        if self.exited() {
            return Err(anyhow!("Shell has exited"));
        }
        self.update_grid(TerminalGrid::clear_interaction);
        self.send_input(bytes)
    }
    fn send_input(&self, bytes: Vec<u8>) -> Result<()> {
        block_on(self.pty.write(bytes))
    }
    #[cfg(feature = "native-view")]
    pub(crate) fn scroll_state(&self) -> Result<super::grid::ScrollState> {
        self.try_grid(|grid| grid.scroll_state())?
            .ok_or_else(|| anyhow!("Terminal grid busy"))
    }
    pub fn scroll_to(&self, offset: usize) {
        self.update_grid(|grid| grid.scroll_to(offset));
    }
    pub fn scroll_multiplier(&self, modifiers: super::grid::MouseModifiers) -> f64 {
        self.grid.blocking_lock().scroll_multiplier(modifiers)
    }
    pub fn selected_text(&self) -> Option<String> {
        self.grid.blocking_lock().selected_text()
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
        let bytes = self.update_grid(|grid| {
            grid.pointer(action, row, column, right_half, clicks, button, modifiers)
        });
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
        let bytes = self.update_grid(|grid| grid.scroll(lines, row, column, modifiers));
        if let Some(bytes) = bytes {
            self.write_mouse(bytes)?;
        }
        Ok(())
    }
    fn write_mouse(&self, bytes: Vec<u8>) -> Result<()> {
        self.send_input(bytes)
    }

    pub fn paste(&self, text: &str) -> Result<()> {
        let bytes = self.grid.blocking_lock().paste(text);
        self.write(bytes)
    }
    pub fn key(&self, key: &str, control: bool, alt: bool) -> Result<()> {
        let bytes = self.grid.blocking_lock().key(key, control, alt);
        if let Some(bytes) = bytes {
            self.write(bytes)?;
        }
        Ok(())
    }
    pub fn resize(&self, size: GridSize) -> Result<()> {
        self.pty.resize_and_wait(size.into())
    }
    #[cfg(feature = "native-view")]
    pub(crate) fn try_resize_with_pixels(
        &self,
        size: GridSize,
        pixel_width: u16,
        pixel_height: u16,
    ) -> Result<bool> {
        self.pty.try_resize(PtySize {
            pixel_width,
            pixel_height,
            ..size.into()
        })
    }

    pub(super) async fn apply_resize(&self, window: PtySize, running: bool) -> Result<()> {
        let size = GridSize::new(window.cols.into(), window.rows.into());
        // Only the parser changes the grid dimensions.
        let changed = self.grid.lock().await.size() != size;
        if running {
            self.pty.resize(window, changed.then_some(size)).await?;
        }
        if changed {
            self.grid.lock().await.resize(size);
            #[cfg(feature = "native-view")]
            self.schedule_render();
        }
        Ok(())
    }
    pub fn tmux_info(&self) -> Option<TmuxSessionInfo> {
        block_on(self.pty.tmux_info())
    }
    pub fn select_tmux_window(&self, window_id: &str) -> Result<bool> {
        block_on(self.pty.select_tmux_window(window_id))
    }
    pub fn create_tmux_window(&self) -> Result<bool> {
        block_on(self.pty.create_tmux_window())
    }
    pub fn close_tmux_window(&self, window_id: &str) -> Result<bool> {
        block_on(self.pty.close_tmux_window(window_id))
    }
    pub fn size(&self) -> GridSize {
        self.grid.blocking_lock().size()
    }
    pub fn snapshot(&self) -> GridSnapshot {
        self.grid.blocking_lock().snapshot()
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
            Err(_) => Ok(None),
        }
    }
    pub fn revision(&self) -> u64 {
        self.grid.blocking_lock().revision()
    }

    fn update_grid<T>(&self, update: impl FnOnce(&mut TerminalGrid) -> T) -> T {
        let mut grid = self.grid.blocking_lock();
        #[cfg(feature = "native-view")]
        let revision = grid.revision();
        let result = update(&mut grid);
        #[cfg(feature = "native-view")]
        self.schedule_render_if_changed(grid, revision);
        result
    }

    #[cfg(feature = "native-view")]
    fn schedule_render_if_changed(
        &self,
        grid: MutexGuard<'_, TerminalGrid>,
        previous_revision: u64,
    ) {
        if grid.revision() == previous_revision {
            return;
        }
        drop(grid);
        self.schedule_render();
    }

    #[cfg(feature = "native-view")]
    fn schedule_render(&self) {
        if let Some(renderer) = self.renderer.load().upgrade() {
            renderer.schedule_render();
        }
    }

    #[cfg(feature = "native-view")]
    pub(crate) fn attach(&self, renderer: Weak<Renderer>) {
        self.renderer.store(renderer);
    }

    #[cfg(feature = "native-view")]
    pub(crate) fn detach(&self, renderer: &Weak<Renderer>) {
        self.renderer.compare_and_swap(renderer, Weak::new());
    }
    pub fn exited(&self) -> bool {
        self.pty.exited()
    }
    pub fn error(&self) -> Option<anyhow::Error> {
        self.pty.error()
    }
    pub fn close(&self) {
        block_on(self.pty.close());
    }
    pub fn detach_pty(&self) {
        block_on(self.pty.detach());
    }
}
