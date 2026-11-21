use std::time::Instant;
use tokio::sync::watch;

use crate::terminal_core::grid::ScrollState;

pub(super) struct State {
    pub(super) resume: watch::Receiver<()>,
    pub(super) id: u32,
    pub(super) last_scroll: Option<(u32, ScrollState)>,
    pub(super) attached: bool,
    pub(super) needs_focus: bool,
    pub(super) focus_pending: bool,
    pub(super) renderer_retry: Option<Instant>,
    pub(super) error: String,
}
impl State {
    pub(super) fn new(resume: watch::Receiver<()>) -> Self {
        Self {
            resume,
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
