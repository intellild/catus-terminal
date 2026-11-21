//! Metal/IOSurface, CoreText font policy and Lynx main-queue integration.

mod font;
mod frame;
mod input_view;
mod mouse;
pub(crate) use mouse::MouseState;
mod native_view;
mod osr;
mod surface;
mod terminal;
mod view;
mod visibility;
pub(crate) use native_view::create_terminal_platform;
pub(crate) use view::MacTerminalView as TerminalPlatform;

pub(crate) const GPU_BACKENDS: wgpu::Backends = wgpu::Backends::METAL;
pub(crate) use font::load_font_size;
pub(crate) use frame::{monotonic_now_ns, post_task_to_ui};
