//! Session ownership and numeric handles; the computation module stays GPU-independent.
use crate::{
    host::Hosts, terminal_core::session::TerminalSession, terminal_core::tmux::TmuxSessionInfo,
};
use anyhow::Result;
use napi_derive::napi;
use std::sync::{Arc, LazyLock, Mutex};

#[cfg(feature = "native-view")]
use crate::{frame::Viewport, renderer::TerminalRenderer};

static HOSTS: LazyLock<Mutex<Hosts>> = LazyLock::new(|| Mutex::new(Hosts::default()));

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
    pub host_id: Option<String>,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub tmux: Option<crate::terminal_core::tmux::TmuxOptions>,
}

fn create_session_with_command(id: u32, command: Option<TerminalSessionCommand>) -> Result<()> {
    // Hold the registry through creation so concurrent callers cannot replace a handle.
    HOSTS.lock().unwrap().create_session(id, command)
}

fn session(id: u32) -> Result<Arc<Session>> {
    HOSTS.lock().unwrap().session(id)
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
    HOSTS.lock().unwrap().close_session(id);
}

#[napi]
pub fn detach_terminal_session(id: u32) {
    HOSTS.lock().unwrap().detach_session(id);
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

#[napi]
pub fn get_tmux_session_info(id: u32) -> napi::Result<Option<TmuxSessionInfo>> {
    let session = session(id).map_err(crate::napi_error)?;
    Ok(session.core.tmux_info())
}

#[napi]
pub fn select_tmux_window(id: u32, window_id: String) -> napi::Result<bool> {
    session(id)
        .and_then(|session| session.core.select_tmux_window(&window_id))
        .map_err(crate::napi_error)
}

#[napi]
pub fn create_tmux_window(id: u32) -> napi::Result<bool> {
    session(id)
        .and_then(|session| session.core.create_tmux_window())
        .map_err(crate::napi_error)
}

#[napi]
pub fn close_tmux_window(id: u32, window_id: String) -> napi::Result<bool> {
    session(id)
        .and_then(|session| session.core.close_tmux_window(&window_id))
        .map_err(crate::napi_error)
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
    pub fn set_on_change(&self, callback: Option<Arc<dyn Fn() + Send + Sync>>) {
        self.session.core.set_on_change(callback);
    }
}

#[cfg(test)]
#[path = "tests/terminal_session.rs"]
mod tests;
