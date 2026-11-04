//! Shared native layout description; no terminal or platform buffer state.
use anyhow::{Result, anyhow};
#[cxx::bridge(namespace = "catus")]
mod ffi {
    struct CursorRect {
        x: f32,
        y: f32,
        width: f32,
        height: f32,
    }
    #[derive(Clone, Copy, Debug, PartialEq)]
    struct Viewport {
        width: u32,
        height: u32,
        pixel_ratio: f32,
    }
}
pub(crate) use ffi::{CursorRect, Viewport};

impl Viewport {
    pub(crate) fn font_pixels(&self) -> Result<u32> {
        if !self.pixel_ratio.is_finite() || self.pixel_ratio <= 0. {
            return Err(anyhow!("Invalid backing scale"));
        }
        Ok((14. * self.pixel_ratio).round().clamp(1., 512.) as u32)
    }
}

/// Drops frames whose VSync target has already passed.
pub(crate) fn expired(deadline: i64) -> bool {
    deadline <= crate::platform::monotonic_now_ns()
}
