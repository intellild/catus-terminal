use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use crate::{
    binding::{VsyncObserver, native_view::Target},
    frame::expired,
    native_terminal_view::NativeTerminalView,
    platform::post_task_to_ui,
    renderer::RenderOutcome,
};

use super::Renderer;

impl Renderer {
    pub(crate) fn new(
        vsync: VsyncObserver,
        foreground: Arc<AtomicBool>,
        target: Option<Target<NativeTerminalView>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            vsync,
            foreground,
            target,
            active: AtomicBool::new(false),
            dirty: AtomicBool::new(false),
            scheduled: AtomicBool::new(false),
            generation: 0.into(),
        })
    }

    #[cfg(test)]
    pub(crate) fn offscreen() -> Arc<Self> {
        Self::new(
            VsyncObserver::default(),
            Arc::new(AtomicBool::new(true)),
            None,
        )
    }

    #[cfg(test)]
    pub(crate) fn take_dirty(&self) -> bool {
        self.dirty.swap(false, Ordering::AcqRel)
    }

    pub(crate) fn set_active(self: &Arc<Self>, active: bool) {
        if self.active.swap(active, Ordering::AcqRel) == active {
            return;
        }
        self.generation.fetch_add(1, Ordering::AcqRel);
        self.dirty.store(false, Ordering::Release);
        self.scheduled.store(false, Ordering::Release);
        if active {
            self.schedule_render();
        }
    }

    pub(crate) fn schedule_render(self: &Arc<Self>) {
        self.dirty.store(true, Ordering::Release);
        if !self.active.load(Ordering::Acquire) || self.scheduled.swap(true, Ordering::AcqRel) {
            return;
        }
        let generation = self.generation.load(Ordering::Acquire);
        let renderer = Arc::clone(self);
        if !self
            .vsync
            .request_animation_frame(move |target| renderer.on_vsync(generation, target))
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
        let renderer = Arc::clone(self);
        post_task_to_ui(move || renderer.render_scheduled(generation, target));
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
            self.schedule_render();
            return;
        }
        if !self.foreground.load(Ordering::Acquire) {
            self.scheduled.store(false, Ordering::Release);
            self.dirty.store(true, Ordering::Release);
            return;
        }
        let mut outcome = RenderOutcome::Idle;
        if let Some(view) = &self.target
            && let Err(error) = view.dispatch(|view| {
                outcome = view.frame(target)?;
                Ok(())
            })
        {
            eprintln!("Terminal frame: {error:#}");
            outcome = RenderOutcome::Retry;
        }
        self.scheduled.store(false, Ordering::Release);
        if outcome == RenderOutcome::Retry {
            self.dirty.store(true, Ordering::Release);
        }
        self.schedule_if_dirty();
    }

    fn schedule_if_dirty(self: &Arc<Self>) {
        if self.dirty.load(Ordering::Acquire) {
            self.schedule_render();
        }
    }
}
