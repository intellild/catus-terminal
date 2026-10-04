//! Lynx adapter; PTY computation and the shared GPU renderer remain independent.
use crate::frame::{FrameBuffer, Viewport};
use crate::renderer::{TerminalRenderer, create_terminal_renderer};
use crate::terminal_core::{TerminalHandle, acquire_terminal};

#[cxx::bridge(namespace = "catus")]
mod ffi {
    unsafe extern "C++" {
        include!("catus-native/src/frame.rs.h");
        type Viewport = crate::frame::Viewport;
        type FrameBuffer = crate::frame::FrameBuffer;
    }
    extern "Rust" {
        type TerminalHandle;
        fn acquire_terminal(id: &str) -> Result<Box<TerminalHandle>>;
        fn write(self: &TerminalHandle, text: &str) -> Result<()>;
        fn key(self: &TerminalHandle, key: &str, control: bool, alt: bool) -> Result<()>;
        type TerminalRenderer;
        fn create_terminal_renderer() -> Result<Box<TerminalRenderer>>;
        fn metal_device(self: &TerminalRenderer) -> usize;
        fn invalidate_grid(self: &mut TerminalRenderer);
        fn prepare_terminal_frame(
            renderer: &TerminalRenderer,
            terminal: &TerminalHandle,
            viewport: &Viewport,
        ) -> Result<bool>;
        unsafe fn render_terminal(
            renderer: &mut TerminalRenderer,
            terminal: &TerminalHandle,
            frame: &FrameBuffer,
        ) -> Result<bool>;
    }
}

// Idle frames avoid snapshots, framebuffer acquisition and GPU work.
fn prepare_terminal_frame(
    renderer: &TerminalRenderer,
    terminal: &TerminalHandle,
    viewport: &Viewport,
) -> Result<bool, String> {
    terminal.session.resize(renderer.grid_size(viewport)?)?;
    if let Some(error) = terminal.session.error() {
        return Err(error);
    }
    renderer.needs_grid(terminal.session.revision(), viewport)
}

// SAFETY: The native view lends an exclusive framebuffer on renderer.metal_device().
unsafe fn render_terminal(
    renderer: &mut TerminalRenderer,
    terminal: &TerminalHandle,
    frame: &FrameBuffer,
) -> Result<bool, String> {
    if !prepare_terminal_frame(renderer, terminal, &frame.viewport)? {
        return Ok(false);
    }
    let snapshot = terminal.session.snapshot();
    unsafe {
        renderer.render_grid(frame, &snapshot)?;
    }
    Ok(true)
}
