//! Terminal component registration and window lifecycle, through Lynx's C ABI.
use std::{
    ptr::NonNull,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};

use napi::sys::napi_env;
use tokio::sync::watch;

use crate::{
    binding::{
        VsyncObserver,
        extension::{self, Extension, LynxView},
        native_view,
        protocol::{ElementName, ExtensionName},
    },
    native_terminal_view::NativeTerminalView,
};

pub(crate) struct TerminalExtension {
    pub(crate) lynx_view: OnceLock<usize>,
    pub(crate) vsync: VsyncObserver,
    pub(crate) foreground: Arc<AtomicBool>,
    pub(crate) resume: watch::Sender<()>,
}

impl Default for TerminalExtension {
    fn default() -> Self {
        Self {
            lynx_view: OnceLock::new(),
            vsync: VsyncObserver::default(),
            foreground: Arc::new(AtomicBool::new(true)),
            resume: watch::Sender::new(()),
        }
    }
}

impl Extension for TerminalExtension {
    fn vsync(&self) -> Option<&VsyncObserver> {
        Some(&self.vsync)
    }

    fn on_view_create(&self, view: NonNull<LynxView>) {
        self.lynx_view.get_or_init(|| view.as_ptr() as usize);
        // SAFETY: The module owns this boxed extension through the lifetime of
        // the registered factory. Creation only borrows it on the UI thread.
        unsafe {
            native_view::register::<NativeTerminalView>(view, ElementName::Terminal, self);
        }
    }

    fn on_runtime_attach(&self, _env: napi_env) {
        self.resume.send_replace(());
    }

    fn on_enter_foreground(&self) {
        self.foreground.store(true, Ordering::Release);
        self.resume.send_replace(());
    }

    fn on_enter_background(&self) {
        self.foreground.store(false, Ordering::Release);
    }
}

pub(crate) fn register_terminal_extension() {
    extension::register::<TerminalExtension>(ExtensionName::Terminal, false);
}
