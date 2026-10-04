//! Native VSync scheduling and subscriptions. PTY computation is independent.
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex, Weak};
use tokio::sync::broadcast;
use tokio::sync::broadcast::error::TryRecvError;

// Tests substitute the host queues, so the C++ transport functions are unused there.
#[cfg_attr(test, allow(dead_code))]
#[cxx::bridge(namespace = "catus")]
mod ffi {
    unsafe extern "C++" {
        include!("NativeFrameHost.h");
        unsafe fn post_frame_task(module: usize, task: Box<FrameTask>);
        unsafe fn request_native_frame(observer: usize, task: Box<FrameTask>);
        fn post_frame_to_ui(task: Box<FrameTask>);
    }
    extern "Rust" {
        type FrameClock;
        type FrameListener;
        type FrameTask;
        unsafe fn create_frame_clock(module: usize) -> Box<FrameClock>;
        fn id(self: &FrameClock) -> u64;
        unsafe fn attach_runtime(self: &FrameClock, observer: usize);
        fn detach_runtime(self: &FrameClock);
        fn destroy(self: &FrameClock);
        fn set_foreground(self: &FrameClock, foreground: bool);
        fn register_frame_listener(self: &FrameClock) -> Box<FrameListener>;
        fn set_active(self: &FrameListener, active: bool);
        fn take_frame(self: &FrameListener) -> bool;
        fn clock_id(self: &FrameTask) -> u64;
        fn is_current(self: &FrameTask) -> bool;
        fn frame_task_request(task: Box<FrameTask>);
        fn frame_task_vsync(task: Box<FrameTask>, start: i64, end: i64);
        fn frame_task_complete(task: Box<FrameTask>);
    }
}

#[derive(Clone, Copy)]
struct FrameTick {
    clock_id: u64,
    generation: u64,
}

// One process-wide channel; receivers filter by LynxView clock and runtime generation.
static FRAMES: LazyLock<broadcast::Sender<FrameTick>> = LazyLock::new(|| broadcast::channel(64).0);
static NEXT_CLOCK: AtomicU64 = AtomicU64::new(1);

trait Host: Send + Sync {
    fn post_runtime(&self, module: usize, task: Box<FrameTask>);
    fn request_vsync(&self, observer: usize, task: Box<FrameTask>);
    fn post_ui(&self, task: Box<FrameTask>);
}

#[cfg(not(test))]
struct NativeHost;

#[cfg(not(test))]
impl Host for NativeHost {
    fn post_runtime(&self, module: usize, task: Box<FrameTask>) {
        // The runtime mutex keeps the borrowed module alive through this call.
        unsafe { ffi::post_frame_task(module, task) };
    }
    fn request_vsync(&self, observer: usize, task: Box<FrameTask>) {
        // BTS serializes this registration with observer detach/destruction.
        unsafe { ffi::request_native_frame(observer, task) };
    }
    fn post_ui(&self, task: Box<FrameTask>) {
        ffi::post_frame_to_ui(task);
    }
}

struct Runtime {
    module: Option<usize>,
    observer: Option<usize>,
    generation: u64,
    pending: bool,
}

struct ClockState {
    id: u64,
    host: Arc<dyn Host>,
    runtime: Mutex<Runtime>,
    foreground: AtomicBool,
    listeners: AtomicUsize,
}

pub struct FrameClock {
    state: Arc<ClockState>,
}

impl FrameClock {
    fn new(module: usize, host: Arc<dyn Host>) -> Self {
        Self {
            state: Arc::new(ClockState {
                id: NEXT_CLOCK.fetch_add(1, Ordering::Relaxed),
                host,
                runtime: Mutex::new(Runtime {
                    module: Some(module),
                    observer: None,
                    generation: 0,
                    pending: false,
                }),
                foreground: AtomicBool::new(true),
                listeners: AtomicUsize::new(0),
            }),
        }
    }

    fn id(&self) -> u64 {
        self.state.id
    }

    // SAFETY: observer is borrowed from this extension, on BTS, until detach/destroy.
    unsafe fn attach_runtime(&self, observer: usize) {
        {
            let mut runtime = self.state.runtime.lock().unwrap();
            if runtime.module.is_none() {
                return;
            }
            runtime.observer = Some(observer);
            runtime.generation += 1;
            runtime.pending = false;
        }
        self.state.wake();
    }

    fn detach_runtime(&self) {
        let mut runtime = self.state.runtime.lock().unwrap();
        runtime.generation += 1;
        runtime.observer = None;
        runtime.pending = false;
    }

    fn destroy(&self) {
        self.detach_runtime();
        self.state.runtime.lock().unwrap().module = None;
    }

    fn set_foreground(&self, foreground: bool) {
        self.state.foreground.store(foreground, Ordering::Release);
        if foreground {
            self.state.wake();
        }
    }

