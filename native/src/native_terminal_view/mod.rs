//! Platform-independent Lynx terminal element lifecycle and session binding.
mod state;
mod view;

use std::{
    cell::{Cell, RefCell},
    sync::Arc,
};

use crate::{
    binding::native_view::{AttachedTarget, Handle, Target},
    platform::TerminalPlatform,
};

use crate::{
    renderer::{DrawState, Renderer},
    terminal_content::TerminalContent,
};
use state::State;

pub(crate) struct NativeTerminalView {
    attached_element: Arc<AttachedTarget<Self>>,
    target: Target<Self>,
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
