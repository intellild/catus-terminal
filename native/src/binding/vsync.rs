//! Safe wrapper around the host's borrowed VSync observer.
//!
//! The raw observer and module are private to the binding module. Callers only
//! see a cloneable handle and a safe `request_animation_frame` method.
use super::ffi;
use std::{
    ffi::c_void,
    panic::{AssertUnwindSafe, catch_unwind},
    ptr,
    sync::{
        Arc,
        atomic::{AtomicPtr, AtomicU64, AtomicUsize, Ordering},
    },
};

type RawModule = ffi::lynx_extension_module_t;
type RawObserver = ffi::lynx_vsync_observer_t;

struct Inner {
    module: AtomicPtr<RawModule>,
    observer: AtomicPtr<RawObserver>,
    /// Bumped on every attach/detach so queued start tasks cannot use a stale
    /// observer.
    epoch: AtomicU64,
    next_id: AtomicUsize,
}

/// Cloneable safe handle to the current runtime's VSync observer.
pub struct VsyncObserver {
    inner: Arc<Inner>,
}

impl Clone for VsyncObserver {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl Default for VsyncObserver {
    fn default() -> Self {
        Self {
            inner: Arc::new(Inner {
                module: AtomicPtr::new(ptr::null_mut()),
                observer: AtomicPtr::new(ptr::null_mut()),
                epoch: AtomicU64::new(0),
                next_id: AtomicUsize::new(1),
            }),
        }
    }
}

impl VsyncObserver {
    pub(super) fn set_module(&self, module: *mut RawModule) {
        self.inner.module.store(module, Ordering::Release);
    }

    pub(super) fn attach(&self, observer: *mut RawObserver) {
        self.inner.epoch.fetch_add(1, Ordering::AcqRel);
        self.inner.observer.store(observer, Ordering::Release);
    }

    pub(super) fn detach(&self) {
        self.inner.epoch.fetch_add(1, Ordering::AcqRel);
        self.inner
            .observer
            .store(ptr::null_mut(), Ordering::Release);
    }

    pub(super) fn shutdown(&self) {
        self.inner.epoch.fetch_add(1, Ordering::AcqRel);
        self.inner
            .observer
            .store(ptr::null_mut(), Ordering::Release);
        self.inner.module.store(ptr::null_mut(), Ordering::Release);
    }

    /// Request one callback on the next VSync. The callback runs on BTS.
    /// Returns `false` when the runtime is detached.
    pub fn request_animation_frame(&self, callback: impl Fn(i64) + Send + Sync + 'static) -> bool {
        let module = self.inner.module.load(Ordering::Acquire);
        let observer = self.inner.observer.load(Ordering::Acquire);
        if module.is_null() || observer.is_null() {
            return false;
        }
        let request = Box::new(Request {
            inner: Arc::clone(&self.inner),
            observer,
            epoch: self.inner.epoch.load(Ordering::Acquire),
            id: self.inner.next_id.fetch_add(1, Ordering::Relaxed),
            callback: Box::new(callback),
        });
        let data = Box::into_raw(request) as *mut c_void;
        // SAFETY: module is live until the extension finalizer, and the request
        // is owned by the start task until the host callback takes it.
        unsafe {
            if ffi::lynx_extension_module_is_running_on_bts_thread(module) {
                start_request(data);
            } else {
                post_task_to_runtime(module, start_request, data);
            }
        }
        true
    }
}

struct Request {
    inner: Arc<Inner>,
    observer: *mut RawObserver,
    epoch: u64,
    id: usize,
    callback: Box<dyn Fn(i64) + Send + Sync>,
}

unsafe fn post_task_to_runtime(
    module: *mut RawModule,
    task: unsafe extern "C" fn(*mut c_void),
    data: *mut c_void,
) {
    unsafe {
        ffi::lynx_extension_module_post_task_to_runtime(module, Some(task), data);
    }
}

unsafe extern "C" fn start_request(data: *mut c_void) {
    if data.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: every path that schedules start_request transfers one Box.
        let request = unsafe { Box::from_raw(data.cast::<Request>()) };
        let observer = request.inner.observer.load(Ordering::Acquire);
        if observer.is_null()
            || observer != request.observer
            || request.inner.epoch.load(Ordering::Acquire) != request.epoch
        {
            return;
        }
        let id = request.id;
        let data = Box::into_raw(request) as *mut c_void;
        // SAFETY: the observer still matches the epoch captured at request time.
        unsafe {
            ffi::lynx_vsync_observer_request_animation_frame(observer, id, Some(on_frame), data);
        }
    }));
}

unsafe extern "C" fn on_frame(data: *mut c_void, _start: i64, target: i64) {
    if data.is_null() {
        return;
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: the host invokes this once per request with its user_data.
        let request = unsafe { Box::from_raw(data.cast::<Request>()) };
        (request.callback)(target);
    }));
}

#[cfg(test)]
#[path = "../tests/vsync.rs"]
mod tests;
