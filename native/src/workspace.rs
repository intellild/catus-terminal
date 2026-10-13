//! Workspace ownership is independent of rendering and the selected terminal backend.
mod delegate;
mod factory;
mod plain;
mod tmux;
use crate::{
    terminal_core::grid::GridSize,
    terminal_session::{Session, TerminalSessionCommand},
};
use anyhow::{Context, Result, anyhow};
pub(crate) use delegate::WorkspaceDelegate;
use factory::WorkspaceFactory;
use std::{collections::HashMap, sync::Arc};

pub(crate) struct Workspace {
    sessions: HashMap<u32, Arc<Session>>,
    delegate: Arc<dyn WorkspaceDelegate>,
}
impl Workspace {
    fn new(delegate: Arc<dyn WorkspaceDelegate>) -> Self {
        Self {
            sessions: HashMap::new(),
            delegate,
        }
    }
    fn set_delegate(&mut self, delegate: Arc<dyn WorkspaceDelegate>) {
        self.delegate = delegate;
    }
    fn create_session(&mut self, id: u32, command: Option<TerminalSessionCommand>) -> Result<()> {
        let size = GridSize::new(80, 24);
        let core = self.delegate.create_session(command, size)?;
        self.sessions.insert(
            id,
            Arc::new(Session {
                core,
                #[cfg(feature = "native-view")]
                rendering: std::sync::Mutex::new(None),
            }),
        );
        Ok(())
    }
    fn session(&self, id: u32) -> Option<Arc<Session>> {
        self.sessions.get(&id).cloned()
    }
    fn close_session(&mut self, id: u32) {
        if let Some(session) = self.sessions.remove(&id) {
            session.core.close();
        }
    }
    fn detach_session(&mut self, id: u32) {
        if let Some(session) = self.sessions.remove(&id) {
            session.core.detach();
        }
    }
    fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }
}

/// Global numeric handles locate a workspace; membership belongs to Workspace.
#[derive(Default)]
pub(crate) struct Workspaces {
    factory: WorkspaceFactory,
    workspaces: HashMap<String, Workspace>,
    owners: HashMap<u32, String>,
}
impl Workspaces {
    pub(crate) fn create_session(
        &mut self,
        id: u32,
        command: Option<TerminalSessionCommand>,
    ) -> Result<()> {
        if id == 0 {
            return Err(anyhow!(
                "Terminal session ID 0 is reserved for an unbound view"
            ));
        }
        if self.owners.contains_key(&id) {
            return Err(anyhow!("Duplicate terminal session ID: {id}"));
        }
        let workspace_id = command
            .as_ref()
            .and_then(|command| command.workspace_id.as_deref())
            .unwrap_or("default")
            .to_owned();
        let workspace = match self.workspaces.entry(workspace_id.clone()) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(self.factory.create(command.as_ref()))
            }
            std::collections::hash_map::Entry::Occupied(entry) => {
                let workspace = entry.into_mut();
                self.factory.configure(workspace, command.as_ref());
                workspace
            }
        };
        if let Err(error) = workspace.create_session(id, command) {
            if workspace.is_empty() {
                self.workspaces.remove(&workspace_id);
            }
            return Err(error);
        }
        self.owners.insert(id, workspace_id);
        Ok(())
    }
    pub(crate) fn session(&self, id: u32) -> Result<Arc<Session>> {
        self.owners
            .get(&id)
            .and_then(|owner| self.workspaces.get(owner))
            .and_then(|workspace| workspace.session(id))
            .with_context(|| format!("Unknown or released terminal session: {id}"))
    }
    pub(crate) fn close_session(&mut self, id: u32) {
        self.release_session(id, false);
    }
    pub(crate) fn detach_session(&mut self, id: u32) {
        self.release_session(id, true);
    }
    fn release_session(&mut self, id: u32, preserve: bool) {
        let Some(owner) = self.owners.remove(&id) else {
            return;
        };
        if let Some(workspace) = self.workspaces.get_mut(&owner) {
            if preserve {
                workspace.detach_session(id);
            } else {
                workspace.close_session(id);
            }
            if workspace.is_empty() {
                self.workspaces.remove(&owner);
            }
        }
    }
}

#[cfg(test)]
#[path = "tests/workspace.rs"]
mod tests;
