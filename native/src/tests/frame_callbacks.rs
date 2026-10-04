use super::*;

#[test]
fn callbacks_run_synchronously_on_the_calling_thread() {
    let frames = create_frame_callbacks();
    let calls = Rc::new(RefCell::new(Vec::new()));
    let thread = std::thread::current().id();
    let captured = calls.clone();
    let first = frames.register(move |deadline| {
        assert_eq!(std::thread::current().id(), thread);
        captured.borrow_mut().push((1, deadline));
    });
    let captured = calls.clone();
    let second = frames.register(move |deadline| captured.borrow_mut().push((2, deadline)));
    first.set_active(true);
    second.set_active(true);
    frames.dispatch(20, || 10);
    assert_eq!(*calls.borrow(), [(1, 20), (2, 20)]);
    // There is no pending work to complete or renew; the next tick runs directly.
    frames.dispatch(40, || 30);
    assert_eq!(*calls.borrow(), [(1, 20), (2, 20), (1, 40), (2, 40)]);
}

#[test]
fn expired_ticks_are_dropped_and_slow_callbacks_do_not_delay_other_frames() {
    let frames = create_frame_callbacks();
    let now = Rc::new(Cell::new(10));
    let calls = Rc::new(Cell::new(0));
    let time = now.clone();
    let first = frames.register(move |_| time.set(20));
    let count = calls.clone();
    let second = frames.register(move |_| count.set(count.get() + 1));
    first.set_active(true);
    second.set_active(true);
    frames.dispatch(10, || now.get());
    assert_eq!(calls.get(), 0);
    frames.dispatch(20, || now.get());
    assert_eq!(now.get(), 20);
    assert_eq!(calls.get(), 0); // First callback exhausted this tick's budget.
    first.set_active(false);
    frames.dispatch(40, || now.get());
    assert_eq!(calls.get(), 1); // Nothing from the previous tick is replayed.
}

#[test]
fn inactive_background_dropped_and_destroyed_registrations_do_not_render() {
    let frames = create_frame_callbacks();
    let calls = Rc::new(Cell::new(0));
    let count = calls.clone();
    let registration = frames.register(move |_| count.set(count.get() + 1));
    frames.dispatch(20, || 10);
    assert_eq!(calls.get(), 0);
    registration.set_active(true);
    frames.set_foreground(false);
    frames.dispatch(20, || 10);
    assert_eq!(calls.get(), 0);
    frames.set_foreground(true);
    frames.dispatch(20, || 10);
    assert_eq!(calls.get(), 1);
    drop(registration);
    frames.dispatch(20, || 10);
    assert_eq!(calls.get(), 1);
    assert!(frames.callbacks.borrow().is_empty());
    let count = calls.clone();
    let registration = frames.register(move |_| count.set(count.get() + 1));
    registration.set_active(true);
    frames.destroy();
    frames.set_foreground(true);
    frames.dispatch(20, || 10);
    assert_eq!(calls.get(), 1);
    drop(frames); // Registrations can safely outlive their registry owner.
    registration.set_active(false);
}

#[test]
fn callback_can_unregister_another_view_before_its_turn() {
    let frames = create_frame_callbacks();
    let next = Rc::new(RefCell::new(None));
    let captured = next.clone();
    let first = frames.register(move |_| {
        captured.borrow_mut().take();
    });
    let calls = Rc::new(Cell::new(0));
    let count = calls.clone();
    let second = frames.register(move |_| count.set(count.get() + 1));
    first.set_active(true);
    second.set_active(true);
    *next.borrow_mut() = Some(second);
    frames.dispatch(20, || 10);
    assert_eq!(calls.get(), 0);
}
