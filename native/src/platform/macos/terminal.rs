//! macOS Lynx terminal bridge; shared session logic prepares the latest grid.
use crate::terminal_session::{TerminalHandle, acquire_terminal};
use anyhow::Result;

#[cxx::bridge(namespace = "catus")]
mod ffi {
    unsafe extern "C++" {
        include!("catus-native/src/frame.rs.h");
        type Viewport = crate::frame::Viewport;
    }
    extern "Rust" {
        type TerminalHandle;
        fn acquire_terminal(id: u32) -> Result<Box<TerminalHandle>>;
        fn write(self: &TerminalHandle, text: &str) -> Result<()>;
        fn key(self: &TerminalHandle, key: &str, control: bool, alt: bool) -> Result<()>;
        fn resize_viewport(self: &TerminalHandle, viewport: &Viewport) -> Result<()>;
        fn invalidate_frame(self: &TerminalHandle);
        unsafe fn render_surface(
            self: &TerminalHandle,
            iosurface: usize,
            deadline: i64,
        ) -> Result<bool>;
    }
}

impl TerminalHandle {
    // SAFETY: C++ lends a live IOSurfaceRef exclusively until this returns.
    // The shared renderer waits for submitted GPU writes before returning it.
    unsafe fn render_surface(&self, iosurface: usize, deadline: i64) -> Result<bool> {
        self.render_frame(deadline, |device, viewport| unsafe {
            super::surface::import_surface(device, iosurface, viewport)
        })
    }
}

#[cfg(test)]
#[path = "../../tests/macos/terminal_rendering.rs"]
mod tests;
