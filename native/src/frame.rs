//! Borrowed native framebuffer and layout description; no terminal state.
use anyhow::{Result, anyhow};
#[cxx::bridge(namespace = "catus")]
mod ffi {
    #[derive(Clone, Copy, Debug, PartialEq)]
    struct Viewport {
        width: u32,
        height: u32,
        pixel_ratio: f32,
    }
}
pub(crate) use ffi::Viewport;

// macOS IOSurfaceRef, borrowed exclusively for the synchronous render call.
pub(crate) struct FrameBuffer {
    pub iosurface: usize,
}

impl Viewport {
    pub(crate) fn font_pixels(&self) -> Result<u32> {
        if !self.pixel_ratio.is_finite() || self.pixel_ratio <= 0. {
            return Err(anyhow!("Invalid backing scale"));
        }
        Ok((14. * self.pixel_ratio).round().clamp(1., 512.) as u32)
    }
}
