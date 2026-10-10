use super::*;
use crate::binding::extension::tests as host;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

#[test]
fn rust_factory_registers_component_and_controls_the_shared_native_registry() {
    register_terminal_extension();
    let registration = host::take_registration();
    assert_eq!(registration.name, "CatusNativeTerminalElement");
    assert!(!registration.lazy);
    let raw = unsafe { registration.creator.unwrap()(std::ptr::null_mut()) };
    assert!(!raw.is_null());
    let callbacks = unsafe { host::callbacks(raw) };
    let view = NonNull::<LynxView>::dangling().as_ptr();
    unsafe { callbacks.view_create.unwrap()(raw, view) };
    let native = host::take_native_registrations().pop().unwrap();
    assert_eq!(native.view, view as usize);
    assert_eq!(native.name, "native-terminal");
    assert!(native.creator.is_some());

    // Native views clone the Rust registry. It must share lifecycle state
    // and remain stopped after the extension finalizes.
    let retained_host = unsafe {
        host::with_extension(raw, |extension: &TerminalExtension| {
            extension.host.get().unwrap().frames.clone()
        })
    };
    assert_ne!(native.opaque, 0);
    let frames = &retained_host;
    let calls = Arc::new(AtomicUsize::new(0));
    let count = calls.clone();
    let render = frames.register(move |_| {
        count.fetch_add(1, Ordering::Relaxed);
    });
    render.set_active(true);
    frames.dispatch(20, || 10);
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    unsafe { callbacks.background.unwrap()(raw) };
    frames.dispatch(20, || 10);
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    unsafe { callbacks.foreground.unwrap()(raw) };
    frames.dispatch(20, || 10);
    assert_eq!(calls.load(Ordering::Relaxed), 2);
    unsafe { callbacks.view_destroy.unwrap()(raw) };
    unsafe { callbacks.foreground.unwrap()(raw) };
    frames.dispatch(20, || 10);
    assert_eq!(calls.load(Ordering::Relaxed), 2);
    unsafe { callbacks.destroy.unwrap()(raw) };
    unsafe { host::release(raw) };
    frames.dispatch(20, || 10);
    assert_eq!(calls.load(Ordering::Relaxed), 2);
}

#[test]
fn finalization_without_view_destroy_stops_retained_native_views_and_isolates_windows() {
    let first = TerminalExtension::default();
    let second = TerminalExtension::default();
    let first_frames = first.frames.clone();
    let second_frames = second.frames.clone();
    let calls = Arc::new(AtomicUsize::new(0));
    let count = calls.clone();
    let a = first_frames.register(move |_| {
        count.fetch_add(1, Ordering::Relaxed);
    });
    let count = calls.clone();
    let b = second_frames.register(move |_| {
        count.fetch_add(10, Ordering::Relaxed);
    });
    a.set_active(true);
    b.set_active(true);
    first.on_enter_background();
    first_frames.dispatch(20, || 10);
    second_frames.dispatch(20, || 10);
    assert_eq!(calls.load(Ordering::Relaxed), 10);
    drop(first);
    first_frames.set_foreground(true);
    first_frames.dispatch(20, || 10);
    second_frames.dispatch(20, || 10);
    assert_eq!(calls.load(Ordering::Relaxed), 20);
    drop(second);
    second_frames.dispatch(20, || 10);
    assert_eq!(calls.load(Ordering::Relaxed), 20);
}
