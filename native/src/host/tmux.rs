use super::HostDelegate;
use crate::{
    terminal_core::{grid::GridSize, pty::TmuxPtyDelegate, session::TerminalSession},
    terminal_session::TerminalSessionCommand,
};
use anyhow::{Context, Result};
use std::sync::Arc;

pub(crate) struct TmuxHostDelegate;
impl HostDelegate for TmuxHostDelegate {
    fn create_session(
        &self,
        command: Option<TerminalSessionCommand>,
        size: GridSize,
    ) -> Result<TerminalSession> {
        let command = command.context("Missing tmux host command")?;
        let options = command.tmux.context("Missing tmux host options")?;
        TerminalSession::command_with_delegate(
            &command.program,
            &command.args,
            command.cwd.as_deref(),
            size,
            Arc::new(TmuxPtyDelegate::new(options, size)),
        )
    }
}
