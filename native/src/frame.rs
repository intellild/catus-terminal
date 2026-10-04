//! GPU framebuffer description; no terminal or Lynx state.
#[cxx::bridge(namespace = "catus")]
mod ffi {
    #[derive(Clone, Copy, Debug, PartialEq)]
    struct Viewport {
        width: u32,
        height: u32,
        pixel_ratio: f32,
    }
    struct FrameBuffer {
        metal_texture: usize,
    }
}
pub(crate) use ffi::{FrameBuffer, Viewport};

impl Viewport {
    pub(crate) fn font_pixels(&self) -> Result<u32, String> {
        if !self.pixel_ratio.is_finite() || self.pixel_ratio <= 0. {
            return Err("Invalid backing scale".into());
        }
        Ok((14. * self.pixel_ratio).round().clamp(1., 512.) as u32)
    }
}
