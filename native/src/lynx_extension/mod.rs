//! Generic Rust lifecycle adapter for the public Lynx extension C API.
//!
//! `register<T>` installs a factory which creates a concrete Rust extension,
//! binds its lifecycle callbacks and transfers the initial C reference to Lynx.
//! The host supplies the C symbols; this is not a standalone Node capability.
mod ffi;

use std::{
    ffi::{CStr, c_char, c_void},
    marker::PhantomData,
    panic::{AssertUnwindSafe, catch_unwind},
    ptr::NonNull,
    rc::Rc,
};

use anyhow::{Result, bail};
use napi::sys::{napi_env, napi_value};

pub use ffi::{LynxView, RawModule, VsyncObserver};
pub(crate) use ffi::{catus_create_native_terminal_view, lynx_view_register_native_view};

/// Register a concrete extension factory. The name is retained by the host, so
/// it must have static storage. Each created module owns a fresh `T::default()`.
pub fn register<T: Extension + Default>(name: &'static CStr, lazy: bool) {
    // SAFETY: The factory has the SDK signature; its opaque argument is unused.
    unsafe {
        ffi::lynx_env_register_extension_module(
            name.as_ptr(),
            Some(create::<T>),
            lazy,
            std::ptr::null_mut(),
        );
    }
}

unsafe extern "C" fn create<T: Extension + Default>(_opaque: *mut c_void) -> *mut RawModule {
    let mut raw = std::ptr::null_mut();
    contain_panic(|| match Module::new(T::default()) {
        Ok(module) => raw = module.into_raw(),
        Err(error) => eprintln!("Create Rust Lynx extension: {error:#}"),
    });
    raw
}

/// Callbacks may run on different Lynx threads, so state must use interior
/// synchronization. UI callbacks run on UI; runtime attach/ready/detach run on
/// BTS. Opaque view, observer and N-API handles are borrowed from the host and
/// must only be used on their owning thread while valid. Foreground/background
/// refer to application visibility, not the JavaScript thread model.
pub trait Extension: Send + Sync + 'static {
    fn on_view_create(&self, _view: NonNull<LynxView>) {}
    fn on_view_destroy(&self) {}
    fn on_runtime_init(&self) {}
    fn on_runtime_attach(&self, _env: napi_env, _observer: *mut VsyncObserver) {}
    fn on_runtime_ready(&self, _env: napi_env, _lynx: napi_value, _url: &CStr) {}
    fn on_runtime_detach(&self) {}
    fn on_enter_foreground(&self) {}
    fn on_enter_background(&self) {}
    /// Lifecycle notification only. Rust storage is released by the C finalizer.
    fn on_destroy(&self) {}
}

/// Owns the initial C reference until transferred to Lynx via `into_raw`.
/// No `dyn Extension` is stored: each callback is monomorphized for its type.
#[must_use]
pub struct Module {
    raw: NonNull<RawModule>,
    // The owner stays on its creation thread. Only host-dispatched callbacks
    // borrow the synchronized extension on UI/BTS.
    _thread: PhantomData<Rc<()>>,
}

impl Module {
    pub fn new<T: Extension>(extension: T) -> Result<Self> {
        let data = Box::into_raw(Box::new(extension));
        // SAFETY: The C API takes opaque data and retains it until finalization.
        let raw = unsafe {
            ffi::lynx_extension_module_create_with_finalizer(data.cast(), Some(finalize::<T>))
        };
        let Some(raw) = NonNull::new(raw) else {
            // SAFETY: Failed creation did not transfer ownership to the host.
            unsafe { drop(Box::from_raw(data)) };
            bail!("Create Lynx extension module");
        };
        // SAFETY: The handle is live, owns Box<T>, and every callback uses T.
        unsafe { bind::<T>(raw.as_ptr()) };
        Ok(Self {
            raw,
            _thread: PhantomData,
        })
    }

    /// Transfer the initial reference to the host extension factory. The host
    /// must eventually unref it; otherwise both the handle and extension leak.
    pub fn into_raw(self) -> *mut RawModule {
        let raw = self.raw.as_ptr();
        std::mem::forget(self);
        raw
    }
}

