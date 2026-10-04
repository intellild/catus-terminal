//! Global callback registry, independent of the frame signal source.
//! Registration and rendering happen on UI; the JS/N-API entry only posts a tick.
use std::sync::{
    Arc, LazyLock, Mutex, Weak,
    atomic::{AtomicBool, Ordering},
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

static FRAME_CALLBACKS: LazyLock<Mutex<Vec<Weak<CallbackRegistry>>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

struct Callback {
    active: AtomicBool,
    render: Box<dyn Fn(i64) + Send + Sync>,
}

pub struct FrameRegistration {
    callback: Arc<Callback>,
}

impl FrameRegistration {
    fn set_active(&self, active: bool) {
        self.callback.active.store(active, Ordering::Relaxed);
    }
}

// Each Lynx view owns a registry; the process-wide object dispatches to all
// live registries without keeping windows or callback registrations alive.
struct CallbackRegistry {
    callbacks: Mutex<Vec<Weak<Callback>>>,
    foreground: AtomicBool,
    destroyed: AtomicBool,
}

impl Default for CallbackRegistry {
    fn default() -> Self {
        Self {
            callbacks: Mutex::new(Vec::new()),
            foreground: AtomicBool::new(true),
            destroyed: AtomicBool::new(false),
        }
    }
}

pub struct FrameCallbacks {
    registry: Arc<CallbackRegistry>,
}

fn create_frame_callbacks() -> Box<FrameCallbacks> {
    let registry = Arc::new(CallbackRegistry::default());
    FRAME_CALLBACKS
        .lock()
        .unwrap()
        .push(Arc::downgrade(&registry));
    Box::new(FrameCallbacks { registry })
}

impl FrameCallbacks {
    fn register(&self, render: impl Fn(i64) + Send + Sync + 'static) -> Box<FrameRegistration> {
        let callback = Arc::new(Callback {
            active: AtomicBool::new(false),
            render: Box::new(render),
        });
        self.registry
            .callbacks
            .lock()
            .unwrap()
            .push(Arc::downgrade(&callback));
        Box::new(FrameRegistration { callback })
    }

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

    fn set_foreground(&self, foreground: bool) {
        self.registry
            .foreground
            .store(foreground, Ordering::Relaxed);
    }

    fn destroy(&self) {
        self.registry.destroyed.store(true, Ordering::Relaxed);
    }

    #[cfg(test)]
    fn dispatch(&self, deadline: i64, now: impl Fn() -> i64) {
        self.registry.dispatch(deadline, now);
    }
}

impl CallbackRegistry {
    fn enabled(&self) -> bool {
        self.foreground.load(Ordering::Relaxed) && !self.destroyed.load(Ordering::Relaxed)
    }

    fn dispatch(&self, deadline: i64, now: impl Fn() -> i64) {
        if !self.enabled() {
            return;
        }
        // Snapshot registrations, never frames; callbacks may change registrations.
        let callbacks: Vec<_> = {
            let mut registrations = self.callbacks.lock().unwrap();
            registrations.retain(|callback| callback.strong_count() > 0);
            registrations.iter().filter_map(Weak::upgrade).collect()
        };
        for callback in callbacks {
            if deadline <= now() || !self.enabled() {
                break;
            }
            if Arc::strong_count(&callback) > 1 && callback.active.load(Ordering::Relaxed) {
                (callback.render)(deadline);
            }
        }
    }
}

// Runs on UI. Future native frame sources can call the same function directly.
fn dispatch_frame_callbacks(deadline: i64) {
    dispatch_registries(&FRAME_CALLBACKS, deadline, ffi::monotonic_now_ns);
}

fn dispatch_registries(
    registry: &Mutex<Vec<Weak<CallbackRegistry>>>,
    deadline: i64,
    now: impl Fn() -> i64,
) {
    let registries: Vec<_> = {
        let mut registrations = registry.lock().unwrap();
        registrations.retain(|registry| registry.strong_count() > 0);
        registrations.iter().filter_map(Weak::upgrade).collect()
    };
    for registry in registries {
        if deadline <= now() {
            break;
        }
        registry.dispatch(deadline, &now);
    }
}

pub(crate) use ffi::{monotonic_now_ns, post_frame_to_ui};

#[cfg(test)]
#[path = "tests/frame_callbacks.rs"]
mod tests;

pub(crate) fn expired(deadline: i64) -> bool {
    deadline <= ffi::monotonic_now_ns()
}
