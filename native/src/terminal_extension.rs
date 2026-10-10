//! Terminal component registration and window lifecycle, through Lynx's C ABI.
use std::{ptr::NonNull, sync::OnceLock};

use crate::{
    frame_callbacks::{FrameCallbacks, create_frame_callbacks},
    lynx_extension::{self, Extension, LynxView},
    platform::{NativeFrameCallbacks, create_native_frame_callbacks},
};

struct TerminalExtension {
    frames: Box<FrameCallbacks>,
    host: OnceLock<cxx::SharedPtr<NativeFrameCallbacks>>,
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
            // SAFETY: Lynx invokes view creation on UI. Both owners share the
            // same Rust registry; native views retain the C++ shared pointer.
            unsafe {
                create_native_frame_callbacks(view.as_ptr(), Box::new((*self.frames).clone()))
            }
        });
        // SAFETY: The host stays alive throughout registration. Created native
        // views acquire their own shared ownership before using the opaque data.
        unsafe {
            lynx_extension::lynx_view_register_native_view(
                view.as_ptr(),
                c"native-terminal".as_ptr(),
                Some(lynx_extension::catus_create_native_terminal_view),
                host.as_ptr().cast_mut().cast(),
            );
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
    lynx_extension::register::<TerminalExtension>(c"CatusNativeTerminalElement", false);
}

#[cfg(test)]
#[path = "tests/terminal_extension.rs"]
mod tests;
