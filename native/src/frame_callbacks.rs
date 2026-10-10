//! Global callback registry, independent of the frame signal source.
//! Registration and rendering happen on UI; the JS/N-API entry only posts a tick.
use std::sync::{
    Arc, LazyLock, Mutex, Weak,
    atomic::{AtomicBool, Ordering},
};

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
    pub(crate) fn set_active(&self, active: bool) {
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

#[derive(Clone)]
pub struct FrameCallbacks {
    registry: Arc<CallbackRegistry>,
}

pub(crate) fn create_frame_callbacks() -> Box<FrameCallbacks> {
    let registry = Arc::new(CallbackRegistry::default());
    FRAME_CALLBACKS
        .lock()
        .unwrap()
        .push(Arc::downgrade(&registry));
    Box::new(FrameCallbacks { registry })
}

impl FrameCallbacks {
    pub(crate) fn register(
        &self,
        render: impl Fn(i64) + Send + Sync + 'static,
    ) -> Box<FrameRegistration> {
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

    pub(crate) fn set_foreground(&self, foreground: bool) {
        self.registry
            .foreground
            .store(foreground, Ordering::Relaxed);
    }

    pub(crate) fn destroy(&self) {
        self.registry.destroyed.store(true, Ordering::Relaxed);
    }

    #[cfg(test)]
    pub(crate) fn dispatch(&self, deadline: i64, now: impl Fn() -> i64) {
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
pub(crate) fn dispatch_frame_callbacks(deadline: i64) {
    dispatch_registries(
        &FRAME_CALLBACKS,
        deadline,
        crate::platform::monotonic_now_ns,
    );
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

#[cfg(test)]
#[path = "tests/frame_callbacks.rs"]
mod tests;

pub(crate) fn expired(deadline: i64) -> bool {
    deadline <= crate::platform::monotonic_now_ns()
}
