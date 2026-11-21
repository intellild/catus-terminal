use super::*;
use crate::binding::extension::tests as host;

#[test]
fn runtime_attach_and_foreground_notify_only_their_windows_listeners() {
    let window = TerminalExtension::default();
    let other_window = TerminalExtension::default();
    let mut first = window.resume.subscribe();
    let mut second = window.resume.subscribe();
    let other = other_window.resume.subscribe();

    window.on_runtime_attach(std::ptr::null_mut());
    assert!(first.borrow_and_update().has_changed());
    assert!(second.borrow_and_update().has_changed());
    drop(first);

    window.on_enter_background();
    assert!(!window.foreground.load(Ordering::Acquire));
    assert!(!second.has_changed().unwrap());
    window.on_enter_foreground();
    assert!(window.foreground.load(Ordering::Acquire));
    assert!(second.has_changed().unwrap());
    assert!(!other.has_changed().unwrap());
}

#[test]
fn terminal_factory_borrows_the_window_extension() {
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
        host::with_extension(raw, |extension: &TerminalExtension| {
            assert_eq!(native.opaque, std::ptr::from_ref(extension) as usize);
            assert_eq!(extension.lynx_view.get().copied(), Some(native.view));
            extension.vsync.clone()
        })
    };
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
