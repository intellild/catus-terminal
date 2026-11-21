//! Session ownership and numeric handles; the computation module stays GPU-independent.
use crate::{host::Hosts, terminal_core::tmux::TmuxSessionInfo};
use anyhow::Result;
use napi_derive::napi;
use std::sync::{Arc, LazyLock, Mutex};

pub(crate) use crate::terminal_core::session::TerminalSession as Session;

static HOSTS: LazyLock<Mutex<Hosts>> = LazyLock::new(|| Mutex::new(Hosts::default()));

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

pub(crate) fn session(id: u32) -> Result<Arc<Session>> {
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
        .and_then(|session| session.write(text.into_bytes()))
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
        shell: session.shell.clone(),
        exited: session.exited(),
        text: session.snapshot().text(),
    })
}

#[napi]
pub fn get_tmux_session_info(id: u32) -> napi::Result<Option<TmuxSessionInfo>> {
    let session = session(id).map_err(crate::napi_error)?;
    Ok(session.tmux_info())
}

#[napi]
pub fn select_tmux_window(id: u32, window_id: String) -> napi::Result<bool> {
    session(id)
        .and_then(|session| session.select_tmux_window(&window_id))
        .map_err(crate::napi_error)
}

#[napi]
pub fn create_tmux_window(id: u32) -> napi::Result<bool> {
    session(id)
        .and_then(|session| session.create_tmux_window())
        .map_err(crate::napi_error)
}

#[napi]
pub fn close_tmux_window(id: u32, window_id: String) -> napi::Result<bool> {
    session(id)
        .and_then(|session| session.close_tmux_window(&window_id))
        .map_err(crate::napi_error)
}
