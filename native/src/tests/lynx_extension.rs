use super::*;
use std::{
    cell::{Cell, RefCell},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

// A small C-host substitute: tests exercise the installed ABI callback table,
// not a parallel trait dispatcher. Each handle owns its data/finalizer.
#[derive(Clone, Copy, Default)]
pub(crate) struct Callbacks {
    pub(crate) view_create: ffi::lynx_extension_module_on_lynx_view_create_func,
    pub(crate) view_destroy: ffi::lynx_extension_module_on_lynx_view_destroy_func,
    runtime_init: ffi::lynx_extension_module_on_runtime_init_func,
    runtime_attach: ffi::lynx_extension_module_on_runtime_attach_func,
    runtime_ready: ffi::lynx_extension_module_on_runtime_ready_func,
    runtime_detach: ffi::lynx_extension_module_on_runtime_detach_func,
    pub(crate) foreground: ffi::lynx_extension_module_on_enter_foreground_func,
    pub(crate) background: ffi::lynx_extension_module_on_enter_background_func,
    pub(crate) destroy: ffi::lynx_extension_module_on_destroy_func,
}

struct HostModule {
    data: *mut c_void,
    finalizer: Option<unsafe extern "C" fn(*mut RawModule, *mut c_void)>,
    callbacks: Callbacks,
}

thread_local! {
    static FAIL_CREATE: Cell<bool> = const { Cell::new(false) };
    static REGISTRATION: RefCell<Option<Registration>> = const { RefCell::new(None) };
    static NATIVE_REGISTRATIONS: RefCell<Vec<NativeRegistration>> = const { RefCell::new(Vec::new()) };
    static FRAME_REQUESTS: RefCell<Vec<FrameRequest>> = const { RefCell::new(Vec::new()) };
}

pub(crate) struct FrameRequest {
    pub(crate) observer: usize,
    pub(crate) id: usize,
    pub(crate) callback: ffi::vsync_observer_callback,
    pub(crate) user_data: usize,
}

pub(crate) fn take_frame_requests() -> Vec<FrameRequest> {
    FRAME_REQUESTS.with(|value| std::mem::take(&mut *value.borrow_mut()))
}

pub(crate) struct Registration {
    pub(crate) name: String,
    pub(crate) creator: ffi::extension_module_creator,
    pub(crate) lazy: bool,
}

pub(crate) struct NativeRegistration {
    pub(crate) view: usize,
    pub(crate) name: String,
    pub(crate) creator: ffi::lynx_native_view_creator,
    pub(crate) opaque: usize,
}

pub(crate) fn take_registration() -> Registration {
    REGISTRATION.with(|value| value.borrow_mut().take().unwrap())
}

pub(crate) fn take_native_registrations() -> Vec<NativeRegistration> {
    NATIVE_REGISTRATIONS.with(|value| std::mem::take(&mut *value.borrow_mut()))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_env_register_extension_module(
    name: *const c_char,
    creator: ffi::extension_module_creator,
    lazy: bool,
    _opaque: *mut c_void,
) {
    REGISTRATION.with(|value| {
        *value.borrow_mut() = Some(Registration {
            name: unsafe { CStr::from_ptr(name) }
                .to_string_lossy()
                .into_owned(),
            creator,
            lazy,
        });
    });
}

#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_view_register_native_view(
    view: *mut LynxView,
    name: *const c_char,
    creator: ffi::lynx_native_view_creator,
    opaque: *mut c_void,
) {
    NATIVE_REGISTRATIONS.with(|value| {
        value.borrow_mut().push(NativeRegistration {
            view: view as usize,
            name: unsafe { CStr::from_ptr(name) }
                .to_string_lossy()
                .into_owned(),
            creator,
            opaque: opaque as usize,
        });
    });
}

#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_vsync_observer_request_animation_frame(
    observer: *mut VsyncObserver,
    id: usize,
    callback: ffi::vsync_observer_callback,
    user_data: *mut c_void,
) {
    FRAME_REQUESTS.with(|value| {
        value.borrow_mut().push(FrameRequest {
            observer: observer as usize,
            id,
            callback,
            user_data: user_data as usize,
        });
    });
}

