//! macOS main-queue/clock and C++ callback-target adapters.
use crate::frame_callbacks::{
    FrameCallbacks, FrameRegistration, create_frame_callbacks, dispatch_frame_callbacks,
};

#[cxx::bridge(namespace = "catus")]
mod ffi {
    unsafe extern "C++" {
        include!("NativeFrameCallbacks.h");
        type NativeFrameTarget;
        fn render_target(target: &NativeFrameTarget, deadline: i64);
        fn monotonic_now_ns() -> i64;
        fn post_frame_to_ui(deadline: i64);
    }
    extern "Rust" {
        type FrameCallbacks;
        type FrameRegistration;
        fn create_frame_callbacks() -> Box<FrameCallbacks>;
        fn register_frame_callback(
            self: &FrameCallbacks,
            target: SharedPtr<NativeFrameTarget>,
        ) -> Box<FrameRegistration>;
        fn set_active(self: &FrameRegistration, active: bool);
        fn set_foreground(self: &FrameCallbacks, foreground: bool);
        fn destroy(self: &FrameCallbacks);
        fn dispatch_frame_callbacks(deadline: i64);
    }
}

// SAFETY: NativeFrameTarget protects its callback with a mutex. Rendering is
// restricted to UI by render_target; moving/dropping a shared pointer is safe.
unsafe impl Send for ffi::NativeFrameTarget {}
unsafe impl Sync for ffi::NativeFrameTarget {}

impl FrameCallbacks {
    fn register_frame_callback(
        &self,
        target: cxx::SharedPtr<ffi::NativeFrameTarget>,
    ) -> Box<FrameRegistration> {
        self.register(move |deadline| {
            if let Some(target) = target.as_ref() {
                ffi::render_target(target, deadline);
            }
        })
    }
}

pub(crate) use ffi::{monotonic_now_ns, post_frame_to_ui};
