//! macOS Lynx terminal bridge; shared session logic prepares the latest grid.
use super::surface::IOSurface;
use super::view::{MacTerminalView, create_mac_terminal_view};
use crate::terminal_session::{TerminalHandle, acquire_terminal};
use anyhow::Result;

#[cxx::bridge(namespace = "catus")]
pub(super) mod ffi {
    #[derive(Clone, Copy)]
    struct NativeMouseEvent {
        // 1 down, 2 up, 3 move, 4 scroll, 5 cancel. Coordinates are logical pixels.
        kind: u8,
        x: f32,
        y: f32,
        // Positive is up; precise deltas use pixels, otherwise lines.
        wheel: f64,
        precise: bool,
        buttons: u32,
        shift: bool,
        control: bool,
        alt: bool,
        // OSR supplies 0; Rust derives click count from time and cell position.
        clicks: u8,
    }
    #[derive(Clone, Copy)]
    struct NativeViewHost {
        parent: usize,
        lynx_view: usize,
        native_view: usize,
        request_focus: usize,
        register_ime: usize,
    }
    unsafe extern "C++" {
        include!("catus-native/src/frame.rs.h");
        type Viewport = crate::frame::Viewport;
        include!("platform/macos/IOSurface.h");
        type IOSurface = super::IOSurface;
    }
    extern "Rust" {
        type MacTerminalView;
        unsafe fn create_mac_terminal_view(host: &NativeViewHost) -> Result<Box<MacTerminalView>>;
        fn uses_osr(self: &MacTerminalView) -> bool;
        fn set_osr(self: &MacTerminalView, requested: bool);
        fn bind_terminal(self: &MacTerminalView, terminal: &TerminalHandle);
        fn clear_terminal(self: &MacTerminalView);
        fn attach(self: &MacTerminalView);
        fn detach(self: &MacTerminalView);
        fn destroy(self: &MacTerminalView);
        fn layout(self: &MacTerminalView, left: f32, top: f32, width: f32, height: f32, ratio: f32);
        fn motion(self: &MacTerminalView, event: &NativeMouseEvent);
        fn focus(self: &MacTerminalView);
        fn blur(self: &MacTerminalView);
        fn render_native(self: &MacTerminalView, deadline: i64) -> Result<bool>;
        unsafe fn render_osr(
            self: &MacTerminalView,
            surface: &IOSurface,
            deadline: i64,
        ) -> Result<bool>;
        type TerminalHandle;
        fn acquire_terminal(id: u32) -> Result<Box<TerminalHandle>>;
        fn write(self: &TerminalHandle, text: &str) -> Result<()>;
        fn key(self: &TerminalHandle, key: &str, control: bool, alt: bool) -> Result<()>;
        fn resize_viewport(self: &TerminalHandle, viewport: &Viewport) -> Result<()>;
        fn invalidate_frame(self: &TerminalHandle);
    }
}

impl TerminalHandle {
    pub(super) fn cursor_rect(&self) -> Result<crate::frame::CursorRect> {
        use anyhow::Context;
        let rendering = self
            .session
            .rendering
            .try_lock()
            .map_err(|_| anyhow::anyhow!("Terminal renderer busy"))?;
        let state = rendering.as_ref().context("Waiting for terminal layout")?;
        let (cw, ch) = state.renderer.cell_size(&state.viewport)?;
        let ratio = state.viewport.pixel_ratio;
        let pad = (8. * ratio).round();
        let grid = self
            .session
            .core
            .try_snapshot()?
            .context("Terminal grid busy")?;
        let (row, column) = grid.insertion_point.unwrap_or_default();
        Ok(crate::frame::CursorRect {
            x: (pad + column as f32 * cw) / ratio,
            y: (pad + row as f32 * ch) / ratio,
            width: cw / ratio,
            height: ch / ratio,
        })
    }

    // SAFETY: The UI thread lends a live CAMetalLayer for the duration of this call.
    pub(super) unsafe fn render_layer(&self, layer: usize, deadline: i64) -> Result<bool> {
        use anyhow::Context;
        use objc2::{
            msg_send,
            rc::Retained,
            runtime::{AnyObject, ProtocolObject},
        };
        use objc2_metal::{MTLPixelFormat, MTLTexture};
        let layer = unsafe { (layer as *mut AnyObject).as_ref() }
            .context("Missing terminal Metal layer")?;
        let mut drawable: Option<Retained<AnyObject>> = None;
        let rendered = self.render_frame(deadline, |device, viewport| {
            let hal = unsafe { device.as_hal::<wgpu::hal::api::Metal>() }
                .context("Terminal requires Metal")?;
            let raw_device = hal.raw_device();
            unsafe {
                let _: () = msg_send![layer, setDevice: &**raw_device];
                let _: () = msg_send![layer, setPixelFormat: MTLPixelFormat::BGRA8Unorm];
                let _: () = msg_send![layer, setFramebufferOnly: true];
                drawable = msg_send![layer, nextDrawable];
            }
            let target = drawable
                .as_ref()
                .context("Terminal Metal drawable unavailable")?;
            let texture: Retained<ProtocolObject<dyn MTLTexture>> =
                unsafe { msg_send![&**target, texture] };
            unsafe { super::surface::import_texture(device, texture, viewport) }
        })?;
        if rendered {
            if crate::frame_callbacks::expired(deadline) {
                self.invalidate_frame();
                return Ok(false);
            }
            if let Some(drawable) = drawable {
                unsafe {
                    let _: () = msg_send![&*drawable, present];
                }
            }
        }
        Ok(rendered)
    }

    // SAFETY: C++ lends a live IOSurfaceRef exclusively until this returns.
    // The shared renderer waits for submitted GPU writes before returning it.
    pub(super) unsafe fn render_surface(
        &self,
        surface: &objc2_io_surface::IOSurfaceRef,
        deadline: i64,
    ) -> Result<bool> {
        self.render_snapshot(deadline, |renderer, viewport, grid| unsafe {
            super::surface::render_to_surface(renderer, viewport, grid, surface, deadline)
        })
    }
}

#[cfg(test)]
#[path = "../../tests/macos/terminal_rendering.rs"]
mod tests;
