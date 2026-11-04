use std::time::Instant;

use crate::{frame::Viewport, terminal_session::TerminalHandle, terminal_view::NativeScrollState};

pub(super) struct State {
    pub(super) terminal: Option<Box<TerminalHandle>>,
    pub(super) id: u32,
    pub(super) last_scroll: Option<(u32, NativeScrollState)>,
    pub(super) viewport: Viewport,
    pub(super) attached: bool,
    pub(super) needs_focus: bool,
    pub(super) focus_pending: bool,
    pub(super) renderer_retry: Option<Instant>,
    pub(super) error: String,
}
impl Default for State {
    fn default() -> Self {
        Self {
            terminal: None,
            id: 0,
            last_scroll: None,
            viewport: Viewport {
                width: 0,
                height: 0,
                pixel_ratio: 1.,
            },
            attached: false,
            needs_focus: true,
            focus_pending: false,
            renderer_retry: None,
            error: String::new(),
        }
    }
}
