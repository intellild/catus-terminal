use super::HostDelegate;
use crate::{
    terminal_core::{grid::GridSize, session::TerminalSession},
    terminal_session::TerminalSessionCommand,
};
use anyhow::Result;

pub(crate) struct PlainHostDelegate;
impl HostDelegate for PlainHostDelegate {
    fn create_session(
        &self,
        command: Option<TerminalSessionCommand>,
        size: GridSize,
    ) -> Result<TerminalSession> {
        match command {
            Some(command) => TerminalSession::command_in_directory(
                &command.program,
                &command.args,
                command.cwd.as_deref(),
                size,
            ),
            None => TerminalSession::default_shell(size),
        }
    }
}
