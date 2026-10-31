use super::*;
use crate::binding::extension::tests as host;

#[test]
fn rust_factory_registers_component_with_a_shared_vsync_handle() {
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

    let vsync = unsafe {
        host::with_extension(raw, |extension: &TerminalExtension| extension.vsync.clone())
    };
    // The view host and extension share the same safe handle.
    assert!(!vsync.request_animation_frame(|_| {}));

    unsafe { callbacks.view_destroy.unwrap()(raw) };
    unsafe { callbacks.destroy.unwrap()(raw) };
    unsafe { host::release(raw) };
}

#[test]
fn finalization_without_view_destroy_drops_the_extension() {
    let extension = TerminalExtension::default();
    let vsync = extension.vsync.clone();
    drop(extension);
    drop(vsync);
}
