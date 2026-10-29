use super::*;
use crate::binding::extension::tests as host;
use std::sync::Arc;

#[test]
fn rust_factory_registers_component_with_a_shared_frame_source() {
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

    // The host context and extension share the source; each view subscribes
    // its own loop to it.
    let source = unsafe {
        host::with_extension(raw, |extension: &TerminalExtension| {
            assert_eq!(Arc::strong_count(&extension.frames), 2);
            Arc::clone(&extension.frames)
        })
    };
    let loop_ = source.subscribe(Box::new(|_| {}));
    loop_.set_active(true);
    loop_.set_active(false);

    unsafe { callbacks.view_destroy.unwrap()(raw) };
    unsafe { callbacks.destroy.unwrap()(raw) };
    unsafe { host::release(raw) };
}

#[test]
fn finalization_without_view_destroy_drops_the_extension() {
    let extension = TerminalExtension::default();
    let source = Arc::clone(&extension.frames);
    drop(extension);
    // A view can keep the source alive after the extension is gone; it no
    // longer has a live module and therefore cannot schedule BTS tasks.
    drop(source);
}
