//! macOS Lynx terminal bridge; shared session logic prepares the latest grid.
use crate::terminal_session::TerminalHandle;
use anyhow::Result;

pub(super) mod ffi {
    use crate::binding::types::MouseButtons;
    #[derive(Clone, Copy)]
    pub struct NativeMouseEvent {
        // 1 down, 2 up, 3 move, 4 scroll, 5 cancel. Coordinates are logical pixels.
        pub kind: u8,
        pub x: f32,
        pub y: f32,
        // Positive is up; precise deltas use pixels, otherwise lines.
        pub wheel: f64,
        pub precise: bool,
        pub buttons: MouseButtons,
        pub shift: bool,
        pub control: bool,
        pub alt: bool,
        // OSR supplies 0; Rust derives click count from time and cell position.
        pub clicks: u8,
    }
    #[derive(Clone, Copy)]
    pub struct NativeViewHost {
        pub parent: usize,
        pub lynx_view: usize,
        pub native_view: usize,
        pub request_focus: Option<unsafe extern "C" fn(usize)>,
        pub register_ime: Option<unsafe extern "C" fn(usize, usize, usize)>,
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
