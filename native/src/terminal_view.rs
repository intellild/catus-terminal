//! Lynx adapter; session owns its renderer, layout drives PTY/grid resizing.
use crate::frame::{FrameBuffer, Viewport};
use crate::renderer::create_terminal_renderer;
use crate::terminal_session::{SessionRenderer, TerminalHandle, acquire_terminal};

#[cxx::bridge(namespace = "catus")]
mod ffi {
    unsafe extern "C++" {
        include!("catus-native/src/frame.rs.h");
        type Viewport = crate::frame::Viewport;
    }
    extern "Rust" {
        type TerminalHandle;
        fn acquire_terminal(id: u32) -> Result<Box<TerminalHandle>>;
        fn write(self: &TerminalHandle, text: &str) -> Result<()>;
        fn key(self: &TerminalHandle, key: &str, control: bool, alt: bool) -> Result<()>;
        fn resize_viewport(self: &TerminalHandle, viewport: &Viewport) -> Result<()>;
        fn invalidate_frame(self: &TerminalHandle);
        unsafe fn render_surface(
            self: &TerminalHandle,
            iosurface: usize,
            deadline: i64,
        ) -> Result<bool>;
    }
}

#[cfg(test)]
#[path = "tests/terminal_rendering.rs"]
mod tests;

impl TerminalHandle {
    // Called by OnLayoutChanged, or when binding a session to an already-laid-out view.
    pub(crate) fn resize_viewport(&self, viewport: &Viewport) -> Result<(), String> {
        viewport.font_pixels()?;
        if viewport.width == 0 || viewport.height == 0 {
            return Err("Waiting for non-zero terminal layout".into());
        }
        let mut rendering = self.session.rendering.lock().unwrap();
        if rendering.is_none() {
            *rendering = Some(SessionRenderer {
                renderer: create_terminal_renderer()?,
                viewport: *viewport,
            });
        }
        let state = rendering.as_mut().unwrap();
        // Font advance and line height (including CoreText leading) determine cell size.
        self.session
            .core
            .resize(state.renderer.grid_size(viewport)?)?;
        state.viewport = *viewport;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn viewport(&self) -> Result<Viewport, String> {
        self.session
            .rendering
            .lock()
            .unwrap()
            .as_ref()
            .map(|state| state.viewport)
            .ok_or_else(|| "Waiting for terminal layout".into())
    }

    fn invalidate_frame(&self) {
        if let Some(state) = self.session.rendering.lock().unwrap().as_mut() {
            state.renderer.invalidate_grid();
        }
    }

    #[cfg(test)]
    fn needs_frame(&self) -> Result<bool, String> {
        if let Some(error) = self.session.core.error() {
            return Err(error);
        }
        let rendering = self.session.rendering.lock().unwrap();
        let state = rendering.as_ref().ok_or("Waiting for terminal layout")?;
        state
            .renderer
            .needs_grid(self.session.core.revision(), &state.viewport)
    }

    // SAFETY: C++ lends a live IOSurfaceRef exclusively until this returns.
    // Submitted GPU writes must finish even if the frame expires. Busy/idle/
    // expired ticks return false without retaining pending frame work.
    unsafe fn render_surface(&self, iosurface: usize, deadline: i64) -> Result<bool, String> {
        if crate::frame_callbacks::expired(deadline) {
            return Ok(false);
        }
        let Some(mut rendering) = try_lock(&self.session.rendering)? else {
            return Ok(false);
        };
        let state = rendering.as_mut().ok_or("Waiting for terminal layout")?;
        let Some(revision) = self.session.core.try_revision()? else {
            return Ok(false);
        };
        if state.renderer.try_needs_grid(revision, &state.viewport)? != Some(true) {
            return Ok(false);
        }
        let Some(snapshot) = self.session.core.try_snapshot()? else {
            return Ok(false);
        };
        unsafe {
            state.renderer.render_grid(
                &FrameBuffer { iosurface },
                &state.viewport,
                &snapshot,
                deadline,
            )
        }
    }
}

fn try_lock<T>(
    mutex: &std::sync::Mutex<T>,
) -> Result<Option<std::sync::MutexGuard<'_, T>>, String> {
    match mutex.try_lock() {
        Ok(guard) => Ok(Some(guard)),
        Err(std::sync::TryLockError::WouldBlock) => Ok(None),
        Err(std::sync::TryLockError::Poisoned(_)) => Err("Terminal renderer lock poisoned".into()),
    }
}
