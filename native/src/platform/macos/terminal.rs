//! macOS Lynx terminal bridge; shared session logic prepares the latest grid.
use crate::renderer::{PreparedFrame, RenderOutcome};
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

/// Render the session into the view's CAMetalLayer and present the drawable.
/// The layer is configured once; expired frames release their drawable without
/// presenting so the grid stays dirty for the next frame.
pub(super) fn render_layer(
    frame: &mut PreparedFrame<'_>,
    layer: &objc2_quartz_core::CAMetalLayer,
    layer_configured: &std::cell::Cell<bool>,
) -> Result<RenderOutcome> {
    use anyhow::Context;
    use objc2::{
        msg_send,
        rc::Retained,
        runtime::{AnyObject, ProtocolObject},
    };
    use objc2_metal::{MTLPixelFormat, MTLTexture};

    let mut drawable: Option<Retained<AnyObject>> = None;
    let drawn = frame.draw(crate::text::TargetOrigin::TopLeft, |device, viewport| {
        if !layer_configured.get() {
            let hal = unsafe { device.as_hal::<wgpu::hal::api::Metal>() }
                .context("Terminal requires Metal")?;
            let raw_device = hal.raw_device();
            unsafe {
                let _: () = msg_send![layer, setDevice: &**raw_device];
                let _: () = msg_send![layer, setPixelFormat: MTLPixelFormat::BGRA8Unorm];
                let _: () = msg_send![layer, setFramebufferOnly: true];
            }
            layer_configured.set(true);
        }
        drawable = unsafe { msg_send![layer, nextDrawable] };
        let target = drawable
            .as_ref()
            .context("Terminal Metal drawable unavailable")?;
        let texture: Retained<ProtocolObject<dyn MTLTexture>> =
            unsafe { msg_send![&**target, texture] };
        unsafe { super::surface::import_texture(device, texture, viewport) }
    })?;
    if !drawn || frame.expired() {
        return Ok(RenderOutcome::Retry);
    }
    let drawable = drawable.context("Terminal Metal drawable unavailable")?;
    unsafe {
        let _: () = msg_send![&*drawable, present];
    }
    Ok(RenderOutcome::Presented)
}
