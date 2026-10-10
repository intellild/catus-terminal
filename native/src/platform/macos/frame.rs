//! macOS main-queue and monotonic-clock adapters.
use crate::frame_callbacks::dispatch_frame_callbacks;
use crate::terminal_extension::register_terminal_extension;

#[cxx::bridge(namespace = "catus")]
mod ffi {
    unsafe extern "C++" {
        include!("platform/macos/UiThread.h");
        fn monotonic_now_ns() -> i64;
        fn post_frame_to_ui(deadline: i64);
    }
    extern "Rust" {
        fn dispatch_frame_callbacks(deadline: i64);
        fn register_terminal_extension();
    }
}
pub(crate) use ffi::{monotonic_now_ns, post_frame_to_ui};
