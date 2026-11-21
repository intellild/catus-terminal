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

const DIRTY: u8 = 1;
const SCHEDULED: u8 = 2;

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
            frame_state: 0.into(),
        })
    }

    pub(crate) fn set_active(self: &Arc<Self>, active: bool) {
        if self.active.swap(active, Ordering::AcqRel) != active && active {
            self.schedule_render();
        }
    }

    pub(crate) fn schedule_render(self: &Arc<Self>) {
        if self.frame_state.fetch_or(DIRTY, Ordering::AcqRel) & SCHEDULED == 0 {
            self.request_frame_if_dirty();
        }
    }

    fn can_render(&self) -> bool {
        self.active.load(Ordering::Acquire) && self.foreground.load(Ordering::Acquire)
    }

    fn request_frame_if_dirty(self: &Arc<Self>) {
        while self.can_render()
            && self
                .frame_state
                .compare_exchange(DIRTY, SCHEDULED, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
        {
            let renderer = Arc::clone(self);
            if self
                .vsync
                .request_animation_frame(move |target| renderer.on_vsync(target))
            {
                return;
            }
            // Retry only if another update arrived while this request was in flight.
            if self.frame_state.swap(DIRTY, Ordering::AcqRel) & DIRTY == 0 {
                return;
            }
        }
    }

    fn on_vsync(self: &Arc<Self>, target: i64) {
        if target <= 0 || !self.can_render() {
            self.finish_frame(RenderOutcome::Idle);
            return;
        }
        if expired(target) {
            self.finish_frame(RenderOutcome::Retry);
            return;
        }
        let renderer = Arc::clone(self);
        post_task_to_ui(move || renderer.render_scheduled(target));
    }

    fn render_scheduled(self: &Arc<Self>, target: i64) {
        if !self.can_render() || expired(target) {
            self.finish_frame(RenderOutcome::Retry);
            return;
        }
        // This frame reads the current view and covers all updates up to here.
        // Updates arriving during the draw set DIRTY for the next frame.
        self.frame_state.fetch_and(!DIRTY, Ordering::AcqRel);
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
        self.finish_frame(outcome);
    }

    fn finish_frame(self: &Arc<Self>, outcome: RenderOutcome) {
        if outcome == RenderOutcome::Retry {
            self.frame_state.fetch_or(DIRTY, Ordering::Release);
        }
        if self.frame_state.fetch_and(!SCHEDULED, Ordering::AcqRel) & DIRTY != 0 {
            self.request_frame_if_dirty();
        }
    }
}
