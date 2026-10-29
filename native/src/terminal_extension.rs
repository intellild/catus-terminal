//! Terminal component registration and window lifecycle, through Lynx's C ABI.
use std::{ffi::c_void, ptr::NonNull, sync::OnceLock};

use napi::sys::napi_env;

use crate::{
    binding::{
        extension::{self, Extension, LynxView, VsyncObserver},
        native_view,
        protocol::{ElementName, ExtensionName},
    },
    frame_callbacks::{FrameCallbacks, create_frame_callbacks},
    frame_source::NativeFrameSource,
    native_terminal_view::{NativeTerminalView, TerminalHost},
};

struct TerminalExtension {
    frames: Box<FrameCallbacks>,
    vsync: NativeFrameSource,
    host: OnceLock<Box<TerminalHost>>,
}

impl Default for TerminalExtension {
    fn default() -> Self {
        Self {
            frames: create_frame_callbacks(),
            vsync: NativeFrameSource::default(),
            host: OnceLock::new(),
        }
    }
}

impl Extension for TerminalExtension {
    fn on_view_create(&self, view: NonNull<LynxView>) {
        let host = self.host.get_or_init(|| {
            Box::new(TerminalHost {
                view: view.as_ptr() as usize,
                frames: (*self.frames).clone(),
            })
        });
        // SAFETY: Lynx creates native views on UI; the extension owns the
        // immutable factory context throughout this window's lifetime.
        unsafe {
            native_view::register::<NativeTerminalView>(view, ElementName::Terminal, host);
        }
    }

    fn on_view_destroy(&self) {
        self.frames.destroy();
    }

    fn on_enter_foreground(&self) {
        self.frames.set_foreground(true);
    }

    fn on_enter_background(&self) {
        self.frames.set_foreground(false);
    }

    fn on_runtime_attach(&self, _env: napi_env, observer: *mut VsyncObserver) {
        // The observer is borrowed from this runtime and is only valid until
        // on_runtime_detach. Keep the callback on BTS and post only deadlines.
        self.vsync
            .start(observer, &self.vsync as *const _ as *mut c_void);
    }

    fn on_runtime_detach(&self) {
        self.vsync.stop();
    }

    fn on_destroy(&self) {
        self.vsync.stop();
        self.frames.destroy();
    }
}

impl Drop for TerminalExtension {
    fn drop(&mut self) {
        self.vsync.stop();
        self.frames.destroy();
    }
}

pub(crate) fn register_terminal_extension() {
    extension::register::<TerminalExtension>(ExtensionName::Terminal, false);
}

#[cfg(test)]
#[path = "tests/terminal_extension.rs"]
mod tests;
