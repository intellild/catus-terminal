//! Host-specific session creation; terminal protocols belong to PtyDelegate.
use crate::{
    terminal_core::{grid::GridSize, session::TerminalSession},
    terminal_session::TerminalSessionCommand,
};
use anyhow::Result;

pub(crate) trait HostDelegate: Send + Sync {
    fn create_session(
        &self,
        command: Option<TerminalSessionCommand>,
        size: GridSize,
    ) -> Result<TerminalSession>;
}
