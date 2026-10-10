//! Generic, UI-thread Rust adapter for Lynx's bindgen-generated native view API.
//! `View` owns the initial host reference; release (not destroy) frees Rust state.
pub use super::{
    types::{InvokeStatus, MotionEvent, SurfaceBufferMode},
    value::Value,
};

use crate::binding::{
    extension::LynxView,
    ffi,
    protocol::{ElementName, Event, Method},
};
use anyhow::{Context, Result, bail, ensure};
use std::{
    ffi::{CStr, c_char, c_void},
    marker::PhantomData,
    panic::{AssertUnwindSafe, catch_unwind},
    ptr::NonNull,
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    thread::{self, ThreadId},
};

pub use ffi::{lynx_native_view_t as RawView, lynx_surface_handle_t as RawSurface};

#[derive(Clone, Copy, Debug)]
pub struct Layout {
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub height: f32,
    pub pixel_ratio: f32,
}

pub struct Reply {
    pub status: InvokeStatus,
    pub value: Value,
}
impl Reply {
    pub fn success(value: Value) -> Self {
        Self {
            status: InvokeStatus::Success,
            value,
        }
    }
    pub fn method_not_found() -> Self {
        Self {
            status: InvokeStatus::MethodNotFound,
            value: Value::null(),
        }
    }
    fn error(error: anyhow::Error) -> Self {
        Self {
            status: InvokeStatus::InvalidState,
            value: Value::text(&format!("{error:#}")).unwrap_or_else(|_| Value::null()),
        }
    }
}

/// UI-only callbacks permit AppKit objects and non-Send interior state. Host
/// callbacks, creation and final release must run on the creation/UI thread.
pub trait NativeView: Sized + 'static {
    fn on_create(&self) -> Result<bool> {
        Ok(true)
    }
    fn on_attach(&self) -> Result<()> {
        Ok(())
    }
    fn on_detach(&self) -> Result<()> {
        Ok(())
    }
    fn on_destroy(&self) -> Result<()> {
        Ok(())
    }
    fn on_layout_changed(&self, _layout: Layout) -> Result<()> {
        Ok(())
    }
    fn on_properties_changed(&self, _attrs: &Value, _events: &Value) -> Result<()> {
        Ok(())
    }
    fn on_motion_event(&self, _event: &MotionEvent) -> Result<()> {
        Ok(())
    }
    fn on_focus_changed(&self, _focused: bool, _leaf: bool) -> Result<()> {
        Ok(())
    }
    fn on_method_invoked(&self, _method: Method, _params: &Value) -> Result<Reply> {
        Ok(Reply::method_not_found())
    }
    fn surface_buffer_mode(&self) -> SurfaceBufferMode {
        SurfaceBufferMode::Double
    }
    fn is_scroll_enabled(&self) -> bool {
        false
    }
    fn is_surface_enabled(&self) -> bool {
        false
    }
}

pub trait ViewFactory: NativeView {
    type Context: 'static;
    fn create(handle: Handle, target: Target<Self>, context: &Self::Context) -> Result<Self>;
}

/// # Safety
/// The view is live on UI. `context` must outlive all calls to the registered
/// creator (normally owned by that view's extension until window destruction).
pub unsafe fn register<T: ViewFactory>(
    view: NonNull<LynxView>,
    name: ElementName,
    context: &T::Context,
) {
    unsafe {
        ffi::lynx_view_register_native_view(
            view.as_ptr(),
            name.as_cstr().as_ptr(),
            Some(create::<T>),
            (context as *const T::Context).cast_mut().cast(),
        );
    }
}
unsafe extern "C" fn create<T: ViewFactory>(context: *mut c_void) -> *mut RawView {
    match guard(|| {
        let context = unsafe { context.cast::<T::Context>().as_ref() }
            .context("Missing native view context")?;
        View::new(|handle, target| T::create(handle, target, context))
    }) {
        Ok(view) => view.into_raw(),
        Err(error) => {
            eprintln!("Create Rust Lynx native view: {error:#}");
            std::ptr::null_mut()
        }
    }
}

