use anyhow::{Context, Result, ensure};
use std::{
    cell::RefCell,
    sync::Arc,
    time::{Duration, Instant},
};

use crate::{
    binding::{
        native_view::{Handle, Layout, MotionEvent, NativeView, Reply, Target, Value, ViewFactory},
        protocol::{Event, Method, Property},
    },
    frame::{Viewport, expired},
    platform::create_terminal_platform,
    renderer::{FramePreparation, RenderOutcome, Renderer},
    terminal_content::TerminalContent,
    terminal_core::grid::ScrollState,
    terminal_extension::TerminalExtension,
    terminal_session::{Session, session},
};

use super::{NativeTerminalView, state::State};

impl ViewFactory for NativeTerminalView {
    type Context = TerminalExtension;
    fn create(handle: Handle, target: Target<Self>, extension: &TerminalExtension) -> Result<Self> {
        let view = *extension.lynx_view.get().context("Missing Lynx view")?;
        let renderer = Renderer::new(
            extension.vsync.clone(),
            Arc::clone(&extension.foreground),
            Some(target.clone()),
        );
        let platform = create_terminal_platform(view, &handle, target.clone())?;
        Ok(Self {
            attached_element: Arc::clone(&extension.attached_element),
            target,
            handle,
            platform,
            renderer,
            content: RefCell::default(),
            drawing: RefCell::default(),
            cells: None.into(),
            mouse: RefCell::default(),
            repaint: true.into(),
            viewport: None.into(),
            state: RefCell::new(State::default()),
        })
    }
}

impl NativeTerminalView {
    pub(crate) fn session(&self) -> Result<Arc<Session>> {
        self.content
            .borrow()
            .as_ref()
            .map(|content| Arc::clone(&content.session))
            .context("Terminal is not bound")
    }
    fn attach_session(&self) {
        if let Some(content) = self.content.borrow().as_ref() {
            content.session.attach(Arc::downgrade(&self.renderer));
        }
    }
    fn detach_session(&self) {
        if let Some(content) = self.content.borrow().as_ref() {
            content.session.detach(&Arc::downgrade(&self.renderer));
        }
    }
    fn bind(&self, next: Option<Arc<Session>>, attached: bool) -> Result<()> {
        if let (Some(session), Some(viewport)) = (&next, self.viewport.get()) {
            session.resize(self.cells_for(&viewport)?.size)?;
        }
        self.detach_session();
        self.content.replace(next.map(TerminalContent::new));
        self.mouse.replace(Default::default());
        if attached {
            self.attach_session();
        }
        self.invalidate_frame();
        Ok(())
    }
    pub(crate) fn invalidate_frame(&self) {
        self.repaint.set(true);
        self.renderer.schedule_render();
    }
    pub(crate) fn set_preedit(&self, text: String) {
        if let Some(content) = self.content.borrow_mut().as_mut()
            && content.preedit != text
        {
            content.preedit = text;
            self.invalidate_frame();
        }
    }
    fn cells_for(&self, viewport: &Viewport) -> Result<crate::frame::CellLayout> {
        if let Some(cells) = self.cells.get() {
            return Ok(cells);
        }
        let cells = self.renderer.measure_cells(viewport)?;
        self.cells.set(Some(cells));
        Ok(cells)
    }

    pub(crate) fn cell_geometry(&self) -> Option<crate::frame::CellGeometry> {
        self.cells.get().map(|cells| cells.geometry)
    }
    fn resize_session(&self, viewport: &Viewport) -> Result<()> {
        if let Some(content) = self.content.borrow().as_ref() {
            content.session.resize(self.cells_for(viewport)?.size)?;
        }
        Ok(())
    }

