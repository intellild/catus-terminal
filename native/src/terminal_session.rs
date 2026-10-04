//! Session ownership and numeric handles; the computation module stays GPU-independent.
use crate::terminal_core::{grid::GridSize, pty::TerminalSession};
use napi_derive::napi;
use std::{
    collections::HashMap,
    sync::{
        Arc, LazyLock, Mutex,
        atomic::{AtomicU32, Ordering},
    },
};

#[cfg(all(feature = "native-view", target_os = "macos"))]
use crate::{frame::Viewport, renderer::TerminalRenderer};

static SESSIONS: LazyLock<Mutex<HashMap<u32, Arc<Session>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_ID: AtomicU32 = AtomicU32::new(1);

pub(crate) struct Session {
    pub core: TerminalSession,
    #[cfg(all(feature = "native-view", target_os = "macos"))]
    pub rendering: Mutex<Option<SessionRenderer>>,
}

#[cfg(all(feature = "native-view", target_os = "macos"))]
pub(crate) struct SessionRenderer {
    pub renderer: Box<TerminalRenderer>,
    pub viewport: Viewport,
}

fn create_session() -> Result<u32, String> {
    let id = NEXT_ID
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_add(1))
        .map_err(|_| "Terminal session IDs exhausted")?;
    let session = Arc::new(Session {
        core: TerminalSession::default_shell(GridSize::new(80, 24))?,
        #[cfg(all(feature = "native-view", target_os = "macos"))]
        rendering: Mutex::new(None),
    });
    SESSIONS.lock().unwrap().insert(id, session);
    Ok(id)
}

fn session(id: u32) -> Result<Arc<Session>, String> {
    SESSIONS
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("Unknown or released terminal session: {id}"))
}

#[napi]
pub fn create_terminal_session() -> napi::Result<u32> {
    create_session().map_err(napi::Error::from_reason)
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
        .map_err(napi::Error::from_reason)
}

#[napi(object)]
pub struct TerminalSessionInfo {
    pub shell: String,
    pub exited: bool,
    pub text: String,
}

#[napi]
pub fn get_terminal_session_info(id: u32) -> napi::Result<TerminalSessionInfo> {
    let session = session(id).map_err(napi::Error::from_reason)?;
    Ok(TerminalSessionInfo {
        shell: session.core.shell.clone(),
        exited: session.core.exited(),
        text: session.core.snapshot().text(),
    })
}

#[cfg(all(feature = "native-view", target_os = "macos"))]
pub struct TerminalHandle {
    pub(crate) session: Arc<Session>,
}

#[cfg(all(feature = "native-view", target_os = "macos"))]
pub fn acquire_terminal(id: u32) -> Result<Box<TerminalHandle>, String> {
    Ok(Box::new(TerminalHandle {
        session: session(id)?,
    }))
}

#[cfg(all(feature = "native-view", target_os = "macos"))]
impl TerminalHandle {
    pub fn write(&self, text: &str) -> Result<(), String> {
        self.session.core.write(text.as_bytes().to_vec())
    }
    pub fn key(&self, key: &str, control: bool, alt: bool) -> Result<(), String> {
        self.session.core.key(key, control, alt)
    }
}

#[cfg(test)]
#[path = "tests/terminal_session.rs"]
mod tests;