#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_extension_module_post_task_to_runtime(
    _module: *mut RawModule,
    task: ffi::lynx_extension_module_post_task_func,
    data: *mut c_void,
) {
    if let Some(task) = task {
        unsafe { task(data) };
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_extension_module_create_with_finalizer(
    data: *mut c_void,
    finalizer: Option<unsafe extern "C" fn(*mut RawModule, *mut c_void)>,
) -> *mut RawModule {
    if FAIL_CREATE.take() {
        return std::ptr::null_mut();
    }
    Box::into_raw(Box::new(HostModule {
        data,
        finalizer,
        callbacks: Callbacks::default(),
    }))
    .cast()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_extension_module_get_user_data(raw: *mut RawModule) -> *mut c_void {
    unsafe { (*raw.cast::<HostModule>()).data }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_extension_module_unref(raw: *mut RawModule) {
    let host = unsafe { Box::from_raw(raw.cast::<HostModule>()) };
    if let Some(finalizer) = host.finalizer {
        unsafe { finalizer(raw, host.data) };
    }
}

macro_rules! binder {
    ($($name:ident, $field:ident, $callback:ty);* $(;)?) => {$(
        #[unsafe(no_mangle)]
        unsafe extern "C" fn $name(raw: *mut RawModule, callback: $callback) {
            unsafe { (*raw.cast::<HostModule>()).callbacks.$field = callback };
        }
    )*};
}
binder! {
    lynx_extension_module_bind_lynx_view_create, view_create, ffi::lynx_extension_module_on_lynx_view_create_func;
    lynx_extension_module_bind_lynx_view_destroy, view_destroy, ffi::lynx_extension_module_on_lynx_view_destroy_func;
    lynx_extension_module_bind_runtime_init, runtime_init, ffi::lynx_extension_module_on_runtime_init_func;
    lynx_extension_module_bind_runtime_attach, runtime_attach, ffi::lynx_extension_module_on_runtime_attach_func;
    lynx_extension_module_bind_runtime_ready, runtime_ready, ffi::lynx_extension_module_on_runtime_ready_func;
    lynx_extension_module_bind_runtime_detach, runtime_detach, ffi::lynx_extension_module_on_runtime_detach_func;
    lynx_extension_module_bind_enter_foreground, foreground, ffi::lynx_extension_module_on_enter_foreground_func;
    lynx_extension_module_bind_enter_background, background, ffi::lynx_extension_module_on_enter_background_func;
    lynx_extension_module_bind_on_destroy, destroy, ffi::lynx_extension_module_on_destroy_func;
}

#[derive(Default)]
struct State {
    events: Mutex<Vec<&'static str>>,
    handles: Mutex<Vec<usize>>,
    drops: AtomicUsize,
}

struct Probe(Arc<State>);

impl Probe {
    fn record(&self, name: &'static str) {
        self.0.events.lock().unwrap().push(name);
    }
}

impl Drop for Probe {
    fn drop(&mut self) {
        self.0.drops.fetch_add(1, Ordering::Relaxed);
    }
}

impl Extension for Probe {
    fn on_view_create(&self, view: NonNull<LynxView>) {
        self.record("view_create");
        self.0.handles.lock().unwrap().push(view.as_ptr() as usize);
    }
    fn on_view_destroy(&self) {
        self.record("view_destroy");
    }
    fn on_runtime_init(&self) {
        self.record("runtime_init");
    }
    fn on_runtime_attach(&self, env: napi_env, observer: *mut VsyncObserver) {
        self.record("runtime_attach");
        self.0
            .handles
            .lock()
            .unwrap()
            .extend([env as usize, observer as usize]);
    }
    fn on_runtime_ready(&self, env: napi_env, lynx: napi_value, url: &CStr) {
        assert_eq!(url, c"file:///terminal");
        self.record("runtime_ready");
        self.0
            .handles
            .lock()
            .unwrap()
            .extend([env as usize, lynx as usize]);
    }
    fn on_runtime_detach(&self) {
        self.record("runtime_detach");
    }
    fn on_enter_foreground(&self) {
        self.record("foreground");
    }
    fn on_enter_background(&self) {
        self.record("background");
    }
    fn on_destroy(&self) {
        self.record("destroy");
    }
}

pub(crate) unsafe fn callbacks(raw: *mut RawModule) -> Callbacks {
    unsafe { (*raw.cast::<HostModule>()).callbacks }
}

pub(crate) unsafe fn with_extension<T, R>(raw: *mut RawModule, inspect: impl FnOnce(&T) -> R) -> R {
    inspect(unsafe { &*lynx_extension_module_get_user_data(raw).cast::<T>() })
}

pub(crate) unsafe fn release(raw: *mut RawModule) {
    unsafe { lynx_extension_module_unref(raw) };
}

#[test]
fn binds_all_lifecycle_callbacks_and_preserves_borrowed_arguments() {
    let state = Arc::new(State::default());
    let module = Module::new(Probe(state.clone())).unwrap();
    let raw = module.into_raw();
    assert_eq!(state.drops.load(Ordering::Relaxed), 0);
    let view = NonNull::<LynxView>::dangling().as_ptr();
    let env = NonNull::<u8>::dangling().as_ptr().cast();
    let observer = NonNull::<VsyncObserver>::dangling().as_ptr();
    let value = NonNull::<u16>::dangling().as_ptr().cast();
    unsafe {
        let callbacks = callbacks(raw);
        callbacks.view_create.unwrap()(raw, view);
        callbacks.runtime_init.unwrap()(raw);
        callbacks.runtime_attach.unwrap()(raw, env, observer);
        callbacks.runtime_ready.unwrap()(raw, env, value, c"file:///terminal".as_ptr());
        callbacks.background.unwrap()(raw);
        callbacks.foreground.unwrap()(raw);
        callbacks.runtime_detach.unwrap()(raw);
        callbacks.view_destroy.unwrap()(raw);
        callbacks.destroy.unwrap()(raw);
    }
    assert_eq!(
        *state.events.lock().unwrap(),
        [
            "view_create",
            "runtime_init",
            "runtime_attach",
            "runtime_ready",
            "background",
            "foreground",
            "runtime_detach",
            "view_destroy",
            "destroy",
        ]
    );
    assert_eq!(
        *state.handles.lock().unwrap(),
        [
            view as usize,
            env as usize,
            observer as usize,
            env as usize,
            value as usize
        ]
    );
    // on_destroy is a notification; only the finalizer releases Rust ownership.
    assert_eq!(state.drops.load(Ordering::Relaxed), 0);
    unsafe { ffi::lynx_extension_module_unref(raw) };
    assert_eq!(state.drops.load(Ordering::Relaxed), 1);
}

#[test]
fn default_methods_and_two_concrete_types_keep_instances_isolated() {
    struct Other(Arc<AtomicUsize>);
    impl Extension for Other {
        fn on_enter_foreground(&self) {
            self.0.fetch_add(1, Ordering::Relaxed);
        }
    }
    let state = Arc::new(State::default());
    let count = Arc::new(AtomicUsize::new(0));
    let probe = Module::new(Probe(state.clone())).unwrap();
    let other = Module::new(Other(count.clone())).unwrap();
    unsafe {
        callbacks(other.raw.as_ptr()).foreground.unwrap()(other.raw.as_ptr());
        callbacks(other.raw.as_ptr()).destroy.unwrap()(other.raw.as_ptr());
        callbacks(probe.raw.as_ptr()).foreground.unwrap()(probe.raw.as_ptr());
    }
    assert_eq!(count.load(Ordering::Relaxed), 1);
    assert_eq!(*state.events.lock().unwrap(), ["foreground"]);
    drop(probe);
    assert_eq!(state.drops.load(Ordering::Relaxed), 1);
}

#[test]
fn failed_creation_releases_the_untransferred_box() {
    let state = Arc::new(State::default());
    FAIL_CREATE.set(true);
    assert!(Module::new(Probe(state.clone())).is_err());
    assert_eq!(state.drops.load(Ordering::Relaxed), 1);
}

#[test]
fn panics_in_callbacks_and_finalizers_do_not_unwind_across_c() {
    struct Panicking(Arc<AtomicUsize>);
    impl Extension for Panicking {
        fn on_enter_background(&self) {
            panic!("callback panic");
        }
        fn on_enter_foreground(&self) {
            self.0.fetch_add(1, Ordering::Relaxed);
        }
    }
    impl Drop for Panicking {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::Relaxed);
            panic!("finalizer panic");
        }
    }
    let count = Arc::new(AtomicUsize::new(0));
    let module = Module::new(Panicking(count.clone())).unwrap();
    unsafe {
        let callbacks = callbacks(module.raw.as_ptr());
        callbacks.background.unwrap()(module.raw.as_ptr());
        callbacks.foreground.unwrap()(module.raw.as_ptr());
    }
    assert_eq!(count.load(Ordering::Relaxed), 1);
    drop(module);
    assert_eq!(count.load(Ordering::Relaxed), 2);
}
