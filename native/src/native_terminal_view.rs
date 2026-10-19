//! Platform-independent Lynx terminal element lifecycle and session binding.
use crate::{
    binding::{
        native_view::{Handle, Layout, MotionEvent, NativeView, Reply, Target, Value, ViewFactory},
        protocol::{Event, Method, Property},
    },
    frame::Viewport,
    frame_callbacks::{FrameCallbacks, FrameRegistration, expired},
    platform::{TerminalPlatform, create_terminal_platform},
    terminal_session::{TerminalHandle, acquire_terminal},
    terminal_view::NativeScrollState,
};
use anyhow::{Context, Result, ensure};
use std::{
    cell::RefCell,
    time::{Duration, Instant},
};

pub(crate) struct TerminalHost {
    pub(crate) view: usize,
    pub(crate) frames: FrameCallbacks,
}

struct State {
    terminal: Option<Box<TerminalHandle>>,
    id: u32,
    last_scroll: Option<(u32, NativeScrollState)>,
    viewport: Viewport,
    attached: bool,
    needs_focus: bool,
    focus_pending: bool,
    renderer_retry: Option<Instant>,
    error: String,
}
impl Default for State {
    fn default() -> Self {
        Self {
            terminal: None,
            id: 0,
            last_scroll: None,
            viewport: Viewport {
                width: 0,
                height: 0,
                pixel_ratio: 1.,
            },
            attached: false,
            needs_focus: true,
            focus_pending: false,
            renderer_retry: None,
            error: String::new(),
        }
    }
}

pub(crate) struct NativeTerminalView {
    handle: Handle,
    platform: Box<TerminalPlatform>,
    frames: Box<FrameRegistration>,
    state: RefCell<State>,
}
impl ViewFactory for NativeTerminalView {
    type Context = TerminalHost;
    fn create(handle: Handle, target: Target<Self>, host: &TerminalHost) -> Result<Self> {
        let platform = create_terminal_platform(host.view, &handle)?;
        let frames = host.frames.register(move |deadline| {
            if let Err(error) = target.dispatch(|view| view.frame(deadline)) {
                eprintln!("Terminal frame: {error:#}");
            }
        });
        Ok(Self {
            handle,
            platform,
            frames,
            state: RefCell::new(State::default()),
        })
    }
}

