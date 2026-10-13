//! Selects workspace backends and injects them into Workspace.
use super::{
    Workspace, WorkspaceDelegate, plain::PlainWorkspaceDelegate, tmux::TmuxWorkspaceDelegate,
};
use crate::terminal_session::TerminalSessionCommand;
use std::sync::Arc;

pub(crate) struct WorkspaceFactory {
    plain: Arc<dyn WorkspaceDelegate>,
    tmux: Arc<dyn WorkspaceDelegate>,
}

impl Default for WorkspaceFactory {
    fn default() -> Self {
        Self {
            plain: Arc::new(PlainWorkspaceDelegate),
            tmux: Arc::new(TmuxWorkspaceDelegate),
        }
    }
}

impl WorkspaceFactory {
    pub(super) fn create(&self, command: Option<&TerminalSessionCommand>) -> Workspace {
        Workspace::new(self.delegate(command))
    }

    pub(super) fn configure(
        &self,
        workspace: &mut Workspace,
        command: Option<&TerminalSessionCommand>,
    ) {
        // Existing sessions own their PtyDelegate; only future sessions use this backend.
        workspace.set_delegate(self.delegate(command));
    }

    fn delegate(&self, command: Option<&TerminalSessionCommand>) -> Arc<dyn WorkspaceDelegate> {
        if command.is_some_and(|command| command.tmux.is_some()) {
            self.tmux.clone()
        } else {
            self.plain.clone()
        }
    }
}
