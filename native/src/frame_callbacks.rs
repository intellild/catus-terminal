//! Synchronous UI-thread callbacks. No frame IDs, broadcasts or pending frame tasks.
use std::{
    cell::{Cell, RefCell},
    rc::{Rc, Weak},
};

#[cxx::bridge(namespace = "catus")]
mod ffi {
    unsafe extern "C++" {
        include!("NativeFrameCallbacks.h");
        type NativeFrameTarget;
        fn render_target(target: &NativeFrameTarget, deadline: i64);
        fn monotonic_now_ns() -> i64;
    }
    extern "Rust" {
        type FrameCallbacks;
        type FrameRegistration;
        fn create_frame_callbacks() -> Box<FrameCallbacks>;
        fn register_frame_callback(
            self: &FrameCallbacks,
            target: SharedPtr<NativeFrameTarget>,
        ) -> Box<FrameRegistration>;
        fn set_active(self: &FrameRegistration, active: bool);
        fn on_vsync(self: &FrameCallbacks, deadline: i64);
        fn set_foreground(self: &FrameCallbacks, foreground: bool);
        fn destroy(self: &FrameCallbacks);
    }
}

struct Callback {
    active: Cell<bool>,
    render: Box<dyn Fn(i64)>,
}

pub struct FrameRegistration {
    callback: Rc<Callback>,
}

impl FrameRegistration {
    fn set_active(&self, active: bool) {
        self.callback.active.set(active);
    }
}

// Registration, dispatch and registration drops are UI-thread-only. Native view
// destruction stops the display link before the owner can be released on BTS.
// All entry points are called by UI lifecycle hooks, never by BTS.
pub struct FrameCallbacks {
    callbacks: RefCell<Vec<Weak<Callback>>>,
    foreground: Cell<bool>,
    destroyed: Cell<bool>,
}

fn create_frame_callbacks() -> Box<FrameCallbacks> {
    Box::new(FrameCallbacks {
        callbacks: RefCell::new(Vec::new()),
        foreground: Cell::new(true),
        destroyed: Cell::new(false),
    })
}

impl FrameCallbacks {
    fn register(&self, render: impl Fn(i64) + 'static) -> Box<FrameRegistration> {
        let callback = Rc::new(Callback {
            active: Cell::new(false),
            render: Box::new(render),
        });
        self.callbacks.borrow_mut().push(Rc::downgrade(&callback));
        Box::new(FrameRegistration { callback })
    }

    fn register_frame_callback(
        &self,
        target: cxx::SharedPtr<ffi::NativeFrameTarget>,
    ) -> Box<FrameRegistration> {
        self.register(move |deadline| {
            if let Some(target) = target.as_ref() {
                ffi::render_target(target, deadline);
            }
        })
    }

    fn set_foreground(&self, foreground: bool) {
        self.foreground.set(foreground);
    }

    fn destroy(&self) {
        self.destroyed.set(true);
    }

    fn on_vsync(&self, deadline: i64) {
        self.dispatch(deadline, ffi::monotonic_now_ns);
    }

    fn dispatch(&self, deadline: i64, now: impl Fn() -> i64) {
        if !self.foreground.get() || self.destroyed.get() {
            return;
        }
        // Snapshot registrations (not frames) to allow a render callback to
        // unregister/register views without borrowing the registry recursively.
        let callbacks: Vec<_> = {
            let mut registrations = self.callbacks.borrow_mut();
            registrations.retain(|callback| callback.strong_count() > 0);
            registrations.iter().filter_map(Weak::upgrade).collect()
        };
        for callback in callbacks {
            if deadline <= now() || !self.foreground.get() || self.destroyed.get() {
                break;
            }
            // A registration dropped by an earlier callback must not run.
            if Rc::strong_count(&callback) > 1 && callback.active.get() {
                (callback.render)(deadline);
            }
        }
    }
}

#[cfg(test)]
#[path = "tests/frame_callbacks.rs"]
mod tests;

pub(crate) fn expired(deadline: i64) -> bool {
    deadline <= ffi::monotonic_now_ns()
}