struct State {
    thread: ThreadId,
    raw: AtomicUsize,
    data: AtomicUsize,
}
impl State {
    fn check_thread(&self) -> Result<()> {
        ensure!(
            thread::current().id() == self.thread,
            "Native view accessed outside its UI thread"
        );
        Ok(())
    }
    fn raw(&self) -> Result<NonNull<RawView>> {
        self.check_thread()?;
        NonNull::new(self.raw.load(Ordering::Relaxed) as *mut RawView)
            .context("Native view has been released")
    }
}

/// Borrowed operations handle; cloning does not retain the native view. Every
/// operation checks both the creation thread and final-release invalidation.
#[derive(Clone)]
pub struct Handle {
    state: Arc<State>,
    _thread: PhantomData<Rc<()>>,
}
impl Handle {
    pub fn as_ptr(&self) -> Result<NonNull<RawView>> {
        self.state.raw()
    }
    pub fn request_focus(&self) -> Result<()> {
        unsafe {
            ffi::lynx_native_view_request_focus(self.as_ptr()?.as_ptr());
        }
        Ok(())
    }
    pub fn trigger_event(&self, name: Event, value: Value) -> Result<()> {
        let raw = self.as_ptr()?;
        unsafe {
            ffi::lynx_native_view_trigger_event(
                raw.as_ptr(),
                name.as_cstr().as_ptr(),
                value.into_raw(),
            );
        }
        Ok(())
    }
    pub fn swap_back(&self) -> Result<()> {
        let raw = self.as_ptr()?;
        ensure!(
            unsafe { ffi::lynx_native_view_swap_back(raw.as_ptr()) },
            "Lynx could not swap the rendered back buffer"
        );
        unsafe {
            ffi::lynx_native_view_mark_dirty(raw.as_ptr());
        }
        Ok(())
    }
    /// Borrowed platform buffer; caller must finish GPU writes before returning
    /// to Lynx, and must not release this surface or reuse it after swap_back.
    pub fn acquire_surface(&self, width: u32, height: u32) -> Result<NonNull<RawSurface>> {
        let width = i32::try_from(width).context("Surface width exceeds i32")?;
        let height = i32::try_from(height).context("Surface height exceeds i32")?;
        NonNull::new(unsafe {
            ffi::lynx_native_view_acquire_surface(self.as_ptr()?.as_ptr(), width, height)
        })
        .context("Lynx back buffer is unavailable")
    }
}

/// Thread-safe callback token with UI-only dereferencing. It carries neither
/// `T` nor ownership of it. Final release clears the pointer before dropping T;
/// off-thread calls are rejected and calls after release are ignored.
pub struct Target<T> {
    state: Arc<State>,
    _type: PhantomData<fn() -> T>,
}
impl<T> Clone for Target<T> {
    fn clone(&self) -> Self {
        Self {
            state: self.state.clone(),
            _type: PhantomData,
        }
    }
}
impl<T: NativeView> Target<T> {
    pub fn dispatch(&self, callback: impl FnOnce(&T) -> Result<()>) -> Result<()> {
        self.state.check_thread()?;
        let address = self.state.data.load(Ordering::Relaxed);
        if address == 0 {
            return Ok(());
        }
        let raw = self.state.raw()?;
        // Retain across reentrant focus/event calls which may destroy the view.
        let _reference = Reference::retain(raw);
        // SAFETY: Only the owning thread can read/free this live Box<Data<T>>.
        guard(|| {
            callback(
                unsafe { &*(address as *const Data<T>) }
                    .value
                    .as_ref()
                    .context("Native view is not initialized")?,
            )
        })
    }
}
struct Data<T> {
    state: Arc<State>,
    value: Option<T>,
}
struct Reference(NonNull<RawView>);
impl Reference {
    fn retain(raw: NonNull<RawView>) -> Self {
        unsafe {
            ffi::lynx_native_view_retain(raw.as_ptr());
        }
        Self(raw)
    }
}
impl Drop for Reference {
    fn drop(&mut self) {
        unsafe {
            ffi::lynx_native_view_release(self.0.as_ptr());
        }
    }
}