impl NativeTerminalView {
    fn update_frames(&self, state: &State) {
        self.frames.set_active(
            state.attached
                && state.id != 0
                && state.terminal.is_some()
                && state.viewport.width != 0
                && state.viewport.height != 0,
        );
    }
    fn focus(&self) -> Result<()> {
        self.handle.request_focus()?;
        self.platform.focus();
        Ok(())
    }
    fn render(&self, state: &mut State, deadline: i64, force: bool) -> Result<()> {
        if expired(deadline) || state.id == 0 {
            return Ok(());
        }
        ensure!(
            state.attached && state.viewport.width != 0 && state.viewport.height != 0,
            "Waiting for an attached terminal and non-zero layout"
        );
        let terminal = state
            .terminal
            .as_ref()
            .context("Terminal is not attached")?;
        // A renderer is created on the first valid layout. If that allocation
        // failed transiently, retry here instead of leaving the view blank for
        // the rest of the process.
        if !terminal.has_renderer() {
            // Retry a transient initialization failure, but do not attempt a
            // failing GPU/font setup on every frame.
            let now = Instant::now();
            if state
                .renderer_retry
                .is_some_and(|retry| now.duration_since(retry) < Duration::from_secs(1))
            {
                return Ok(());
            }
            state.renderer_retry = Some(now);
            terminal.resize_viewport(&state.viewport)?;
        }
        if !self
            .platform
            .render(&self.handle, &state.viewport, deadline, force)?
        {
            return Ok(());
        }
        if expired(deadline) {
            terminal.invalidate_frame();
            return Ok(());
        }
        if self.platform.uses_osr()
            && let Err(error) = self.handle.swap_back()
        {
            terminal.invalidate_frame();
            return Err(error);
        }
        state.error.clear();
        if state.needs_focus {
            state.needs_focus = false;
            state.focus_pending = true;
        }
        Ok(())
    }
    fn frame(&self, deadline: i64) -> Result<()> {
        if expired(deadline) {
            return Ok(());
        }
        let Ok(mut state) = self.state.try_borrow_mut() else {
            return Ok(());
        };
        if let Err(error) = self.render(&mut state, deadline, false) {
            state.error = format!("{error:#}");
        }
        // A busy grid simply retries next RAF. Emit only scalar changes.
        let scroll = state
            .terminal
            .as_ref()
            .and_then(|terminal| terminal.scroll_state().ok())
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
        Ok(())
    }
}
fn scroll_value(id: u32, scroll: NativeScrollState) -> Result<Value> {
    let value = Value::map()?;
    for (name, number) in [
        (Property::SessionId, id),
        (Property::Offset, scroll.offset),
        (Property::HistoryRows, scroll.history_rows),
        (Property::VisibleRows, scroll.visible_rows),
    ] {
        value.set(name, &Value::integer(number.into())?)?;
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
        if let Some(terminal) = &state.terminal {
            terminal.invalidate_frame();
        }
        self.update_frames(&state);
        Ok(())
    }
    fn on_detach(&self) -> Result<()> {
        self.platform.detach();
        let mut state = self.state.borrow_mut();
        state.attached = false;
        self.update_frames(&state);
        Ok(())
    }
    fn on_destroy(&self) -> Result<()> {
        self.platform.destroy();
        let mut state = self.state.borrow_mut();
        state.attached = false;
        state.terminal = None;
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
            state.viewport.width = 0;
            state.viewport.height = 0;
            state.error = "Terminal layout is zero or exceeds the texture size limit".into();
            self.update_frames(&state);
            return Ok(());
        }
        state.viewport = Viewport {
            width: (width * pixel_ratio).ceil() as u32,
            height: (height * pixel_ratio).ceil() as u32,
            pixel_ratio,
        };
        if let Some(terminal) = &state.terminal
            && let Err(error) = terminal.resize_viewport(&state.viewport)
        {
            state.error = format!("{error:#}");
        }
        self.update_frames(&state);
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
        state.last_scroll = None;
        state.renderer_retry = None;
        if id == 0 {
            self.platform.clear_terminal();
            state.terminal = None;
            state.id = 0;
            state.error.clear();
        } else {
            let binding = (|| -> Result<_> {
                let terminal = acquire_terminal(id)?;
                if state.viewport.width != 0 && state.viewport.height != 0 {
                    terminal.resize_viewport(&state.viewport)?;
                }
                self.platform.bind_terminal(&terminal);
                terminal.invalidate_frame();
                Ok(terminal)
            })();
            match binding {
                Ok(terminal) => {
                    state.terminal = Some(terminal);
                    state.id = id;
                }
                Err(error) => {
                    state.error = format!("{error:#}");
                }
            }
        }
        self.update_frames(&state);
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
        let terminal = state
            .terminal
            .as_ref()
            .context("Terminal is not attached")?;
        match method {
            Method::ScrollTo | Method::GetScrollState => {
                if method == Method::ScrollTo {
                    ensure!(
                        params.get(Property::SessionId)?.u32()? == state.id,
                        "Terminal session changed"
                    );
                    terminal.scroll_to(params.get(Property::Offset)?.u32()?);
                }
                Ok(Reply::success(scroll_value(
                    state.id,
                    terminal.scroll_state()?,
                )?))
            }
            Method::Write => {
                terminal.write(&params.get(Property::Text)?.string()?)?;
                Ok(Reply::success(Value::boolean(true)?))
            }
            Method::Key => {
                terminal.key(
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
        self.frames.set_active(false);
    }
}
