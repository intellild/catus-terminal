use std::time::Instant;

use crate::terminal_core::grid::ScrollState;

pub(super) struct State {
    pub(super) id: u32,
    pub(super) last_scroll: Option<(u32, ScrollState)>,
    pub(super) attached: bool,
    pub(super) needs_focus: bool,
    pub(super) focus_pending: bool,
    pub(super) renderer_retry: Option<Instant>,
    pub(super) error: String,
}
impl Default for State {
    fn default() -> Self {
        Self {
            id: 0,
            last_scroll: None,
            attached: false,
            needs_focus: true,
            focus_pending: false,
            renderer_retry: None,
            error: String::new(),
        }
    }
}
