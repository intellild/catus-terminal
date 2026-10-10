//! Borrowed host operations used by platform adapters. Raw SDK calls stay here.
use super::{extension::LynxView, ffi, native_view::RawView};
use std::ffi::c_void;

/// # Safety
/// The caller lends a live Lynx view on UI; the returned window is borrowed.
pub(crate) unsafe fn native_window(view: *mut LynxView) -> *mut c_void {
    unsafe { ffi::lynx_view_get_native_window(view) }
}
/// # Safety
/// `view` must be a live native view on its UI thread.
pub(crate) unsafe fn request_native_focus(view: *mut RawView) {
    unsafe {
        ffi::lynx_native_view_request_focus(view);
    }
}
/// # Safety
/// The view is live on UI. Handler/opaque follow Lynx's IME contract and must
/// remain valid until unregistered by passing a null handler.
pub(crate) unsafe fn register_ime_handler(
    view: *mut LynxView,
    handler: *mut c_void,
    opaque: *mut c_void,
) {
    unsafe {
        ffi::lynx_view_register_ime_handler(view, handler, opaque);
    }
}