impl Drop for Module {
    fn drop(&mut self) {
        // SAFETY: The wrapper owns exactly one live C reference.
        unsafe { ffi::lynx_extension_module_unref(self.raw.as_ptr()) };
    }
}

fn contain_panic(operation: impl FnOnce()) {
    if let Err(payload) = catch_unwind(AssertUnwindSafe(operation)) {
        eprintln!("Rust Lynx extension callback panicked");
        // A custom panic payload may itself panic in Drop. Never unwind through C.
        std::mem::forget(payload);
    }
}

unsafe fn dispatch<T: Extension>(raw: *mut RawModule, callback: impl FnOnce(&T)) {
    if raw.is_null() {
        return;
    }
    contain_panic(|| {
        // SAFETY: bind<T> only installs these callbacks on a live module owning T.
        let data = unsafe { ffi::lynx_extension_module_get_user_data(raw) }.cast::<T>();
        if let Some(extension) = unsafe { data.as_ref() } {
            callback(extension);
        }
    });
}

unsafe extern "C" fn finalize<T: Extension>(_raw: *mut RawModule, data: *mut c_void) {
    if !data.is_null() {
        contain_panic(|| {
            // SAFETY: C calls the finalizer once after its final reference drops.
            unsafe { drop(Box::from_raw(data.cast::<T>())) };
        });
    }
}

macro_rules! lifecycle {
    ($($callback:ident => $method:ident, $binder:ident);* $(;)?) => {
        $(unsafe extern "C" fn $callback<T: Extension>(raw: *mut RawModule) {
            // SAFETY: The host calls this only for the module bound to T.
            unsafe { dispatch::<T>(raw, |extension| extension.$method()) };
        })*

        unsafe fn bind<T: Extension>(raw: *mut RawModule) {
            // SAFETY: All function pointers have SDK signatures and share Box<T>.
            unsafe {
                $(ffi::$binder(raw, Some($callback::<T>));)*
                ffi::lynx_extension_module_bind_lynx_view_create(raw, Some(view_create::<T>));
                ffi::lynx_extension_module_bind_runtime_attach(raw, Some(runtime_attach::<T>));
                ffi::lynx_extension_module_bind_runtime_ready(raw, Some(runtime_ready::<T>));
            }
        }
    };
}

lifecycle! {
    view_destroy => on_view_destroy, lynx_extension_module_bind_lynx_view_destroy;
    runtime_init => on_runtime_init, lynx_extension_module_bind_runtime_init;
    runtime_detach => on_runtime_detach, lynx_extension_module_bind_runtime_detach;
    enter_foreground => on_enter_foreground, lynx_extension_module_bind_enter_foreground;
    enter_background => on_enter_background, lynx_extension_module_bind_enter_background;
    destroy => on_destroy, lynx_extension_module_bind_on_destroy;
}

unsafe extern "C" fn view_create<T: Extension>(raw: *mut RawModule, view: *mut LynxView) {
    if let Some(view) = NonNull::new(view) {
        // SAFETY: The host provides a live, borrowed view for this callback.
        unsafe { dispatch::<T>(raw, |extension| extension.on_view_create(view)) };
    }
}

unsafe extern "C" fn runtime_attach<T: Extension>(
    raw: *mut RawModule,
    env: napi_env,
    observer: *mut VsyncObserver,
) {
    // SAFETY: The host supplies borrowed runtime handles for this callback.
    unsafe { dispatch::<T>(raw, |extension| extension.on_runtime_attach(env, observer)) };
}

unsafe extern "C" fn runtime_ready<T: Extension>(
    raw: *mut RawModule,
    env: napi_env,
    lynx: napi_value,
    url: *const c_char,
) {
    if !url.is_null() {
        // SAFETY: The SDK passes a NUL-terminated URL valid until callback return.
        let url = unsafe { CStr::from_ptr(url) };
        unsafe { dispatch::<T>(raw, |extension| extension.on_runtime_ready(env, lynx, url)) };
    }
}

#[cfg(test)]
#[path = "../tests/lynx_extension.rs"]
pub(crate) mod tests;
