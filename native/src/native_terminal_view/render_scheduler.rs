use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU64, Ordering},
};

use crate::{
    binding::VsyncObserver, frame::expired, platform::post_task_to_ui, terminal_view::RenderOutcome,
};

/// Coalesces grid/state changes into one VSync-synchronized render.
pub(super) struct RenderScheduler {
    vsync: VsyncObserver,
    foreground: Arc<AtomicBool>,
    render: Box<dyn Fn(i64) -> RenderOutcome + Send + Sync>,
    active: AtomicBool,
    dirty: AtomicBool,
    /// One render is in flight: waiting for VSync or for the UI task to run.
    scheduled: AtomicBool,
    /// Invalidates callbacks from a previous active/inactive transition.
    generation: AtomicU64,
}

impl RenderScheduler {
    pub(super) fn new(
        vsync: VsyncObserver,
        foreground: Arc<AtomicBool>,
        render: Box<dyn Fn(i64) -> RenderOutcome + Send + Sync>,
    ) -> Arc<Self> {
        Arc::new(Self {
            vsync,
            foreground,
            render,
            active: AtomicBool::new(false),
            dirty: AtomicBool::new(false),
            scheduled: AtomicBool::new(false),
            generation: AtomicU64::new(0),
        })
    }

    pub(super) fn set_active(self: &Arc<Self>, active: bool) {
        if self.active.swap(active, Ordering::AcqRel) == active {
            return;
        }
        self.generation.fetch_add(1, Ordering::AcqRel);
        self.dirty.store(false, Ordering::Release);
        self.scheduled.store(false, Ordering::Release);
        if active {
            self.schedule();
        }
    }

    pub(super) fn schedule(self: &Arc<Self>) {
        self.dirty.store(true, Ordering::Release);
        if !self.active.load(Ordering::Acquire) || self.scheduled.swap(true, Ordering::AcqRel) {
            return;
        }
        let generation = self.generation.load(Ordering::Acquire);
        let scheduler = Arc::clone(self);
        if !self
            .vsync
            .request_animation_frame(move |target| scheduler.on_vsync(generation, target))
            && self.generation.load(Ordering::Acquire) == generation
        {
            self.scheduled.store(false, Ordering::Release);
        }
    }

    fn on_vsync(self: &Arc<Self>, generation: u64, target: i64) {
        if self.generation.load(Ordering::Acquire) != generation {
            return;
        }
        if !self.active.load(Ordering::Acquire)
            || target <= 0
            || !self.dirty.swap(false, Ordering::AcqRel)
        {
            self.scheduled.store(false, Ordering::Release);
            self.schedule_if_dirty();
            return;
        }
        // Keep `scheduled` set while the UI task is pending, so another grid
        // update cannot queue a second render.
        let scheduler = Arc::clone(self);
        let task: Box<dyn FnOnce() + Send> =
            Box::new(move || scheduler.render_scheduled(generation, target));
        post_task_to_ui(Box::into_raw(Box::new(task)) as usize);
    }

    fn render_scheduled(self: &Arc<Self>, generation: u64, target: i64) {
        if self.generation.load(Ordering::Acquire) != generation {
            return;
        }
        if !self.active.load(Ordering::Acquire) {
            self.scheduled.store(false, Ordering::Release);
            return;
        }
        if expired(target) {
            self.scheduled.store(false, Ordering::Release);
            self.dirty.store(true, Ordering::Release);
            self.schedule();
            return;
        }
        if !self.foreground.load(Ordering::Acquire) {
            self.scheduled.store(false, Ordering::Release);
            self.dirty.store(true, Ordering::Release);
            return;
        }
        let outcome = (self.render)(target);
        self.scheduled.store(false, Ordering::Release);
        if outcome == RenderOutcome::Retry {
            self.dirty.store(true, Ordering::Release);
        }
        self.schedule_if_dirty();
    }

    fn schedule_if_dirty(self: &Arc<Self>) {
        if self.dirty.load(Ordering::Acquire) {
            self.schedule();
        }
    }
}
