//! Lynx adapter; session owns its renderer, layout drives PTY/grid resizing.
use crate::frame::{FrameBuffer, Viewport};
use crate::renderer::create_terminal_renderer;
use crate::terminal_session::{SessionRenderer, TerminalHandle, acquire_terminal};

#[cxx::bridge(namespace = "catus")]
mod ffi {
    unsafe extern "C++" {
        include!("catus-native/src/frame.rs.h");
        type Viewport = crate::frame::Viewport;
        type FrameBuffer = crate::frame::FrameBuffer;
    }
    extern "Rust" {
        type TerminalHandle;
        fn acquire_terminal(id: u32) -> Result<Box<TerminalHandle>>;
        fn write(self: &TerminalHandle, text: &str) -> Result<()>;
        fn key(self: &TerminalHandle, key: &str, control: bool, alt: bool) -> Result<()>;
        fn resize_viewport(self: &TerminalHandle, viewport: &Viewport) -> Result<()>;
        fn viewport(self: &TerminalHandle) -> Result<Viewport>;
        fn metal_device(self: &TerminalHandle) -> Result<usize>;
        fn invalidate_frame(self: &TerminalHandle);
        fn needs_frame(self: &TerminalHandle) -> Result<bool>;
        unsafe fn render_frame(self: &TerminalHandle, frame: &FrameBuffer) -> Result<bool>;
    }
}

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

    pub(crate) fn viewport(&self) -> Result<Viewport, String> {
        self.session
            .rendering
            .lock()
            .unwrap()
            .as_ref()
            .map(|state| state.viewport)
            .ok_or_else(|| "Waiting for terminal layout".into())
    }

    fn metal_device(&self) -> Result<usize, String> {
        self.session
            .rendering
            .lock()
            .unwrap()
            .as_ref()
            .map(|state| state.renderer.metal_device())
            .ok_or_else(|| "Waiting for terminal layout".into())
    }

    fn invalidate_frame(&self) {
        if let Some(state) = self.session.rendering.lock().unwrap().as_mut() {
            state.renderer.invalidate_grid();
        }
    }

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

    // SAFETY: Native view lends an exclusive framebuffer on this session's MTLDevice.
    unsafe fn render_frame(&self, frame: &FrameBuffer) -> Result<bool, String> {
        let mut rendering = self.session.rendering.lock().unwrap();
        let state = rendering.as_mut().ok_or("Waiting for terminal layout")?;
        if !state
            .renderer
            .needs_grid(self.session.core.revision(), &state.viewport)?
        {
            return Ok(false);
        }
        let snapshot = self.session.core.snapshot();
        unsafe {
            state
                .renderer
                .render_grid(frame, &state.viewport, &snapshot)?;
        }
        Ok(true)
    }
}
