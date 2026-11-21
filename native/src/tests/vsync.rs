use super::*;
use crate::binding::extension::tests as host;
use std::{
    ptr::NonNull,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

fn take_one_frame() -> host::FrameRequest {
    let mut requests = host::take_frame_requests();
    assert_eq!(requests.len(), 1);
    requests.pop().unwrap()
}

fn deliver_frame(request: host::FrameRequest, deadline: i64) {
    unsafe { request.callback.unwrap()(request.user_data as *mut c_void, 0, deadline) };
}

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

#[test]
fn renderer_can_resume_from_a_worker_with_one_vsync_request() {
    use crate::renderer::Renderer;
    use std::sync::atomic::AtomicBool;

    let vsync = VsyncObserver::default();
    vsync.set_module(NonNull::<RawModule>::dangling().as_ptr());
    vsync.attach(NonNull::<RawObserver>::dangling().as_ptr());
    let foreground = Arc::new(AtomicBool::new(false));
    let renderer = Renderer::new(vsync, Arc::clone(&foreground), None);
    renderer.set_active(true);
    assert!(host::take_frame_requests().is_empty());
    foreground.store(true, Ordering::Release);
    std::thread::spawn(move || {
        renderer.schedule_render();
        renderer.schedule_render();
        // Retire the callback just as the host would after detaching the view.
        renderer.set_active(false);
        deliver_frame(take_one_frame(), 0);
    })
    .join()
    .unwrap();
}

#[test]
fn reattach_reuses_the_pending_frame_and_expiry_releases_it() {
    let vsync = VsyncObserver::default();
    vsync.set_module(NonNull::<RawModule>::dangling().as_ptr());
    vsync.attach(NonNull::<RawObserver>::dangling().as_ptr());
    let renderer = crate::renderer::Renderer::new(vsync, Arc::new(true.into()), None);
    renderer.set_active(true);
    let pending = take_one_frame();
    renderer.set_active(false);
    renderer.set_active(true);
    renderer.set_active(true);
    renderer.schedule_render();
    assert!(host::take_frame_requests().is_empty());

    // Each missed deadline is discarded. Until the update is drawn, only one
    // fresh request can be in flight, even if the PTY has stopped producing output.
    deliver_frame(pending, 1);
    deliver_frame(take_one_frame(), 1);
    let retry = take_one_frame();
    renderer.schedule_render();
    assert!(host::take_frame_requests().is_empty());
    renderer.set_active(false);
    deliver_frame(retry, i64::MAX);
    assert!(host::take_frame_requests().is_empty());
}

#[test]
fn a_request_posted_before_runtime_reattach_reports_cancellation() {
    let vsync = VsyncObserver::default();
    let observer = NonNull::<RawObserver>::dangling().as_ptr();
    vsync.attach(observer);
    let (send, receive) = std::sync::mpsc::channel();
    let request = Box::new(Request {
        inner: Arc::clone(&vsync.inner),
        observer,
        epoch: vsync.inner.epoch.load(Ordering::Acquire),
        id: 1,
        callback: Box::new(move |target| send.send(target).unwrap()),
    });
    vsync.detach();
    vsync.attach(observer);
    unsafe { start_request(Box::into_raw(request).cast()) };
    assert_eq!(receive.try_recv().unwrap(), 0);
    assert!(host::take_frame_requests().is_empty());
}
