//! Selects host backends and injects them into Host.
use super::{Host, HostDelegate, plain::PlainHostDelegate, tmux::TmuxHostDelegate};
use crate::terminal_session::TerminalSessionCommand;
use std::sync::Arc;

pub(crate) struct HostFactory {
    plain: Arc<dyn HostDelegate>,
    tmux: Arc<dyn HostDelegate>,
}

impl Default for HostFactory {
    fn default() -> Self {
        Self {
            plain: Arc::new(PlainHostDelegate),
            tmux: Arc::new(TmuxHostDelegate),
        }
    }
}

impl HostFactory {
    pub(super) fn create(&self, command: Option<&TerminalSessionCommand>) -> Host {
        Host::new(self.delegate(command))
    }

    pub(super) fn configure(&self, host: &mut Host, command: Option<&TerminalSessionCommand>) {
        // Existing sessions own their PtyDelegate; only future sessions use this backend.
        host.set_delegate(self.delegate(command));
    }

    fn delegate(&self, command: Option<&TerminalSessionCommand>) -> Arc<dyn HostDelegate> {
        if command.is_some_and(|command| command.tmux.is_some()) {
            self.tmux.clone()
        } else {
            self.plain.clone()
        }
    }
}
