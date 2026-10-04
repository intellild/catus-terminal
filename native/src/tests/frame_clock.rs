use super::*;
use std::collections::VecDeque;

// Flooding the process-wide broadcast in one test must not evict another test's tick.
static TEST_LOCK: Mutex<()> = Mutex::new(());

#[derive(Default)]
pub(super) struct TestHost {
    runtime: Mutex<VecDeque<Box<FrameTask>>>,
    vsync: Mutex<VecDeque<Box<FrameTask>>>,
    ui: Mutex<VecDeque<Box<FrameTask>>>,
}

impl Host for TestHost {
    fn post_runtime(&self, _: usize, task: Box<FrameTask>) {
        self.runtime.lock().unwrap().push_back(task);
    }
    fn request_vsync(&self, _: usize, task: Box<FrameTask>) {
        self.vsync.lock().unwrap().push_back(task);
    }
    fn post_ui(&self, task: Box<FrameTask>) {
        self.ui.lock().unwrap().push_back(task);
    }
}

impl TestHost {
    fn run_runtime(&self) {
        loop {
            let task = self.runtime.lock().unwrap().pop_front();
            match task {
                Some(task) => frame_task_request(task),
                None => break,
            }
        }
    }

    fn fire_vsync(&self) {
        let tasks = std::mem::take(&mut *self.vsync.lock().unwrap());
        for task in tasks {
            frame_task_vsync(task, 1, 2);
        }
    }

    fn draw(&self, listeners: &[&FrameListener]) -> usize {
        let tasks = std::mem::take(&mut *self.ui.lock().unwrap());
        let mut drawn = 0;
        for task in tasks {
            if task.is_current() {
                for listener in listeners {
                    if listener.clock.id == task.clock_id() && listener.take_frame() {
                        drawn += 1;
                    }
                }
            }
            frame_task_complete(task);
        }
        drawn
    }
}

fn clock() -> (FrameClock, Arc<TestHost>) {
    let host = Arc::new(TestHost::default());
    (FrameClock::new(1, host.clone()), host)
}

#[test]
fn rust_subscriptions_wake_on_attach_and_wait_for_ui_completion() {
    let _guard = TEST_LOCK.lock().unwrap();
    let (clock, host) = clock();
    let first = clock.register_frame_listener();
    let second = clock.register_frame_listener();
    first.set_active(true);
    second.set_active(true);
    assert!(host.runtime.lock().unwrap().is_empty());
    unsafe { clock.attach_runtime(2) };
    host.run_runtime();
    assert_eq!(host.vsync.lock().unwrap().len(), 1);

    // Repeated wakes cannot overlap a VSync or a UI/GPU frame in flight.
    for _ in 0..5 {
        clock.state.wake();
    }
    host.run_runtime();
    assert_eq!(host.vsync.lock().unwrap().len(), 1);
    host.fire_vsync();
    clock.state.wake();
    host.run_runtime();
    assert!(host.vsync.lock().unwrap().is_empty());
    assert_eq!(host.draw(&[&first, &second]), 2);
    assert!(host.vsync.lock().unwrap().is_empty());
    host.run_runtime();
    assert_eq!(host.vsync.lock().unwrap().len(), 1);

    first.set_active(false);
    host.fire_vsync();
    assert_eq!(host.draw(&[&first, &second]), 1);
    host.run_runtime();
    second.set_active(false);
    host.fire_vsync();
    assert_eq!(host.draw(&[&first, &second]), 0);
    host.run_runtime();
    assert!(host.vsync.lock().unwrap().is_empty());
}

#[test]
fn global_broadcast_filters_windows_generations_and_coalesces_lagged_ticks() {
    let _guard = TEST_LOCK.lock().unwrap();
    let (first, _) = clock();
    let (second, _) = clock();
    let first_listener = first.register_frame_listener();
    let second_listener = second.register_frame_listener();
    first_listener.set_active(true);
    second_listener.set_active(true);
    unsafe {
        first.attach_runtime(2);
        second.attach_runtime(3);
    }
    for _ in 0..256 {
        let _ = FRAMES.send(FrameTick {
            clock_id: first.id(),
            generation: 1,
        });
    }
    assert!(first_listener.take_frame());
    assert!(!first_listener.take_frame());
    assert!(!second_listener.take_frame());
    first.detach_runtime();
    unsafe { first.attach_runtime(2) };
    let _ = FRAMES.send(FrameTick {
        clock_id: first.id(),
        generation: 1,
    });
    assert!(!first_listener.take_frame());
    let _ = FRAMES.send(FrameTick {
        clock_id: first.id(),
        generation: 3,
    });
    assert!(first_listener.take_frame());
}

#[test]
fn old_callbacks_cannot_restart_a_replaced_or_destroyed_runtime() {
    let _guard = TEST_LOCK.lock().unwrap();
    let (clock, host) = clock();
    let listener = clock.register_frame_listener();
    listener.set_active(true);
    unsafe { clock.attach_runtime(2) };
    host.run_runtime();
    clock.detach_runtime();
    unsafe { clock.attach_runtime(2) };
    host.run_runtime();
    assert_eq!(host.vsync.lock().unwrap().len(), 2);
    host.fire_vsync();
    assert_eq!(host.draw(&[&listener]), 1);
    host.run_runtime();
    assert_eq!(host.vsync.lock().unwrap().len(), 1);

    host.fire_vsync(); // UI callback already queued at destruction.
    clock.state.wake(); // BTS callback also queued at destruction.
    clock.destroy();
    host.run_runtime();
    assert_eq!(host.draw(&[&listener]), 0);
    assert!(host.vsync.lock().unwrap().is_empty());
    unsafe { clock.attach_runtime(2) };
    host.run_runtime();
    assert!(host.vsync.lock().unwrap().is_empty());

    // Dropping the owner also cancels callbacks when a receiver still retains state.
    let host = Arc::new(TestHost::default());
    let owner = FrameClock::new(1, host.clone());
    let listener = owner.register_frame_listener();
    listener.set_active(true);
    unsafe { owner.attach_runtime(2) };
    host.run_runtime();
    drop(owner);
    host.fire_vsync();
    assert_eq!(host.draw(&[&listener]), 0);
    assert!(host.runtime.lock().unwrap().is_empty());
}

#[test]
fn background_and_subscription_drop_stop_frames_and_reattach_skips_old_ticks() {
    let _guard = TEST_LOCK.lock().unwrap();
    let (clock, host) = clock();
    let listener = clock.register_frame_listener();
    listener.set_active(true);
    unsafe { clock.attach_runtime(2) };
    host.run_runtime();
    clock.set_foreground(false);
    host.fire_vsync();
    assert_eq!(host.draw(&[&listener]), 0);
    host.run_runtime();
    assert!(host.vsync.lock().unwrap().is_empty());
    clock.set_foreground(true);
    host.run_runtime();
    host.fire_vsync();
    listener.set_active(false);
    listener.set_active(true);
    assert!(!listener.take_frame());
    host.draw(&[&listener]);
    host.run_runtime();
    drop(listener);
    assert_eq!(clock.state.listeners.load(Ordering::Acquire), 0);
    host.fire_vsync();
    host.run_runtime();
    assert!(host.ui.lock().unwrap().is_empty());
    assert!(host.vsync.lock().unwrap().is_empty());
}
