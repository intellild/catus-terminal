//! macOS main-queue and monotonic-clock adapters.
use crate::terminal_extension::register_terminal_extension;
use std::panic::{AssertUnwindSafe, catch_unwind};

#[cxx::bridge(namespace = "catus")]
mod ffi {
    unsafe extern "C++" {
        include!("platform/macos/UiThread.h");
        fn monotonic_now_ns() -> i64;
        fn post_task_to_ui(context: usize);
    }
    extern "Rust" {
        fn dispatch_ui_task(context: usize);
        fn register_terminal_extension();
    }
}
pub(crate) use ffi::{monotonic_now_ns, post_task_to_ui};

/// Runs a boxed `FnOnce() + Send` on the UI thread. The pointer is the thin
/// pointer produced by `Box::into_raw(Box::new(task))`.
pub(crate) fn dispatch_ui_task(context: usize) {
    if context == 0 {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: post_task_to_ui transfers exactly one boxed task to this call.
        let task = unsafe { Box::from_raw(context as *mut Box<dyn FnOnce() + Send>) };
        task();
    }));
}
