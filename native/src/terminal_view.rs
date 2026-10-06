//! Shared view orchestration; layout drives PTY/grid resizing and session rendering.
use crate::frame::Viewport;
use crate::renderer::create_terminal_renderer;
use crate::terminal_session::{SessionRenderer, TerminalHandle};
use anyhow::{Context, Result, anyhow};

impl TerminalHandle {
    // Called by OnLayoutChanged, or when binding a session to an already-laid-out view.
    pub(crate) fn resize_viewport(&self, viewport: &Viewport) -> Result<()> {
        viewport.font_pixels()?;
        if viewport.width == 0 || viewport.height == 0 {
            return Err(anyhow!("Waiting for non-zero terminal layout"));
        }
        let mut rendering = self.session.rendering.lock().unwrap();
        if rendering.is_none() {
            *rendering = Some(SessionRenderer {
                renderer: create_terminal_renderer()?,
                viewport: *viewport,
            });
        }
        let state = rendering.as_mut().unwrap();
        // Font advance and line height (including font leading) determine cell size.
        self.session
            .core
            .resize(state.renderer.grid_size(viewport)?)?;
        state.viewport = *viewport;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn viewport(&self) -> Result<Viewport> {
        self.session
            .rendering
            .lock()
            .unwrap()
            .as_ref()
            .map(|state| state.viewport)
            .context("Waiting for terminal layout")
    }

    pub(crate) fn invalidate_frame(&self) {
        if let Some(state) = self.session.rendering.lock().unwrap().as_mut() {
            state.renderer.invalidate_grid();
        }
    }

    #[cfg(test)]
    pub(crate) fn needs_frame(&self) -> Result<bool> {
        if let Some(error) = self.session.core.error() {
            return Err(error);
        }
        let rendering = self.session.rendering.lock().unwrap();
        let state = rendering.as_ref().context("Waiting for terminal layout")?;
        state
            .renderer
            .needs_grid(self.session.core.revision(), &state.viewport)
    }

    // Busy, idle and expired ticks never prepare a native render target.
    pub(crate) fn render_frame(
        &self,
        deadline: i64,
        prepare_target: impl FnOnce(&wgpu::Device, &Viewport) -> Result<wgpu::Texture>,
    ) -> Result<bool> {
        if crate::frame_callbacks::expired(deadline) {
            return Ok(false);
        }
        let Some(mut rendering) = try_lock(&self.session.rendering)? else {
            return Ok(false);
        };
        let state = rendering.as_mut().context("Waiting for terminal layout")?;
        let Some(revision) = self.session.core.try_revision()? else {
            return Ok(false);
        };
        if state.renderer.try_needs_grid(revision, &state.viewport)? != Some(true) {
            return Ok(false);
        }
        let Some(snapshot) = self.session.core.try_snapshot()? else {
            return Ok(false);
        };
        state
            .renderer
            .render_grid(&state.viewport, &snapshot, deadline, |device| {
                prepare_target(device, &state.viewport)
            })
    }
}

fn try_lock<T>(mutex: &std::sync::Mutex<T>) -> Result<Option<std::sync::MutexGuard<'_, T>>> {
    match mutex.try_lock() {
        Ok(guard) => Ok(Some(guard)),
        Err(std::sync::TryLockError::WouldBlock) => Ok(None),
        Err(std::sync::TryLockError::Poisoned(_)) => {
            Err(anyhow!("Terminal renderer lock poisoned"))
        }
    }
}
