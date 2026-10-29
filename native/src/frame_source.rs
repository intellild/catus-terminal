//! Per-view native VSync frame loops.
//!
//! The runtime exposes one borrowed VSync observer on BTS; native views live on
//! UI. Each view keeps at most one VSync request and at most one UI render
//! outstanding. When UI is still busy at the next refresh, that callback is
//! discarded instead of queued.
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
        atomic::{AtomicBool, AtomicPtr, AtomicUsize, Ordering},
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
        if !observer.is_null() {
            self.start_all();
        }
    }

    pub(crate) fn set_foreground(&self, foreground: bool) {
        // Keep each loop alive in background; the UI task skips rendering.
        self.foreground.store(foreground, Ordering::Release);
    }

    pub(crate) fn subscribe(self: &Arc<Self>, render: Render) -> Arc<ViewFrameLoop> {
        let loop_ = Arc::new(ViewFrameLoop {
            source: Arc::downgrade(self),
            render,
            active: AtomicBool::new(false),
            requested: AtomicBool::new(false),
            ui_pending: AtomicBool::new(false),
            request_id: self.next_id.fetch_add(1, Ordering::Relaxed),
        });
        self.loops
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(Arc::downgrade(&loop_));
        loop_
    }

    pub(crate) fn stop_all(&self) {
        for loop_ in self.live_loops() {
            loop_.deactivate();
        }
        self.loops
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
    }

    fn start_all(&self) {
        for loop_ in self.live_loops() {
            loop_.request();
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
        if module.is_null() || self.observer.load(Ordering::Acquire).is_null() {
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
    /// One VSync request is outstanding.
    requested: AtomicBool,
    /// One UI render is outstanding. VSync callbacks that arrive while this is
    /// true are dropped rather than queued.
    ui_pending: AtomicBool,
    request_id: usize,
}

impl ViewFrameLoop {
    pub(crate) fn set_active(self: &Arc<Self>, active: bool) {
        if self.active.swap(active, Ordering::AcqRel) == active {
            return;
        }
        if active && let Some(source) = self.source.upgrade() {
            source.schedule_start(self);
        }
    }

    fn deactivate(&self) {
        self.active.store(false, Ordering::Release);
        self.requested.store(false, Ordering::Release);
    }

    fn request(self: &Arc<Self>) {
        if !self.active.load(Ordering::Acquire) || self.requested.swap(true, Ordering::AcqRel) {
            return;
        }
        let Some(source) = self.source.upgrade() else {
            self.requested.store(false, Ordering::Release);
            return;
        };
        let observer = source.observer.load(Ordering::Acquire);
        if observer.is_null() {
            self.requested.store(false, Ordering::Release);
            return;
        }
        let data = Arc::into_raw(Arc::clone(self)) as *mut c_void;
        // SAFETY: The observer is live for this runtime, and the callback owns
        // one Arc reference passed through user_data.
        unsafe {
            request_animation_frame(observer, self.request_id, Some(on_animation_frame), data);
        }
    }

    fn on_frame(self: &Arc<Self>, target: i64) {
        self.requested.store(false, Ordering::Release);
        if !self.active.load(Ordering::Acquire) || target <= 0 {
            // A stopped or cancelled loop must not re-arm; a later attach or
            // observer change starts it again.
            return;
        }
        // Drop this refresh if the UI has not consumed the previous one.
        if self.ui_pending.swap(true, Ordering::AcqRel) {
            self.request();
            return;
        }
        let loop_ = Arc::clone(self);
        let task: Box<dyn FnOnce() + Send> = Box::new(move || {
            loop_.ui_pending.store(false, Ordering::Release);
            if !loop_.active.load(Ordering::Acquire) || expired(target) {
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
        self.request();
    }
}

unsafe extern "C" fn start_task(user_data: *mut c_void) {
    if user_data.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: schedule_start transfers exactly one Arc reference.
        let loop_ = unsafe { Arc::from_raw(user_data.cast::<ViewFrameLoop>()) };
        loop_.request();
    }));
}

unsafe extern "C" fn on_animation_frame(user_data: *mut c_void, _start: i64, target: i64) {
    if user_data.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: request transfers exactly one Arc reference per VSync request.
        let loop_ = unsafe { Arc::from_raw(user_data.cast::<ViewFrameLoop>()) };
        loop_.on_frame(target);
    }));
}

pub(crate) fn expired(deadline: i64) -> bool {
    deadline <= crate::platform::monotonic_now_ns()
}

#[cfg(test)]
#[path = "tests/frame_source.rs"]
mod tests;
