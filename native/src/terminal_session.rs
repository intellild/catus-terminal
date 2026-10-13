//! Session ownership and numeric handles; the computation module stays GPU-independent.
use crate::{terminal_core::session::TerminalSession, workspace::Workspaces};
use anyhow::Result;
use napi_derive::napi;
use std::sync::{Arc, LazyLock, Mutex};

#[cfg(feature = "native-view")]
use crate::{frame::Viewport, renderer::TerminalRenderer};

static WORKSPACES: LazyLock<Mutex<Workspaces>> =
    LazyLock::new(|| Mutex::new(Workspaces::default()));

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
    pub workspace_id: Option<String>,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub tmux: Option<crate::terminal_core::tmux::TmuxOptions>,
}

fn create_session_with_command(id: u32, command: Option<TerminalSessionCommand>) -> Result<()> {
    // Hold the registry through creation so concurrent callers cannot replace a handle.
    WORKSPACES.lock().unwrap().create_session(id, command)
}

fn session(id: u32) -> Result<Arc<Session>> {
    WORKSPACES.lock().unwrap().session(id)
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
    WORKSPACES.lock().unwrap().close_session(id);
}

#[napi]
pub fn detach_terminal_session(id: u32) {
    WORKSPACES.lock().unwrap().detach_session(id);
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
#[derive(Clone)]
pub struct TerminalHandle {
    pub(crate) session: Arc<Session>,
    pub(crate) preedit: Arc<Mutex<String>>,
    pub(crate) mouse: Arc<Mutex<crate::platform::MouseState>>,
}

#[cfg(feature = "native-view")]
pub fn acquire_terminal(id: u32) -> Result<Box<TerminalHandle>> {
    Ok(Box::new(TerminalHandle {
        session: session(id)?,
        preedit: Arc::new(Mutex::new(String::new())),
        mouse: Arc::new(Mutex::new(crate::platform::MouseState::default())),
    }))
}

#[cfg(feature = "native-view")]
impl TerminalHandle {
    pub fn write(&self, text: &str) -> Result<()> {
        self.session.core.write(text.as_bytes().to_vec())
    }
    pub fn paste(&self, text: &str) -> Result<()> {
        self.session.core.paste(text)
    }
    pub fn key(&self, key: &str, control: bool, alt: bool) -> Result<()> {
        self.session.core.key(key, control, alt)
    }
}

#[cfg(test)]
#[path = "tests/terminal_session.rs"]
mod tests;
