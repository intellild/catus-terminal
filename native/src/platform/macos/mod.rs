//! Metal/IOSurface, CoreText font policy and Lynx main-queue integration.

mod font;
mod frame;
mod surface;
mod terminal;

pub(crate) const GPU_BACKENDS: wgpu::Backends = wgpu::Backends::METAL;
pub(crate) use font::load_font_size;
pub(crate) use frame::{monotonic_now_ns, post_frame_to_ui};
#[cfg(test)]
pub(crate) use surface::test_support;
