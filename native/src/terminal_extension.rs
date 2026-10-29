//! Terminal component registration and window lifecycle, through Lynx's C ABI.
use std::{
    ptr::NonNull,
    sync::{Arc, OnceLock},
};

use napi::sys::napi_env;

use crate::{
    binding::{
        extension::{self, Extension, LynxView, RawModule, VsyncObserver},
        native_view,
        protocol::{ElementName, ExtensionName},
    },
    frame_source::NativeFrameSource,
    native_terminal_view::{NativeTerminalView, TerminalHost},
};

struct TerminalExtension {
    frames: Arc<NativeFrameSource>,
    host: OnceLock<Box<TerminalHost>>,
}

impl Default for TerminalExtension {
    fn default() -> Self {
        Self {
            frames: Arc::new(NativeFrameSource::default()),
            host: OnceLock::new(),
        }
    }
}

impl Extension for TerminalExtension {
    fn on_module_created(&self, module: *mut RawModule) {
        self.frames.set_module(module);
    }

    fn on_view_create(&self, view: NonNull<LynxView>) {
        let host = self.host.get_or_init(|| {
            Box::new(TerminalHost {
                view: view.as_ptr() as usize,
                frames: Arc::clone(&self.frames),
            })
        });
        // SAFETY: Lynx creates native views on UI; the extension owns the
        // immutable factory context throughout this window's lifetime.
        unsafe {
            native_view::register::<NativeTerminalView>(view, ElementName::Terminal, host);
        }
    }

    fn on_enter_foreground(&self) {
        self.frames.set_foreground(true);
    }

    fn on_enter_background(&self) {
        self.frames.set_foreground(false);
    }

    fn on_runtime_attach(&self, _env: napi_env, observer: *mut VsyncObserver) {
        // The observer is borrowed from this runtime and is only valid until
        // on_runtime_detach. Views keep their own loops and request frames on BTS.
        self.frames.set_observer(observer);
    }

    fn on_runtime_detach(&self) {
        self.frames.set_observer(std::ptr::null_mut());
    }

    fn on_destroy(&self) {
        self.frames.set_observer(std::ptr::null_mut());
        self.frames.stop_all();
    }
}

impl Drop for TerminalExtension {
    fn drop(&mut self) {
        self.frames.set_observer(std::ptr::null_mut());
        self.frames.stop_all();
    }
}

pub(crate) fn register_terminal_extension() {
    extension::register::<TerminalExtension>(ExtensionName::Terminal, false);
}

#[cfg(test)]
#[path = "tests/terminal_extension.rs"]
mod tests;
