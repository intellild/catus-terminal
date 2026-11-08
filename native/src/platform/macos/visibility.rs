//! Schedules a frame when the host window becomes visible again.
use std::{cell::RefCell, sync::Arc};

use objc2::{
    DefinedClass, MainThreadOnly, define_class, msg_send, rc::Retained, runtime::AnyObject, sel,
};
use objc2_app_kit::{
    NSWindow, NSWindowDidChangeOcclusionStateNotification, NSWindowDidDeminiaturizeNotification,
    NSWindowDidExposeNotification,
};
use objc2_foundation::{
    MainThreadMarker, NSNotification, NSNotificationCenter, NSObject, NSObjectProtocol,
};

struct ObserverIvars {
    schedule: Arc<dyn Fn() + Send + Sync>,
}

define_class!(
    // SAFETY: NSObject subclass with one notification selector, main-thread only.
    #[unsafe(super = NSObject)]
    #[name = "CatusTerminalVisibilityObserver"]
    #[thread_kind = MainThreadOnly]
    #[ivars = ObserverIvars]
    struct VisibilityObserver;

    unsafe impl NSObjectProtocol for VisibilityObserver {}
    impl VisibilityObserver {
        #[unsafe(method(windowVisibilityChanged:))]
        fn changed(&self, _notification: &NSNotification) {
            (self.ivars().schedule)();
        }
    }
);

pub(super) struct WindowVisibility {
    schedule: Arc<dyn Fn() + Send + Sync>,
    observed: RefCell<Option<ObservedWindow>>,
}

struct ObservedWindow {
    window: Retained<NSWindow>,
    observer: Retained<VisibilityObserver>,
}

impl WindowVisibility {
    pub(super) fn new(schedule: Arc<dyn Fn() + Send + Sync>) -> Self {
        Self {
            schedule,
            observed: RefCell::new(None),
        }
    }

    /// Re-register when the host window appears or changes.
    pub(super) fn observe(&self, window: Option<Retained<NSWindow>>) {
        let same = match (self.observed.borrow().as_ref(), window.as_deref()) {
            (Some(observed), Some(window)) => std::ptr::eq(&*observed.window, window),
            (None, None) => true,
            _ => false,
        };
        if same {
            return;
        }
        self.clear();
        let Some(window) = window else {
            return;
        };
        let mtm =
            MainThreadMarker::new().expect("Terminal visibility observers require the UI thread");
        let allocated = VisibilityObserver::alloc(mtm).set_ivars(ObserverIvars {
            schedule: Arc::clone(&self.schedule),
        });
        let observer: Retained<VisibilityObserver> = unsafe { msg_send![super(allocated), init] };
        let object: &AnyObject = unsafe { &*Retained::as_ptr(&observer).cast::<AnyObject>() };
        let target: &AnyObject = unsafe { &*Retained::as_ptr(&window).cast::<AnyObject>() };
        let center = NSNotificationCenter::defaultCenter();
        let names = unsafe {
            [
                NSWindowDidChangeOcclusionStateNotification,
                NSWindowDidDeminiaturizeNotification,
                NSWindowDidExposeNotification,
            ]
        };
        for name in names {
            unsafe {
                center.addObserver_selector_name_object(
                    object,
                    sel!(windowVisibilityChanged:),
                    Some(name),
                    Some(target),
                );
            }
        }
        *self.observed.borrow_mut() = Some(ObservedWindow { window, observer });
    }

    pub(super) fn clear(&self) {
        let Some(observed) = self.observed.borrow_mut().take() else {
            return;
        };
        let object: &AnyObject =
            unsafe { &*Retained::as_ptr(&observed.observer).cast::<AnyObject>() };
        unsafe {
            NSNotificationCenter::defaultCenter().removeObserver(object);
        }
    }
}

impl Drop for WindowVisibility {
    fn drop(&mut self) {
        self.clear();
    }
}
