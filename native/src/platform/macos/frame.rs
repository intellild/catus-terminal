//! macOS main-queue/clock and C++ callback-target adapters.
use crate::frame_callbacks::{FrameCallbacks, FrameRegistration, dispatch_frame_callbacks};
use crate::terminal_extension::register_terminal_extension;

#[cxx::bridge(namespace = "catus")]
mod ffi {
    unsafe extern "C++" {
        include!("common/NativeFrameCallbacks.h");
        type NativeFrameTarget;
        #[namespace = ""]
        type lynx_view_t = crate::lynx_extension::LynxView;
        type NativeFrameCallbacks;
        // Rust lifecycle tests inspect the registry retained by C++ native views.
        #[allow(dead_code)]
        fn callbacks(self: &NativeFrameCallbacks) -> &FrameCallbacks;
        unsafe fn create_native_frame_callbacks(
            view: *mut lynx_view_t,
            callbacks: Box<FrameCallbacks>,
        ) -> SharedPtr<NativeFrameCallbacks>;
        fn render_target(target: &NativeFrameTarget, deadline: i64);
        fn monotonic_now_ns() -> i64;
        fn post_frame_to_ui(deadline: i64);
    }
    extern "Rust" {
        type FrameCallbacks;
        type FrameRegistration;
        fn register_frame_callback(
            self: &FrameCallbacks,
            target: SharedPtr<NativeFrameTarget>,
        ) -> Box<FrameRegistration>;
        fn set_active(self: &FrameRegistration, active: bool);
        fn dispatch_frame_callbacks(deadline: i64);
        fn register_terminal_extension();
    }
}

// SAFETY: NativeFrameTarget protects its callback with a mutex. Rendering is
// restricted to UI by render_target; moving/dropping a shared pointer is safe.
unsafe impl Send for ffi::NativeFrameTarget {}
unsafe impl Sync for ffi::NativeFrameTarget {}

// SAFETY: The host owns an immutable view pointer and a synchronized Rust
// callback registry. C++ only dereferences the borrowed view on UI, through
// Lynx's native-view creator; moving/dropping shared ownership never uses it.
unsafe impl Send for ffi::NativeFrameCallbacks {}
unsafe impl Sync for ffi::NativeFrameCallbacks {}

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

pub(crate) use ffi::{
    NativeFrameCallbacks, create_native_frame_callbacks, monotonic_now_ns, post_frame_to_ui,
};
