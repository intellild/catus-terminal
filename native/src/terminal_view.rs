//! Lynx view orchestration; PTY/grid computation and GPU renderer remain independent.
use crate::renderer::{TerminalRenderer, create_terminal_renderer};
use crate::terminal_core::{TerminalHandle, acquire_terminal};

#[cxx::bridge(namespace = "catus")]
mod ffi {
    extern "Rust" {
        type TerminalHandle;
        fn acquire_terminal(id: &str) -> Result<Box<TerminalHandle>>;
        fn write(self: &TerminalHandle, text: &str) -> Result<()>;
        fn key(self: &TerminalHandle, key: &str, control: bool, alt: bool) -> Result<()>;
        fn screen_text(self: &TerminalHandle) -> String;
        fn shell(self: &TerminalHandle) -> &str;
        fn exited(self: &TerminalHandle) -> bool;
        type TerminalRenderer;
        fn prepare_terminal_frame(
            renderer: &mut TerminalRenderer,
            terminal: &TerminalHandle,
            width: u32,
            height: u32,
            pixel_ratio: f32,
        ) -> Result<bool>;
        unsafe fn render_terminal(
            renderer: &mut TerminalRenderer,
            terminal: &TerminalHandle,
            metal_texture: usize,
            width: u32,
            height: u32,
            pixel_ratio: f32,
        ) -> Result<bool>;
        fn create_terminal_renderer() -> Result<Box<TerminalRenderer>>;
        fn metal_device(self: &TerminalRenderer) -> usize;
        fn adapter_name(self: &TerminalRenderer) -> &str;
        fn frames(self: &TerminalRenderer) -> u64;
        fn atlas_pages(self: &TerminalRenderer) -> u32;
        fn atlas_uploads(self: &TerminalRenderer) -> u64;
        fn atlas_instances(self: &TerminalRenderer) -> u32;
        fn cached_glyphs(self: &TerminalRenderer) -> u32;
        fn rasterizations(self: &TerminalRenderer) -> u64;
        fn font_pixels(self: &TerminalRenderer) -> f32;
        fn missing_glyphs(self: &TerminalRenderer) -> u64;
        fn clear_atlas(self: &mut TerminalRenderer);
        fn invalidate_grid(self: &mut TerminalRenderer);
        unsafe fn render_atlas(
            self: &mut TerminalRenderer,
            metal_texture: usize,
            width: u32,
            height: u32,
            pixel_ratio: f32,
        ) -> Result<()>;
        unsafe fn render_triangle(
            self: &mut TerminalRenderer,
            metal_texture: usize,
            width: u32,
            height: u32,
        ) -> Result<()>;
    }
}

// Resize on the UI frame boundary. Idle frames skip framebuffer acquisition and GPU work.
fn prepare_terminal_frame(
    renderer: &mut TerminalRenderer,
    terminal: &TerminalHandle,
    width: u32,
    height: u32,
    pixel_ratio: f32,
) -> Result<bool, String> {
    let size = renderer.grid_size(width, height, pixel_ratio)?;
    terminal.session.resize(size)?;
    if let Some(error) = terminal.session.error() {
        return Err(error);
    }
    Ok(renderer.needs_grid(terminal.session.revision(), width, height, pixel_ratio))
}

// SAFETY: The native view passes a borrowed Metal back buffer created on renderer.metal_device().
unsafe fn render_terminal(
    renderer: &mut TerminalRenderer,
    terminal: &TerminalHandle,
    texture: usize,
    width: u32,
    height: u32,
    pixel_ratio: f32,
) -> Result<bool, String> {
    if !prepare_terminal_frame(renderer, terminal, width, height, pixel_ratio)? {
        return Ok(false);
    }
    let snapshot = terminal.session.snapshot();
    unsafe {
        renderer.render_grid(texture, width, height, pixel_ratio, &snapshot)?;
    }
    Ok(true)
}
