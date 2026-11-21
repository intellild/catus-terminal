//! Platform-independent Lynx terminal element lifecycle and session binding.
mod state;
mod view;

use std::{
    cell::{Cell, RefCell},
    sync::Arc,
};
use tokio::task::JoinHandle;

use crate::{
    binding::native_view::Handle,
    platform::TerminalPlatform,
    renderer::{DrawState, Renderer},
    terminal_content::TerminalContent,
};
use state::State;

pub(crate) struct NativeTerminalView {
    resume_task: Cell<Option<JoinHandle<()>>>,
    handle: Handle,
    platform: Box<TerminalPlatform>,
    renderer: Arc<Renderer>,
    content: RefCell<Option<TerminalContent>>,
    viewport: Cell<Option<crate::frame::Viewport>>,
    cells: Cell<Option<crate::frame::CellLayout>>,
    drawing: RefCell<DrawState>,
    pub(crate) mouse: RefCell<crate::platform::MouseState>,
    repaint: Cell<bool>,
    state: RefCell<State>,
}