/// Owns the initial reference until `into_raw` transfers it to Lynx.
#[must_use]
pub struct View {
    raw: NonNull<RawView>,
    _thread: PhantomData<Rc<()>>,
}
impl View {
    pub fn new<T: NativeView>(create: impl FnOnce(Handle, Target<T>) -> Result<T>) -> Result<Self> {
        let state = Arc::new(State {
            thread: thread::current().id(),
            raw: AtomicUsize::new(0),
            data: AtomicUsize::new(0),
        });
        let data = Box::into_raw(Box::new(Data::<T> {
            state: state.clone(),
            value: None,
        }));
        let Some(raw) = NonNull::new(unsafe { ffi::lynx_native_view_create(data.cast()) }) else {
            unsafe {
                drop(Box::from_raw(data));
            }
            bail!("Create Lynx native view");
        };
        state.raw.store(raw.as_ptr() as usize, Ordering::Relaxed);
        let view = Self {
            raw,
            _thread: PhantomData,
        };
        // Install the finalizer before fallible Rust initialization.
        unsafe {
            ffi::lynx_native_view_bind_release(raw.as_ptr(), Some(release::<T>));
        }
        let value = create(
            Handle {
                state: state.clone(),
                _thread: PhantomData,
            },
            Target {
                state: state.clone(),
                _type: PhantomData,
            },
        )?;
        unsafe {
            (*data).value = Some(value);
            bind::<T>(raw.as_ptr());
        }
        state.data.store(data as usize, Ordering::Relaxed);
        Ok(view)
    }
    pub fn into_raw(self) -> *mut RawView {
        let raw = self.raw.as_ptr();
        std::mem::forget(self);
        raw
    }
}
impl Drop for View {
    fn drop(&mut self) {
        unsafe {
            ffi::lynx_native_view_release(self.raw.as_ptr());
        }
    }
}

fn guard<R>(operation: impl FnOnce() -> Result<R>) -> Result<R> {
    match catch_unwind(AssertUnwindSafe(operation)) {
        Ok(result) => result,
        Err(payload) => {
            std::mem::forget(payload);
            bail!("Rust Lynx native view callback panicked")
        }
    }
}
fn report(result: Result<()>) {
    if let Err(error) = result {
        eprintln!("Rust Lynx native view: {error:#}");
    }
}
unsafe fn dispatch<T: NativeView, R>(
    raw: *mut RawView,
    data: *mut c_void,
    callback: impl FnOnce(&T) -> Result<R>,
) -> Result<R> {
    guard(|| {
        let raw = NonNull::new(raw).context("Null native view")?;
        let data = unsafe { data.cast::<Data<T>>().as_ref() }.context("Null native view state")?;
        data.state.check_thread()?;
        let _reference = Reference::retain(raw);
        callback(
            data.value
                .as_ref()
                .context("Native view is not initialized")?,
        )
    })
}
unsafe extern "C" fn release<T: NativeView>(_raw: *mut RawView, data: *mut c_void) {
    report(guard(|| {
        let data =
            unsafe { data.cast::<Data<T>>().as_ref() }.context("Null native view finalizer")?;
        data.state.check_thread()?;
        data.state.data.store(0, Ordering::Relaxed);
        data.state.raw.store(0, Ordering::Relaxed);
        unsafe {
            drop(Box::from_raw(data as *const Data<T> as *mut Data<T>));
        }
        Ok(())
    }));
}

