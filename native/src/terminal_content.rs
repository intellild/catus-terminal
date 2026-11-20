//! The terminal content displayed by one element.
use crate::{terminal_core::grid::GridSnapshot, terminal_session::Session};
use anyhow::Result;
use std::sync::Arc;

pub(crate) struct TerminalContent {
    pub(crate) session: Arc<Session>,
    pub(crate) preedit: String,
}

impl TerminalContent {
    pub(crate) fn new(session: Arc<Session>) -> Self {
        Self {
            session,
            preedit: String::new(),
        }
    }

    pub(crate) fn try_snapshot(&self) -> Result<Option<GridSnapshot>> {
        let Some(mut grid) = self.session.try_snapshot()? else {
            return Ok(None);
        };
        grid.overlay_preedit(&self.preedit);
        Ok(Some(grid))
    }
}
