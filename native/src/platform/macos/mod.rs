//! Metal/IOSurface, CoreText font policy and Lynx main-queue integration.

mod font;
mod frame;
mod input_view;
mod surface;
mod terminal;
mod view;

pub(crate) const GPU_BACKENDS: wgpu::Backends = wgpu::Backends::METAL;
pub(crate) use font::load_font_size;
pub(crate) use frame::{monotonic_now_ns, post_frame_to_ui};
#[cfg(feature = "native-input-tests")]
pub(crate) fn run_native_input_tests() {
    input_view::run_native_input_tests();
    view::run_view_lifecycle_tests();
}
#[cfg(test)]
pub(crate) use surface::test_support;