macro_rules! lifecycle {
    ($($callback:ident => $method:ident, $binder:ident);* $(;)?) => {
        $(unsafe extern "C" fn $callback<T: NativeView>(raw: *mut RawView, data: *mut c_void) {
            report(unsafe { dispatch::<T, _>(raw, data, |view| view.$method()) });
        })*
        unsafe fn bind<T: NativeView>(raw: *mut RawView) {
            unsafe {
                $(ffi::$binder(raw, Some($callback::<T>));)*
                ffi::lynx_native_view_bind_on_create(raw, Some(on_create::<T>));
                ffi::lynx_native_view_bind_on_layout_changed(raw, Some(layout::<T>));
                ffi::lynx_native_view_bind_on_properties_changed(raw, Some(properties::<T>));
                ffi::lynx_native_view_bind_on_motion_event(raw, Some(motion::<T>));
                ffi::lynx_native_view_bind_on_focus_changed(raw, Some(focus::<T>));
                ffi::lynx_native_view_bind_on_method_invoked(raw, Some(invoke::<T>));
                ffi::lynx_native_view_bind_is_scroll_enabled(raw, Some(scroll::<T>));
                ffi::lynx_native_view_bind_is_surface_enabled(raw, Some(surface::<T>));
                ffi::lynx_native_view_bind_surface_buffer_mode(raw, Some(buffer_mode::<T>));
            }
        }
    };
}
lifecycle! {
    attach => on_attach, lynx_native_view_bind_on_attach;
    detach => on_detach, lynx_native_view_bind_on_detach;
    destroy => on_destroy, lynx_native_view_bind_on_destroy;
}
macro_rules! boolean_callback {
    ($name:ident, $method:ident) => {
        unsafe extern "C" fn $name<T: NativeView>(raw: *mut RawView, data: *mut c_void) -> bool {
            unsafe { dispatch::<T, _>(raw, data, |view| Ok(view.$method())) }.unwrap_or(false)
        }
    };
}
boolean_callback!(scroll, is_scroll_enabled);
boolean_callback!(surface, is_surface_enabled);
unsafe extern "C" fn on_create<T: NativeView>(raw: *mut RawView, data: *mut c_void) -> bool {
    unsafe { dispatch::<T, _>(raw, data, NativeView::on_create) }.unwrap_or(false)
}
unsafe extern "C" fn buffer_mode<T: NativeView>(
    raw: *mut RawView,
    data: *mut c_void,
) -> ffi::lynx_surface_buffer_mode_t {
    unsafe { dispatch::<T, _>(raw, data, |view| Ok(view.surface_buffer_mode())) }
        .unwrap_or(SurfaceBufferMode::Double)
        .into()
}
unsafe extern "C" fn layout<T: NativeView>(
    raw: *mut RawView,
    data: *mut c_void,
    left: f32,
    top: f32,
    width: f32,
    height: f32,
    pixel_ratio: f32,
) {
    report(unsafe {
        dispatch::<T, _>(raw, data, |view| {
            view.on_layout_changed(Layout {
                left,
                top,
                width,
                height,
                pixel_ratio,
            })
        })
    });
}
unsafe extern "C" fn properties<T: NativeView>(
    raw: *mut RawView,
    data: *mut c_void,
    attrs: ffi::lynx_value,
    events: ffi::lynx_value,
) {
    report(unsafe {
        dispatch::<T, _>(raw, data, |view| {
            view.on_properties_changed(&Value::borrow(attrs)?, &Value::borrow(events)?)
        })
    });
}
unsafe extern "C" fn motion<T: NativeView>(
    raw: *mut RawView,
    data: *mut c_void,
    event: *mut ffi::native_view_motion_event_t,
) {
    if let Some(event) = unsafe { event.as_ref() } {
        report(unsafe {
            dispatch::<T, _>(raw, data, |view| {
                view.on_motion_event(&MotionEvent::from(event))
            })
        });
    }
}
unsafe extern "C" fn focus<T: NativeView>(
    raw: *mut RawView,
    data: *mut c_void,
    focused: bool,
    leaf: bool,
) {
    report(unsafe { dispatch::<T, _>(raw, data, |view| view.on_focus_changed(focused, leaf)) });
}
unsafe extern "C" fn invoke<T: NativeView>(
    raw: *mut RawView,
    data: *mut c_void,
    method: *const c_char,
    params: ffi::lynx_value,
    callback: ffi::lynx_native_view_callback,
    info: ffi::lynx_native_view_callback_info_t,
) {
    // Keep the SDK callback table alive through the reply, even if the method
    // emits an event which destroys the owning element reentrantly.
    let Some(raw_ref) = NonNull::new(raw) else {
        return;
    };
    let _reference = Reference::retain(raw_ref);
    let result = unsafe {
        dispatch::<T, _>(raw, data, |view| {
            ensure!(!method.is_null(), "Null native view method");
            view.on_method_invoked(
                Method::from(CStr::from_ptr(method)),
                &Value::borrow(params)?,
            )
        })
    };
    let reply = result.unwrap_or_else(Reply::error);
    if let Some(callback) = callback {
        unsafe {
            callback(info, reply.status.into(), reply.value.into_raw());
        }
    }
}

#[cfg(test)]
#[path = "../tests/lynx_native_view.rs"]
pub(crate) mod tests;
