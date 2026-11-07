//! C host substitute; callbacks have the actual generated SDK ABI signatures.
use super::*;
use std::cell::Cell;

type Lifecycle = Option<unsafe extern "C" fn(*mut RawView, *mut c_void)>;
type Boolean = Option<unsafe extern "C" fn(*mut RawView, *mut c_void) -> bool>;
type Properties =
    Option<unsafe extern "C" fn(*mut RawView, *mut c_void, ffi::lynx_value, ffi::lynx_value)>;
type Invoke = Option<
    unsafe extern "C" fn(
        *mut RawView,
        *mut c_void,
        *const c_char,
        ffi::lynx_value,
        ffi::lynx_native_view_callback,
        ffi::lynx_native_view_callback_info_t,
    ),
>;
#[derive(Clone, Copy, Default)]
pub(super) struct Callbacks {
    pub create: Boolean,
    pub attach: Lifecycle,
    pub detach: Lifecycle,
    pub destroy: Lifecycle,
    release: Lifecycle,
    pub layout: Option<unsafe extern "C" fn(*mut RawView, *mut c_void, f32, f32, f32, f32, f32)>,
    pub properties: Properties,
    pub motion: Option<
        unsafe extern "C" fn(*mut RawView, *mut c_void, *mut ffi::native_view_motion_event_t),
    >,
    pub focus: Option<unsafe extern "C" fn(*mut RawView, *mut c_void, bool, bool)>,
    pub invoke: Invoke,
    pub scroll: Boolean,
    pub surface: Boolean,
    pub buffer:
        Option<unsafe extern "C" fn(*mut RawView, *mut c_void) -> ffi::lynx_surface_buffer_mode_t>,
}
struct Host {
    data: *mut c_void,
    refs: Cell<usize>,
    callbacks: Callbacks,
}
thread_local! {
    pub(super) static FAIL_CREATE: Cell<bool> = const { Cell::new(false) };
    pub(super) static LIVE_VIEWS: Cell<usize> = const { Cell::new(0) };
    pub(super) static EVENTS: RefCell<Vec<(String, Value)>> = const { RefCell::new(Vec::new()) };
    pub(super) static REPLIES: RefCell<Vec<(i32, Value)>> = const { RefCell::new(Vec::new()) };
    pub(super) static PRESENTED: Cell<Option<(i32, i32, bool, usize)>> = const { Cell::new(None) };
}
pub(super) unsafe fn callbacks(raw: *mut RawView) -> (Callbacks, *mut c_void) {
    let host = unsafe { &*raw.cast::<Host>() };
    (host.callbacks, host.data)
}
pub(super) unsafe extern "C" fn reply(
    _info: ffi::lynx_native_view_callback_info_t,
    code: i32,
    value: ffi::lynx_value,
) {
    // Consume the reference passed to the callback, as Lynx does.
    let owned = unsafe { Value::borrow(value) }.unwrap();
    unsafe {
        ffi::lynx_value_remove_reference(std::ptr::null_mut(), value, std::ptr::null_mut());
    }
    REPLIES.with(|replies| replies.borrow_mut().push((code, owned)));
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_native_view_create(data: *mut c_void) -> *mut RawView {
    if FAIL_CREATE.take() {
        return std::ptr::null_mut();
    }
    LIVE_VIEWS.set(LIVE_VIEWS.get() + 1);
    Box::into_raw(Box::new(Host {
        data,
        refs: Cell::new(1),
        callbacks: Callbacks::default(),
    }))
    .cast()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_native_view_retain(raw: *mut RawView) -> *mut RawView {
    let host = unsafe { &*raw.cast::<Host>() };
    host.refs.set(host.refs.get() + 1);
    raw
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_native_view_release(raw: *mut RawView) {
    let host = unsafe { &*raw.cast::<Host>() };
    host.refs.set(host.refs.get() - 1);
    if host.refs.get() == 0 {
        let host = unsafe { Box::from_raw(raw.cast::<Host>()) };
        if let Some(release) = host.callbacks.release {
            unsafe {
                release(raw, host.data);
            }
        }
        LIVE_VIEWS.set(LIVE_VIEWS.get() - 1);
    }
}
macro_rules! binder {
    ($($name:ident, $field:ident, $ty:ty);* $(;)?) => {$(
        #[unsafe(no_mangle)]
        unsafe extern "C" fn $name(raw: *mut RawView, callback: $ty) {
            unsafe { (*raw.cast::<Host>()).callbacks.$field = callback; }
        }
    )*};
}
binder! {
    lynx_native_view_bind_on_create, create, Boolean;
    lynx_native_view_bind_on_attach, attach, Lifecycle;
    lynx_native_view_bind_on_detach, detach, Lifecycle;
    lynx_native_view_bind_on_destroy, destroy, Lifecycle;
    lynx_native_view_bind_release, release, Lifecycle;
    lynx_native_view_bind_on_layout_changed, layout, Option<unsafe extern "C" fn(*mut RawView, *mut c_void, f32, f32, f32, f32, f32)>;
    lynx_native_view_bind_on_properties_changed, properties, Properties;
    lynx_native_view_bind_on_motion_event, motion, Option<unsafe extern "C" fn(*mut RawView, *mut c_void, *mut ffi::native_view_motion_event_t)>;
    lynx_native_view_bind_on_focus_changed, focus, Option<unsafe extern "C" fn(*mut RawView, *mut c_void, bool, bool)>;
    lynx_native_view_bind_on_method_invoked, invoke, Invoke;
    lynx_native_view_bind_is_scroll_enabled, scroll, Boolean;
    lynx_native_view_bind_is_surface_enabled, surface, Boolean;
    lynx_native_view_bind_surface_buffer_mode, buffer, Option<unsafe extern "C" fn(*mut RawView, *mut c_void) -> ffi::lynx_surface_buffer_mode_t>;
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_native_view_trigger_event(
    _raw: *mut RawView,
    name: *const c_char,
    value: ffi::lynx_value,
) {
    let owned = unsafe { Value::borrow(value) }.unwrap();
    unsafe {
        ffi::lynx_value_remove_reference(std::ptr::null_mut(), value, std::ptr::null_mut());
    }
    EVENTS.with(|events| {
        events.borrow_mut().push((
            unsafe { CStr::from_ptr(name) }
                .to_string_lossy()
                .into_owned(),
            owned,
        ))
    });
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_native_view_request_focus(_raw: *mut RawView) {}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_native_view_mark_dirty(_raw: *mut RawView) {}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_native_view_present_surface(
    _raw: *mut RawView,
    width: i32,
    height: i32,
    transform: *const f32,
    handle: *mut RawSurface,
) -> bool {
    PRESENTED.set(Some((width, height, transform.is_null(), handle as usize)));
    true
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_view_get_native_window(_raw: *mut LynxView) -> *mut c_void {
    std::ptr::null_mut()
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_view_register_ime_handler(
    _raw: *mut LynxView,
    _handler: *mut c_void,
    _opaque: *mut c_void,
) {
}
