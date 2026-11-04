//! Platform-independent Lynx terminal element lifecycle and session binding.
mod host;
mod render_scheduler;
mod state;
mod view;

use std::{cell::RefCell, sync::Arc};

use crate::{binding::native_view::Handle, platform::TerminalPlatform};

use render_scheduler::RenderScheduler;
use state::State;

pub(crate) use host::TerminalHost;

pub(crate) struct NativeTerminalView {
    handle: Handle,
    platform: Box<TerminalPlatform>,
    frames: Arc<RenderScheduler>,
    notify: Arc<dyn Fn() + Send + Sync>,
    state: RefCell<State>,
}