    // C++ calls this once per view. The receiver and its lifetime remain in Rust.
    fn register_frame_listener(&self) -> Box<FrameListener> {
        Box::new(FrameListener {
            clock: self.state.clone(),
            receiver: Mutex::new(FRAMES.subscribe()),
            active: AtomicBool::new(false),
        })
    }
}

impl Drop for FrameClock {
    fn drop(&mut self) {
        // Listeners may outlive the extension owner, but must never reuse its handle.
        self.destroy();
    }
}

// SAFETY: module is a live extension with a BTS task runner, cleared before release.
unsafe fn create_frame_clock(module: usize) -> Box<FrameClock> {
    #[cfg(not(test))]
    let host = Arc::new(NativeHost);
    #[cfg(test)]
    let host = Arc::new(tests::TestHost::default());
    Box::new(FrameClock::new(module, host))
}

impl ClockState {
    fn wants_frames(&self) -> bool {
        self.foreground.load(Ordering::Acquire) && self.listeners.load(Ordering::Acquire) > 0
    }

    fn wake(self: &Arc<Self>) {
        let runtime = self.runtime.lock().unwrap();
        if !self.wants_frames() || runtime.observer.is_none() {
            return;
        }
        if let Some(module) = runtime.module {
            self.host.post_runtime(
                module,
                Box::new(FrameTask {
                    clock: Arc::downgrade(self),
                    generation: runtime.generation,
                }),
            );
        }
    }
}

pub struct FrameListener {
    clock: Arc<ClockState>,
    receiver: Mutex<broadcast::Receiver<FrameTick>>,
    active: AtomicBool,
}

impl FrameListener {
    fn set_active(&self, active: bool) {
        if self.active.swap(active, Ordering::AcqRel) == active {
            return;
        }
        if active {
            // Reattach must not consume frames accumulated while hidden/unbound.
            *self.receiver.lock().unwrap() = FRAMES.subscribe();
            self.clock.listeners.fetch_add(1, Ordering::AcqRel);
            self.clock.wake();
        } else {
            self.clock.listeners.fetch_sub(1, Ordering::AcqRel);
        }
    }

    fn take_frame(&self) -> bool {
        if !self.active.load(Ordering::Acquire) {
            return false;
        }
        let generation = self.clock.runtime.lock().unwrap().generation;
        let mut receiver = self.receiver.lock().unwrap();
        let mut received = false;
        loop {
            match receiver.try_recv() {
                Ok(tick) => {
                    received |= tick.clock_id == self.clock.id && tick.generation == generation;
                }
                // A slow receiver draws the latest grid; missed ticks are disposable.
                Err(TryRecvError::Lagged(_)) => continue,
                Err(TryRecvError::Empty | TryRecvError::Closed) => return received,
            }
        }
    }
}

impl Drop for FrameListener {
    fn drop(&mut self) {
        if *self.active.get_mut() {
            self.clock.listeners.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

pub struct FrameTask {
    clock: Weak<ClockState>,
    generation: u64,
}

impl FrameTask {
    fn clock_id(&self) -> u64 {
        self.clock.upgrade().map_or(0, |clock| clock.id)
    }

    fn is_current(&self) -> bool {
        self.clock.upgrade().is_some_and(|clock| {
            let runtime = clock.runtime.lock().unwrap();
            runtime.module.is_some()
                && runtime.observer.is_some()
                && runtime.generation == self.generation
                && clock.wants_frames()
        })
    }
}

fn frame_task_request(task: Box<FrameTask>) {
    let Some(clock) = task.clock.upgrade() else {
        return;
    };
    let observer = {
        let mut runtime = clock.runtime.lock().unwrap();
        if runtime.module.is_none()
            || runtime.generation != task.generation
            || runtime.pending
            || !clock.wants_frames()
        {
            return;
        }
        let Some(observer) = runtime.observer else {
            return;
        };
        runtime.pending = true;
        observer
    };
    clock.host.request_vsync(observer, task);
}

fn frame_task_vsync(task: Box<FrameTask>, start: i64, end: i64) {
    let Some(clock) = task.clock.upgrade() else {
        return;
    };
    if start == 0 || end == 0 || !task.is_current() {
        frame_task_complete(task);
        return;
    }
    let _ = FRAMES.send(FrameTick {
        clock_id: clock.id,
        generation: task.generation,
    });
    clock.host.post_ui(task);
}

#[expect(
    clippy::boxed_local,
    reason = "cxx transfers ownership of the completed native callback"
)]
fn frame_task_complete(task: Box<FrameTask>) {
    let Some(clock) = task.clock.upgrade() else {
        return;
    };
    {
        let mut runtime = clock.runtime.lock().unwrap();
        if runtime.generation != task.generation || runtime.module.is_none() {
            return;
        }
        runtime.pending = false;
    }
    // Renew only after C++ completed UI drawing and the synchronous GPU wait.
    clock.wake();
}

#[cfg(test)]
#[path = "tests/frame_clock.rs"]
mod tests;
