//! Session ownership and numeric handles; the computation module stays GPU-independent.
use crate::terminal_core::{grid::GridSize, pty::TerminalSession};
use anyhow::{Context, Result, anyhow};
use napi_derive::napi;
use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex},
};

#[cfg(feature = "native-view")]
use crate::{frame::Viewport, renderer::TerminalRenderer};

static SESSIONS: LazyLock<Mutex<HashMap<u32, Arc<Session>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(crate) struct Session {
    pub core: TerminalSession,
    #[cfg(feature = "native-view")]
    pub rendering: Mutex<Option<SessionRenderer>>,
}

#[cfg(feature = "native-view")]
pub(crate) struct SessionRenderer {
    pub renderer: Box<TerminalRenderer>,
    pub viewport: Viewport,
}

#[napi(object)]
pub struct TerminalSessionCommand {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
}

fn create_session_with_command(id: u32, command: Option<TerminalSessionCommand>) -> Result<()> {
    if id == 0 {
        return Err(anyhow!(
            "Terminal session ID 0 is reserved for an unbound view"
        ));
    }
    // Keep the entry reserved through PTY creation so concurrent callers cannot replace it.
    let mut sessions = SESSIONS.lock().unwrap();
    let std::collections::hash_map::Entry::Vacant(entry) = sessions.entry(id) else {
        return Err(anyhow!("Duplicate terminal session ID: {id}"));
    };
    let size = GridSize::new(80, 24);
    let core = match command {
        Some(command) => TerminalSession::command_in_directory(
            &command.program,
            &command.args,
            command.cwd.as_deref(),
            size,
        )?,
        None => TerminalSession::default_shell(size)?,
    };
    let session = Arc::new(Session {
        core,
        #[cfg(feature = "native-view")]
        rendering: Mutex::new(None),
    });
    entry.insert(session);
    Ok(())
}

fn session(id: u32) -> Result<Arc<Session>> {
    SESSIONS
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .with_context(|| format!("Unknown or released terminal session: {id}"))
}

#[napi]
pub fn create_terminal_session(
    id: u32,
    command: Option<TerminalSessionCommand>,
) -> napi::Result<()> {
    create_session_with_command(id, command).map_err(crate::napi_error)
}

#[napi]
pub fn close_terminal_session(id: u32) {
    // Removal prevents new bindings; outstanding native handles see the closed PTY.
    let removed = SESSIONS.lock().unwrap().remove(&id);
    if let Some(session) = removed {
        session.core.close();
    }
}

#[napi]
pub fn write_terminal_session(id: u32, text: String) -> napi::Result<()> {
    session(id)
        .and_then(|session| session.core.write(text.into_bytes()))
        .map_err(crate::napi_error)
}

#[napi(object)]
pub struct TerminalSessionInfo {
    pub shell: String,
    pub exited: bool,
    pub text: String,
}

#[napi]
pub fn get_terminal_session_info(id: u32) -> napi::Result<TerminalSessionInfo> {
    let session = session(id).map_err(crate::napi_error)?;
    Ok(TerminalSessionInfo {
        shell: session.core.shell.clone(),
        exited: session.core.exited(),
        text: session.core.snapshot().text(),
    })
}

#[cfg(feature = "native-view")]
pub struct TerminalHandle {
    pub(crate) session: Arc<Session>,
}

#[cfg(feature = "native-view")]
pub fn acquire_terminal(id: u32) -> Result<Box<TerminalHandle>> {
    Ok(Box::new(TerminalHandle {
        session: session(id)?,
    }))
}

#[cfg(feature = "native-view")]
impl TerminalHandle {
    pub fn write(&self, text: &str) -> Result<()> {
        self.session.core.write(text.as_bytes().to_vec())
    }
    pub fn key(&self, key: &str, control: bool, alt: bool) -> Result<()> {
        self.session.core.key(key, control, alt)
    }
}

#[cfg(test)]
#[path = "tests/terminal_session.rs"]
mod tests;
