//! Shared native layout description; no terminal or platform buffer state.
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

impl Viewport {
    pub(crate) fn font_pixels(&self) -> Result<u32> {
        if !self.pixel_ratio.is_finite() || self.pixel_ratio <= 0. {
            return Err(anyhow!("Invalid backing scale"));
        }
        Ok((14. * self.pixel_ratio).round().clamp(1., 512.) as u32)
    }
}
