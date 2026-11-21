use bitflags::bitflags;
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

bitflags! {
    struct FrameState: u8 {
        const DIRTY = 0b01;
        const SCHEDULED = 0b10;
    }
}

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
            frame_state: FrameState::empty().bits().into(),
        })
    }

    pub(crate) fn set_active(self: &Arc<Self>, active: bool) {
        if self.active.swap(active, Ordering::AcqRel) != active && active {
            self.schedule_render();
        }
    }

    pub(crate) fn schedule_render(self: &Arc<Self>) {
        let previous = self
            .frame_state
            .fetch_or(FrameState::DIRTY.bits(), Ordering::AcqRel);
        if !FrameState::from_bits_retain(previous).contains(FrameState::SCHEDULED) {
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
                .compare_exchange(
                    FrameState::DIRTY.bits(),
                    FrameState::SCHEDULED.bits(),
                    Ordering::AcqRel,
                    Ordering::Acquire,
                )
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
            let previous = self
                .frame_state
                .swap(FrameState::DIRTY.bits(), Ordering::AcqRel);
            if !FrameState::from_bits_retain(previous).contains(FrameState::DIRTY) {
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
        self.frame_state
            .fetch_and(!FrameState::DIRTY.bits(), Ordering::AcqRel);
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
            self.frame_state
                .fetch_or(FrameState::DIRTY.bits(), Ordering::Release);
        }
        let previous = self
            .frame_state
            .fetch_and(!FrameState::SCHEDULED.bits(), Ordering::AcqRel);
        if FrameState::from_bits_retain(previous).contains(FrameState::DIRTY) {
            self.request_frame_if_dirty();
        }
    }
}
