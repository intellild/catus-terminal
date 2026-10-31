//! Terminal component registration and window lifecycle, through Lynx's C ABI.
use std::{
    ptr::NonNull,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};

use crate::{
    binding::{
        VsyncObserver,
        extension::{self, Extension, LynxView},
        native_view,
        protocol::{ElementName, ExtensionName},
    },
    native_terminal_view::{NativeTerminalView, TerminalHost},
};

struct TerminalExtension {
    vsync: VsyncObserver,
    foreground: Arc<AtomicBool>,
    host: OnceLock<Box<TerminalHost>>,
}

impl Default for TerminalExtension {
    fn default() -> Self {
        Self {
            vsync: VsyncObserver::default(),
            foreground: Arc::new(AtomicBool::new(true)),
            host: OnceLock::new(),
        }
    }
}

impl Extension for TerminalExtension {
    fn vsync(&self) -> Option<&VsyncObserver> {
        Some(&self.vsync)
    }

    fn on_view_create(&self, view: NonNull<LynxView>) {
        let host = self.host.get_or_init(|| {
            Box::new(TerminalHost {
                view: view.as_ptr() as usize,
                vsync: self.vsync.clone(),
                foreground: Arc::clone(&self.foreground),
            })
        });
        // SAFETY: Lynx creates native views on UI; the extension owns the
        // immutable factory context throughout this window's lifetime.
        unsafe {
            native_view::register::<NativeTerminalView>(view, ElementName::Terminal, host);
        }
    }

    fn on_enter_foreground(&self) {
        self.foreground.store(true, Ordering::Release);
    }

    fn on_enter_background(&self) {
        self.foreground.store(false, Ordering::Release);
    }
}

pub(crate) fn register_terminal_extension() {
    extension::register::<TerminalExtension>(ExtensionName::Terminal, false);
}

#[cfg(test)]
#[path = "tests/terminal_extension.rs"]
mod tests;
