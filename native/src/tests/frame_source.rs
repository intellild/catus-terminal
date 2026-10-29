use super::*;
use crate::binding::extension::tests as host;
use std::{ffi::c_void, ptr::NonNull};

#[test]
fn per_view_loop_requests_one_frame_and_stops_after_deactivate() {
    let source = Arc::new(NativeFrameSource::default());
    source.set_module(NonNull::<RawModule>::dangling().as_ptr());
    let observer = NonNull::<VsyncObserver>::dangling().as_ptr();
    source.set_observer(observer);
    let loop_ = source.subscribe(Box::new(|_| {}));
    host::take_frame_requests();

    loop_.set_active(true);
    let request = host::take_frame_requests().pop().unwrap();
    assert_eq!(request.observer, observer as usize);
    assert_ne!(request.id, 0);
    let callback = request.callback.unwrap();

    // Delivering one frame re-arms exactly one request for this view.
    unsafe { callback(request.user_data as *mut c_void, 10, 20) };
    let rearmed = host::take_frame_requests().pop().unwrap();
    assert_eq!(rearmed.observer, observer as usize);

    loop_.set_active(false);
    unsafe { (rearmed.callback.unwrap())(rearmed.user_data as *mut c_void, 10, 30) };
    assert!(host::take_frame_requests().is_empty());
}

#[test]
fn detaching_the_runtime_cancels_pending_view_loops() {
    let source = Arc::new(NativeFrameSource::default());
    source.set_module(NonNull::<RawModule>::dangling().as_ptr());
    let observer = NonNull::<VsyncObserver>::dangling().as_ptr();
    source.set_observer(observer);
    let loop_ = source.subscribe(Box::new(|_| {}));
    host::take_frame_requests();

    loop_.set_active(true);
    let request = host::take_frame_requests().pop().unwrap();
    source.set_observer(std::ptr::null_mut());
    unsafe { (request.callback.unwrap())(request.user_data as *mut c_void, 10, 20) };
    assert!(host::take_frame_requests().is_empty());
}
