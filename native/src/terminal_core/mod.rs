//! Host-independent terminal state and PTY lifecycle. No wgpu, font, or Lynx dependency.
pub mod grid;
pub mod pty;

use grid::GridSize;
use napi_derive::napi;
use pty::TerminalSession;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex, OnceLock, Weak,
        atomic::{AtomicU64, Ordering},
    },
};

type Registry = Mutex<HashMap<String, Weak<TerminalSession>>>;
fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}
#[napi]
pub struct RustTerminal {
    session: Arc<TerminalSession>,
    #[napi(readonly)]
    pub native_id: String,
}
#[napi]
impl RustTerminal {
    #[napi(constructor)]
    pub fn new() -> napi::Result<Self> {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let session = Arc::new(
            TerminalSession::default_shell(GridSize::new(80, 24))
                .map_err(napi::Error::from_reason)?,
        );
        let native_id = format!("terminal-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        registry()
            .lock()
            .unwrap()
            .insert(native_id.clone(), Arc::downgrade(&session));
        Ok(Self { session, native_id })
    }
    #[napi]
    pub fn write(&self, text: String) -> napi::Result<()> {
        self.session
            .write(text.into_bytes())
            .map_err(napi::Error::from_reason)
    }
    #[napi]
    pub fn close(&self) {
        self.session.close();
    }
    #[napi(getter)]
    pub fn shell(&self) -> String {
        self.session.shell.clone()
    }
    #[napi(getter)]
    pub fn exited(&self) -> bool {
        self.session.exited()
    }
    #[napi]
    pub fn screen_text(&self) -> String {
        self.session.snapshot().text()
    }
}
impl Drop for RustTerminal {
    fn drop(&mut self) {
        self.session.close();
        registry().lock().unwrap().remove(&self.native_id);
    }
}
pub struct TerminalHandle {
    pub session: Arc<TerminalSession>,
}
pub fn acquire_terminal(id: &str) -> Result<Box<TerminalHandle>, String> {
    let session = registry()
        .lock()
        .unwrap()
        .get(id)
        .and_then(Weak::upgrade)
        .ok_or_else(|| format!("Unknown or released terminal: {id}"))?;
    Ok(Box::new(TerminalHandle { session }))
}
impl TerminalHandle {
    pub fn write(&self, text: &str) -> Result<(), String> {
        self.session.write(text.as_bytes().to_vec())
    }
    pub fn key(&self, key: &str, control: bool, alt: bool) -> Result<(), String> {
        self.session.key(key, control, alt)
    }
    pub fn screen_text(&self) -> String {
        self.session.snapshot().text()
    }
    pub fn exited(&self) -> bool {
        self.session.exited()
    }
    pub fn shell(&self) -> &str {
        &self.session.shell
    }
}