    fn update_frames(&self, state: &State) {
        self.renderer
            .set_active(state.attached && state.id != 0 && self.viewport.get().is_some());
    }
    fn focus(&self) -> Result<()> {
        self.handle.request_focus()?;
        self.platform.focus();
        Ok(())
    }
    fn render(&self, state: &mut State, deadline: i64, force: bool) -> Result<RenderOutcome> {
        if state.id == 0 {
            return Ok(RenderOutcome::Idle);
        }
        if expired(deadline) {
            return Ok(RenderOutcome::Retry);
        }
        ensure!(state.attached, "Waiting for an attached terminal");
        let viewport = self.viewport.get().context("Waiting for terminal layout")?;
        if let Some(retry) = state.renderer_retry {
            let now = Instant::now();
            if now < retry {
                return Ok(RenderOutcome::Retry);
            }
            state.renderer_retry = Some(now + Duration::from_secs(1));
            self.resize_session(&viewport)?;
            state.renderer_retry = None;
        }
        if !self.platform.can_present(force) {
            return Ok(RenderOutcome::Idle);
        }
        let mut drawing = self.drawing.borrow_mut();
        if self.repaint.replace(false) {
            drawing.invalidate();
        }
        let prepared = self.renderer.prepare_frame(
            &mut drawing,
            self.content
                .borrow()
                .as_ref()
                .context("Terminal is not bound")?,
            viewport,
            deadline,
        )?;
        let mut frame = match prepared {
            FramePreparation::Ready(frame) => frame,
            FramePreparation::Idle => return Ok(RenderOutcome::Idle),
            FramePreparation::Deferred => return Ok(RenderOutcome::Retry),
        };
        let cursor = frame.insertion_point();
        match self.platform.present(&self.handle, &mut frame) {
            Ok(RenderOutcome::Presented) => (),
            result => {
                self.repaint.set(true);
                return result;
            }
        }
        if let Some(geometry) = self.cell_geometry() {
            self.platform.update_cursor(geometry.cursor_rect(cursor));
        }
        if let Ok(scroll) = self.session()?.scroll_state() {
            self.platform.update_overlay(scroll.history_rows);
        }
        // Platform rendering presents only frames that are still within their
        // deadline, so a successful return is already the final word.
        state.error.clear();
        if state.needs_focus {
            state.needs_focus = false;
            state.focus_pending = true;
        }
        Ok(RenderOutcome::Presented)
    }
    pub(crate) fn frame(&self, deadline: i64) -> Result<RenderOutcome> {
        let Ok(mut state) = self.state.try_borrow_mut() else {
            return Ok(RenderOutcome::Retry);
        };
        let outcome = match self.render(&mut state, deadline, false) {
            Ok(outcome) => outcome,
            Err(error) => {
                state.error = format!("{error:#}");
                RenderOutcome::Retry
            }
        };
        // A busy grid simply retries next RAF. Emit only scalar changes.
        let scroll = self
            .session()
            .and_then(|session| session.scroll_state())
            .ok()
            .and_then(|scroll| {
                let value = (state.id, scroll);
                if state.last_scroll == Some(value) {
                    return None;
                }
                state.last_scroll = Some(value);
                Some(value)
            });
        let focus = std::mem::take(&mut state.focus_pending);
        drop(state);
        if let Some((id, scroll)) = scroll {
            self.handle
                .trigger_event(Event::ScrollChange, scroll_value(id, scroll)?)?;
        }
        if focus {
            self.focus()?;
        }
        Ok(outcome)
    }
}
fn scroll_value(id: u32, scroll: ScrollState) -> Result<Value> {
    let value = Value::map()?;
    for (name, number) in [
        (Property::SessionId, usize::try_from(id)?),
        (Property::Offset, scroll.offset),
        (Property::HistoryRows, scroll.history_rows),
        (Property::VisibleRows, scroll.visible_rows),
    ] {
        value.set(name, &Value::integer(number.try_into()?)?)?;
    }
    Ok(value)
}

