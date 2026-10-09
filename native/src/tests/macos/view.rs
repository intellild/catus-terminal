use super::*;

pub(crate) fn run_view_lifecycle_tests() {
    let mtm = MainThreadMarker::new().expect("AppKit tests run on main");
    let parent = NSView::initWithFrame(
        NSView::alloc(mtm),
        NSRect::new(NSPoint::new(0., 0.), NSSize::new(400., 300.)),
    );
    let host = NativeViewHost {
        parent: Retained::as_ptr(&parent) as usize,
        lynx_view: 0,
        native_view: 0,
        request_focus: 0,
        register_ime: 0,
    };
    let view = unsafe { create_mac_terminal_view(&host) }.unwrap();
    assert!(view.uses_osr(), "a parent without NSWindow requires OSR");
    view.attach();
    view.set_osr(false);
    assert!(view.uses_osr());
    view.layout(10., 20., 200., 100., 2.);
    assert_eq!(
        view.input.frame(),
        NSRect::new(NSPoint::new(10., 180.), NSSize::new(200., 100.))
    );
    assert_eq!(view.layer.drawableSize(), NSSize::new(400., 200.));
    view.layout(0., 0., f32::NAN, 100., 1.);
    assert_eq!(view.input.frame(), NSRect::default());
    view.focus(); // An unbound view must not create an input context.
    assert!(view.context.borrow().is_none());
    view.detach();
    assert!(!view.attached.get());
    drop(parent);
    assert!(
        view.parent().is_none(),
        "the platform must not retain its host"
    );
    view.destroy();
    view.destroy(); // Destruction remains idempotent.

    let flipped = InputView::new(mtm, InputState::new(None, |_| Ok(()), || {}));
    flipped.setFrame(NSRect::new(NSPoint::new(0., 0.), NSSize::new(400., 300.)));
    let flipped_host = NativeViewHost {
        parent: Retained::as_ptr(&flipped) as usize,
        ..host
    };
    let flipped_child = unsafe { create_mac_terminal_view(&flipped_host) }.unwrap();
    flipped_child.layout(10., 20., 200., 100., 1.);
    assert_eq!(
        flipped_child.input.frame().origin,
        NSPoint::new(10., 20.),
        "flipped parents already use Lynx top-left coordinates"
    );
    println!("Rust terminal platform lifecycle tests passed");
}
