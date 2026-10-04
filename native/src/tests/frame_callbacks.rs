use super::*;

#[test]
fn callbacks_run_synchronously_on_the_calling_thread() {
    let frames = create_frame_callbacks();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let thread = std::thread::current().id();
    let captured = calls.clone();
    let first = frames.register(move |deadline| {
        assert_eq!(std::thread::current().id(), thread);
        captured.lock().unwrap().push((1, deadline));
    });
    let captured = calls.clone();
    let second = frames.register(move |deadline| captured.lock().unwrap().push((2, deadline)));
    first.set_active(true);
    second.set_active(true);
    frames.dispatch(20, || 10);
    assert_eq!(*calls.lock().unwrap(), [(1, 20), (2, 20)]);
    // There is no pending work to complete or renew; the next tick runs directly.
    frames.dispatch(40, || 30);
    assert_eq!(*calls.lock().unwrap(), [(1, 20), (2, 20), (1, 40), (2, 40)]);
}

#[test]
fn expired_ticks_are_dropped_and_slow_callbacks_do_not_delay_other_frames() {
    let frames = create_frame_callbacks();
    let now = Arc::new(std::sync::atomic::AtomicI64::new(10));
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let time = now.clone();
    let first = frames.register(move |_| time.store(20, Ordering::Relaxed));
    let count = calls.clone();
    let second = frames.register(move |_| {
        count.fetch_add(1, Ordering::Relaxed);
    });
    first.set_active(true);
    second.set_active(true);
    frames.dispatch(10, || now.load(Ordering::Relaxed));
    assert_eq!(calls.load(Ordering::Relaxed), 0);
    frames.dispatch(20, || now.load(Ordering::Relaxed));
    assert_eq!(now.load(Ordering::Relaxed), 20);
    assert_eq!(calls.load(Ordering::Relaxed), 0); // First callback exhausted this tick's budget.
    first.set_active(false);
    frames.dispatch(40, || now.load(Ordering::Relaxed));
    assert_eq!(calls.load(Ordering::Relaxed), 1); // Nothing from the previous tick is replayed.
}

#[test]
fn inactive_background_dropped_and_destroyed_registrations_do_not_render() {
    let frames = create_frame_callbacks();
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = calls.clone();
    let registration = frames.register(move |_| {
        count.fetch_add(1, Ordering::Relaxed);
    });
    frames.dispatch(20, || 10);
    assert_eq!(calls.load(Ordering::Relaxed), 0);
    registration.set_active(true);
    frames.set_foreground(false);
    frames.dispatch(20, || 10);
    assert_eq!(calls.load(Ordering::Relaxed), 0);
    frames.set_foreground(true);
    frames.dispatch(20, || 10);
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    drop(registration);
    frames.dispatch(20, || 10);
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    assert!(frames.registry.callbacks.lock().unwrap().is_empty());
    let count = calls.clone();
    let registration = frames.register(move |_| {
        count.fetch_add(1, Ordering::Relaxed);
    });
    registration.set_active(true);
    frames.destroy();
    frames.set_foreground(true);
    frames.dispatch(20, || 10);
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    drop(frames); // Registrations can safely outlive their registry owner.
    registration.set_active(false);
}

#[test]
fn callback_can_unregister_another_view_before_its_turn() {
    let frames = create_frame_callbacks();
    let next = Arc::new(Mutex::new(None));
    let captured = next.clone();
    let first = frames.register(move |_| {
        captured.lock().unwrap().take();
    });
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = calls.clone();
    let second = frames.register(move |_| {
        count.fetch_add(1, Ordering::Relaxed);
    });
    first.set_active(true);
    second.set_active(true);
    *next.lock().unwrap() = Some(second);
    frames.dispatch(20, || 10);
    assert_eq!(calls.load(Ordering::Relaxed), 0);
}

#[test]
fn global_dispatch_visits_live_registries_and_drops_dead_ones() {
    let first = create_frame_callbacks();
    let second = create_frame_callbacks();
    let registry = Mutex::new(vec![
        Arc::downgrade(&first.registry),
        Arc::downgrade(&second.registry),
    ]);
    let calls = Arc::new(Mutex::new(Vec::new()));
    let captured = calls.clone();
    let a = first.register(move |deadline| captured.lock().unwrap().push((1, deadline)));
    let captured = calls.clone();
    let b = second.register(move |deadline| captured.lock().unwrap().push((2, deadline)));
    a.set_active(true);
    b.set_active(true);
    dispatch_registries(&registry, 20, || 10);
    assert_eq!(*calls.lock().unwrap(), [(1, 20), (2, 20)]);
    drop(first);
    dispatch_registries(&registry, 40, || 30);
    assert_eq!(*calls.lock().unwrap(), [(1, 20), (2, 20), (2, 40)]);
    assert_eq!(registry.lock().unwrap().len(), 1);
    second.destroy();
    dispatch_registries(&registry, 60, || 50);
    assert_eq!(calls.lock().unwrap().len(), 3);
}
