//! Terminal component registration and window lifecycle, through Lynx's C ABI.
use std::{ptr::NonNull, sync::OnceLock};

use crate::{
    binding::{
        extension::{self, Extension, LynxView},
        native_view,
        protocol::{ElementName, ExtensionName},
    },
    frame_callbacks::{FrameCallbacks, create_frame_callbacks},
    native_terminal_view::{NativeTerminalView, TerminalHost},
};

struct TerminalExtension {
    frames: Box<FrameCallbacks>,
    host: OnceLock<Box<TerminalHost>>,
}

impl Default for TerminalExtension {
    fn default() -> Self {
        Self {
            frames: create_frame_callbacks(),
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

    fn on_destroy(&self) {
        self.frames.destroy();
    }
}

impl Drop for TerminalExtension {
    fn drop(&mut self) {
        self.frames.destroy();
    }
}

pub(crate) fn register_terminal_extension() {
    extension::register::<TerminalExtension>(ExtensionName::Terminal, false);
}

#[cfg(test)]
#[path = "tests/terminal_extension.rs"]
mod tests;
