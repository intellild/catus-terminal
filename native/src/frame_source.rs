//! Per-view native VSync frame loops.
//!
//! The runtime exposes one borrowed VSync observer on BTS; native views live on
//! UI. Each view subscribes its own loop, and the start/stop transitions are
//! posted to BTS. A loop keeps at most one request outstanding, and each VSync
//! callback posts only that view's render to the UI queue.
use crate::{
    binding::extension::{RawModule, VsyncObserver, post_task_to_runtime, request_animation_frame},
    platform::post_task_to_ui,
};
use std::{
    ffi::c_void,
    panic::{AssertUnwindSafe, catch_unwind},
    ptr,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, AtomicPtr, AtomicU64, AtomicUsize, Ordering},
    },
};

type Render = Box<dyn Fn(i64) + Send + Sync>;

pub(crate) struct NativeFrameSource {
    observer: AtomicPtr<VsyncObserver>,
    module: AtomicPtr<RawModule>,
    foreground: AtomicBool,
    next_id: AtomicUsize,
    loops: Mutex<Vec<Weak<ViewFrameLoop>>>,
}

impl Default for NativeFrameSource {
    fn default() -> Self {
        Self {
            observer: AtomicPtr::new(ptr::null_mut()),
            module: AtomicPtr::new(ptr::null_mut()),
            foreground: AtomicBool::new(true),
            next_id: AtomicUsize::new(1),
            loops: Mutex::new(Vec::new()),
        }
    }
}

impl NativeFrameSource {
    pub(crate) fn set_module(&self, module: *mut RawModule) {
        self.module.store(module, Ordering::Release);
        if !module.is_null() && !self.observer.load(Ordering::Acquire).is_null() {
            self.start_all();
        }
    }

    pub(crate) fn set_observer(&self, observer: *mut VsyncObserver) {
        self.observer.store(observer, Ordering::Release);
        if observer.is_null() {
            self.cancel_all();
        } else {
            self.start_all();
        }
    }

    pub(crate) fn set_foreground(&self, foreground: bool) {
        // Keep each view's loop alive while the app is in background; the UI
        // task skips rendering, so a missing foreground callback cannot strand
        // the renderer permanently.
        self.foreground.store(foreground, Ordering::Release);
    }

    pub(crate) fn subscribe(self: &Arc<Self>, render: Render) -> Arc<ViewFrameLoop> {
        let loop_ = Arc::new(ViewFrameLoop {
            source: Arc::downgrade(self),
            render,
            active: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            in_flight: AtomicU64::new(0),
            request_id: self.next_id.fetch_add(1, Ordering::Relaxed),
        });
        self.loops
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(Arc::downgrade(&loop_));
        loop_
    }

    /// Cancel pending work and drop the loop list. Called once when the window
    /// and its module are going away.
    pub(crate) fn stop_all(&self) {
        self.cancel_all();
        self.loops
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
    }

    fn cancel_all(&self) {
        for loop_ in self.live_loops() {
            loop_.cancel();
        }
    }

    fn start_all(&self) {
        for loop_ in self.live_loops() {
            if loop_.active.load(Ordering::Acquire) {
                self.schedule_start(&loop_);
            }
        }
    }

    fn live_loops(&self) -> Vec<Arc<ViewFrameLoop>> {
        let mut loops = self
            .loops
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        loops.retain(|loop_| loop_.strong_count() > 0);
        loops.iter().filter_map(Weak::upgrade).collect()
    }

    fn schedule_start(&self, loop_: &Arc<ViewFrameLoop>) {
        let module = self.module.load(Ordering::Acquire);
        let observer = self.observer.load(Ordering::Acquire);
        if module.is_null() || observer.is_null() {
            return;
        }
        let data = Arc::into_raw(Arc::clone(loop_)) as *mut c_void;
        // SAFETY: module is live until the extension finalizer, and the task
        // owns one Arc reference passed through user_data.
        unsafe {
            post_task_to_runtime(module, start_task, data);
        }
    }
}

pub(crate) struct ViewFrameLoop {
    source: Weak<NativeFrameSource>,
    render: Render,
    active: AtomicBool,
    /// Incremented on every start/stop transition. Callbacks from older
    /// generations bail out instead of re-arming a stopped loop.
    generation: AtomicU64,
    /// Generation of the outstanding VSync request, or 0 when none is pending.
    in_flight: AtomicU64,
    request_id: usize,
}

struct FrameRequest {
    loop_: Arc<ViewFrameLoop>,
    generation: u64,
}

impl ViewFrameLoop {
    pub(crate) fn set_active(self: &Arc<Self>, active: bool) {
        if self.active.swap(active, Ordering::AcqRel) == active {
            return;
        }
        self.generation.fetch_add(1, Ordering::AcqRel);
        self.in_flight.store(0, Ordering::Release);
        if active && let Some(source) = self.source.upgrade() {
            source.schedule_start(self);
        }
    }

    fn cancel(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
        self.in_flight.store(0, Ordering::Release);
    }

    fn start_on_bts(self: &Arc<Self>) {
        if !self.active.load(Ordering::Acquire) {
            return;
        }
        let Some(source) = self.source.upgrade() else {
            return;
        };
        let observer = source.observer.load(Ordering::Acquire);
        if observer.is_null() {
            return;
        }
        let generation = self.generation.load(Ordering::Acquire);
        if self.in_flight.load(Ordering::Acquire) == generation {
            return;
        }
        self.in_flight.store(generation, Ordering::Release);
        let request = Box::new(FrameRequest {
            loop_: Arc::clone(self),
            generation,
        });
        let data = Box::into_raw(request) as *mut c_void;
        // SAFETY: The observer is live for this runtime, and the callback owns
        // the boxed request passed through user_data.
        unsafe {
            request_animation_frame(observer, self.request_id, Some(on_animation_frame), data);
        }
    }

    fn handle_frame(self: &Arc<Self>, generation: u64, target: i64) {
        if self.generation.load(Ordering::Acquire) != generation {
            return;
        }
        if self
            .in_flight
            .compare_exchange(generation, 0, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        if target <= 0 || !self.active.load(Ordering::Acquire) {
            return;
        }
        let loop_ = Arc::clone(self);
        let task: Box<dyn FnOnce() + Send> = Box::new(move || {
            if !loop_.active.load(Ordering::Acquire)
                || loop_.generation.load(Ordering::Acquire) != generation
            {
                return;
            }
            if let Some(source) = loop_.source.upgrade()
                && !source.foreground.load(Ordering::Acquire)
            {
                return;
            }
            (loop_.render)(target);
        });
        post_task_to_ui(Box::into_raw(Box::new(task)) as usize);
        self.start_on_bts();
    }
}

unsafe extern "C" fn start_task(user_data: *mut c_void) {
    if user_data.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: schedule_start transfers exactly one Arc reference.
        let loop_ = unsafe { Arc::from_raw(user_data.cast::<ViewFrameLoop>()) };
        loop_.start_on_bts();
    }));
}

unsafe extern "C" fn on_animation_frame(user_data: *mut c_void, _start: i64, target: i64) {
    if user_data.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: start_on_bts transfers exactly one boxed request per RAF.
        let request = unsafe { Box::from_raw(user_data.cast::<FrameRequest>()) };
        request.loop_.handle_frame(request.generation, target);
    }));
}

pub(crate) fn expired(deadline: i64) -> bool {
    deadline <= crate::platform::monotonic_now_ns()
}

#[cfg(test)]
#[path = "tests/frame_source.rs"]
mod tests;
