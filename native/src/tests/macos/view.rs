use super::*;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use objc2::{class, msg_send, runtime::AnyObject};
use objc2_app_kit::{NSWindow, NSWindowDidExposeNotification};
use objc2_foundation::NSNotificationCenter;

use super::super::visibility::WindowVisibility;
use crate::terminal_view::RenderOutcome;

fn noop_schedule() -> Arc<dyn Fn() + Send + Sync> {
    Arc::new(|| {})
}

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
        request_focus: None,
        register_ime: None,
    };
    let view = unsafe { create_mac_terminal_view(&host, noop_schedule()) }.unwrap();
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
    let flipped_child =
        unsafe { create_mac_terminal_view(&flipped_host, noop_schedule()) }.unwrap();
    flipped_child.layout(10., 20., 200., 100., 1.);
    assert_eq!(
        flipped_child.input.frame().origin,
        NSPoint::new(10., 20.),
        "flipped parents already use Lynx top-left coordinates"
    );
    visibility_notifications_schedule_and_detach();
    hidden_window_reports_idle();
    println!("Rust terminal platform lifecycle tests passed");
}

fn hidden_window_reports_idle() {
    let window: Retained<NSWindow> = unsafe { msg_send![class!(NSWindow), new] };
    let content = NSView::initWithFrame(
        NSView::alloc(MainThreadMarker::new().unwrap()),
        NSRect::new(NSPoint::new(0., 0.), NSSize::new(400., 300.)),
    );
    window.setContentView(Some(&content));
    let host = NativeViewHost {
        parent: Retained::as_ptr(&content) as usize,
        lynx_view: 0,
        native_view: 0,
        request_focus: None,
        register_ime: None,
    };
    let view = unsafe { create_mac_terminal_view(&host, noop_schedule()) }.unwrap();
    view.attach();
    view.layout(0., 0., 200., 100., 1.);
    assert_eq!(
        view.render_native(i64::MAX, false).unwrap(),
        RenderOutcome::Idle
    );
    view.destroy();
}

fn visibility_notifications_schedule_and_detach() {
    let window: Retained<NSWindow> = unsafe { msg_send![class!(NSWindow), new] };
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&calls);
    let visibility = WindowVisibility::new(Arc::new(move || {
        counter.fetch_add(1, Ordering::Relaxed);
    }));
    visibility.observe(Some(window.clone()));
    let object: &AnyObject = unsafe { &*Retained::as_ptr(&window).cast::<AnyObject>() };
    unsafe {
        NSNotificationCenter::defaultCenter()
            .postNotificationName_object(NSWindowDidExposeNotification, Some(object));
    }
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    visibility.clear();
    unsafe {
        NSNotificationCenter::defaultCenter()
            .postNotificationName_object(NSWindowDidExposeNotification, Some(object));
    }
    assert_eq!(calls.load(Ordering::Relaxed), 1);
}
