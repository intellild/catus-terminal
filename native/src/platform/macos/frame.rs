//! macOS main-queue and monotonic-clock adapters.
use crate::terminal_extension::register_terminal_extension;
use std::{
    ffi::c_void,
    panic::{AssertUnwindSafe, catch_unwind},
};

#[cxx::bridge(namespace = "catus")]
mod ffi {
    unsafe extern "C++" {
        include!("platform/macos/UiThread.h");
        fn monotonic_now_ns() -> i64;
    }
    extern "Rust" {
        fn register_terminal_extension();
    }
}
pub(crate) use ffi::monotonic_now_ns;

type DispatchQueue = *mut c_void;

unsafe extern "C" {
    /// Exported main queue object. `dispatch_get_main_queue` is an inline
    /// function in the SDK header, so Rust references the queue directly.
    static _dispatch_main_q: u8;
    fn dispatch_async_f(
        queue: DispatchQueue,
        context: *mut c_void,
        work: unsafe extern "C" fn(*mut c_void),
    );
}

/// Enqueue a boxed `FnOnce() + Send` on the main queue. The context is the thin
/// pointer produced by `Box::into_raw(Box::new(task))`.
pub(crate) fn post_task_to_ui(context: usize) {
    let context = context as *mut c_void;
    if context.is_null() {
        return;
    }
    // SAFETY: libdispatch copies the context pointer and invokes the callback on
    // the main queue. dispatch_ui_task takes ownership of exactly that box.
    unsafe {
        let queue = std::ptr::addr_of!(_dispatch_main_q) as DispatchQueue;
        dispatch_async_f(queue, context, dispatch_ui_task);
    }
}

unsafe extern "C" fn dispatch_ui_task(context: *mut c_void) {
    if context.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: post_task_to_ui transfers exactly one boxed task to this call.
        let task = unsafe { Box::from_raw(context.cast::<Box<dyn FnOnce() + Send>>()) };
        task();
    }));
}