impl NativeView for NativeTerminalView {
    fn is_surface_enabled(&self) -> bool {
        self.platform.uses_osr()
    }
    fn on_attach(&self) -> Result<()> {
        self.platform.attach();
        let mut state = self.state.borrow_mut();
        state.attached = true;
        self.attached_element.attach(&self.target);
        self.attach_session();
        self.update_frames(&state);
        self.invalidate_frame();
        Ok(())
    }
    fn on_detach(&self) -> Result<()> {
        self.attached_element.detach(&self.target);
        self.platform.detach();
        self.detach_session();
        let mut state = self.state.borrow_mut();
        state.attached = false;
        self.update_frames(&state);
        Ok(())
    }
    fn on_destroy(&self) -> Result<()> {
        self.attached_element.detach(&self.target);
        self.platform.destroy();
        let mut state = self.state.borrow_mut();
        state.attached = false;
        self.bind(None, false)?;
        state.id = 0;
        self.update_frames(&state);
        Ok(())
    }
    fn on_layout_changed(&self, layout: Layout) -> Result<()> {
        let Layout {
            left,
            top,
            width,
            height,
            pixel_ratio,
        } = layout;
        self.platform.layout(left, top, width, height, pixel_ratio);
        let mut state = self.state.borrow_mut();
        if ![width, height, pixel_ratio].into_iter().all(f32::is_finite)
            || pixel_ratio <= 0.
            || width <= 0.
            || height <= 0.
            || width * pixel_ratio > 8192.
            || height * pixel_ratio > 8192.
        {
            self.viewport.set(None);
            self.cells.set(None);
            state.renderer_retry = None;
            state.error = "Terminal layout is zero or exceeds the texture size limit".into();
            self.update_frames(&state);
            return Ok(());
        }
        let viewport = Viewport {
            width: (width * pixel_ratio).ceil() as u32,
            height: (height * pixel_ratio).ceil() as u32,
            pixel_ratio,
        };
        if self.viewport.replace(Some(viewport)) != Some(viewport) {
            self.cells.set(None);
        }
        state.renderer_retry = None;
        if let Err(error) = self.resize_session(&viewport) {
            state.error = format!("{error:#}");
            state.renderer_retry = Some(Instant::now() + Duration::from_secs(1));
        }
        self.update_frames(&state);
        self.renderer.schedule_render();
        Ok(())
    }
    fn on_properties_changed(&self, attrs: &Value, _events: &Value) -> Result<()> {
        if let Ok(osr) = attrs.get(Property::UseOsr)
            && !osr.is_null()
        {
            self.platform.set_osr(osr.bool());
        }
        let Ok(id) = attrs
            .get(Property::TerminalId)
            .and_then(|value| value.u32())
        else {
            return Ok(());
        };
        let mut state = self.state.borrow_mut();
        if id == state.id {
            return Ok(());
        }
        let next = if id == 0 {
            Ok(None)
        } else {
            session(id).map(Some)
        };
        if let Err(error) = next.and_then(|next| self.bind(next, state.attached)) {
            state.error = format!("{error:#}");
            return Ok(());
        }
        state.id = id;
        state.last_scroll = None;
        state.renderer_retry = None;
        state.error.clear();
        self.platform.set_bound(id != 0);
        self.update_frames(&state);
        self.renderer.schedule_render();
        Ok(())
    }
    fn on_focus_changed(&self, focused: bool, leaf: bool) -> Result<()> {
        if focused && leaf {
            self.platform.focus();
        } else {
            self.platform.blur();
        }
        Ok(())
    }
    fn on_motion_event(&self, event: &MotionEvent) -> Result<()> {
        self.platform.motion_event(&self.handle, event)
    }
    fn on_method_invoked(&self, method: Method, params: &Value) -> Result<Reply> {
        if method == Method::Focus {
            self.focus()?;
            return Ok(Reply::success(Value::boolean(true)?));
        }
        let mut state = self.state.borrow_mut();
        if method == Method::RenderFrame {
            let result = self.render(&mut state, i64::MAX, true);
            if let Err(error) = &result {
                state.error = format!("{error:#}");
            }
            let focus = std::mem::take(&mut state.focus_pending);
            drop(state);
            if focus {
                self.focus()?;
            }
            result?;
            return Ok(Reply::success(Value::boolean(true)?));
        }
        if method == Method::Unknown {
            return Ok(Reply::method_not_found());
        }
        let session = self.session()?;
        match method {
            Method::ScrollTo | Method::GetScrollState => {
                if method == Method::ScrollTo {
                    ensure!(
                        params.get(Property::SessionId)?.u32()? == state.id,
                        "Terminal session changed"
                    );
                    session.scroll_to(params.get(Property::Offset)?.u32()? as usize);
                }
                Ok(Reply::success(scroll_value(
                    state.id,
                    session.scroll_state()?,
                )?))
            }
            Method::Write => {
                session.write(params.get(Property::Text)?.string()?.into_bytes())?;
                Ok(Reply::success(Value::boolean(true)?))
            }
            Method::Key => {
                session.key(
                    &params.get(Property::Key)?.string()?,
                    params
                        .get(Property::Control)
                        .is_ok_and(|value| value.bool()),
                    params.get(Property::Alt).is_ok_and(|value| value.bool()),
                )?;
                Ok(Reply::success(Value::boolean(true)?))
            }
            Method::Focus | Method::RenderFrame | Method::Unknown => unreachable!(),
        }
    }
}
impl Drop for NativeTerminalView {
    fn drop(&mut self) {
        self.renderer.set_active(false);
        self.detach_session();
    }
}
