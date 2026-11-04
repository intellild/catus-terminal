use super::*;
use crate::binding::extension::tests as host;
use std::{
    ptr::NonNull,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

#[test]
fn request_posts_to_bts_and_invokes_the_callback() {
    let vsync = VsyncObserver::default();
    vsync.set_module(NonNull::<RawModule>::dangling().as_ptr());
    vsync.attach(NonNull::<RawObserver>::dangling().as_ptr());
    host::take_frame_requests();

    let calls = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&calls);
    assert!(vsync.request_animation_frame(move |target| {
        assert!(target > 0);
        count.fetch_add(1, Ordering::Relaxed);
    }));
    let request = host::take_frame_requests().pop().unwrap();
    assert_ne!(request.observer, 0);
    assert_ne!(request.id, 0);
    unsafe {
        (request.callback.unwrap())(request.user_data as *mut c_void, 10, 20);
    }
    assert_eq!(calls.load(Ordering::Relaxed), 1);
}

#[test]
fn detaching_rejects_new_requests() {
    let vsync = VsyncObserver::default();
    vsync.set_module(NonNull::<RawModule>::dangling().as_ptr());
    vsync.attach(NonNull::<RawObserver>::dangling().as_ptr());
    vsync.detach();
    assert!(!vsync.request_animation_frame(|_| {}));
}
