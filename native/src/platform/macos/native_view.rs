//! Lynx/AppKit host adaptation; the shared element never handles OS pointers.
use super::terminal::ffi::{NativeMouseEvent, NativeViewHost};
use super::view::{MacTerminalView, create_mac_terminal_view};
use crate::{
    binding::native_view::{Handle, MotionEvent, RawView},
    binding::types::{MotionKind, SignalKind},
    binding::{extension::LynxView, host},
    frame::Viewport,
};
use anyhow::Result;

pub(crate) fn create_terminal_platform(
    view: usize,
    handle: &Handle,
) -> Result<Box<MacTerminalView>> {
    let view = view as *mut LynxView;
    // SAFETY: Native view factories run on UI while their Lynx view is alive.
    unsafe {
        create_mac_terminal_view(&NativeViewHost {
            parent: host::native_window(view) as usize,
            lynx_view: view as usize,
            native_view: handle.as_ptr()?.as_ptr() as usize,
            request_focus: Some(request_focus),
            register_ime: Some(register_ime),
        })
    }
}
unsafe extern "C" fn request_focus(view: usize) {
    unsafe {
        host::request_native_focus(view as *mut RawView);
    }
}
unsafe extern "C" fn register_ime(view: usize, handler: usize, opaque: usize) {
    unsafe {
        host::register_ime_handler(view as *mut LynxView, handler as *mut _, opaque as *mut _);
    }
}
impl MacTerminalView {
    pub(crate) fn render(
        &self,
        handle: &Handle,
        viewport: &Viewport,
        deadline: i64,
        force: bool,
    ) -> Result<bool> {
        if !self.uses_osr() {
            return self.render_native(deadline, force);
        }
        let surface = handle.acquire_surface(viewport.width, viewport.height)?;
        // SAFETY: On macOS the SDK surface handle is IOSurfaceRef. GPU work
        // completes inside render_osr, before this borrowed buffer is returned.
        unsafe {
            self.render_osr(
                &*surface.as_ptr().cast::<objc2_io_surface::IOSurfaceRef>(),
                deadline,
            )
        }
    }
    pub(crate) fn motion_event(&self, handle: &Handle, event: &MotionEvent) -> Result<()> {
        if event.kind == MotionKind::Down {
            handle.request_focus()?;
            self.focus();
        }
        if !self.uses_osr() {
            return Ok(());
        }
        let kind = if event.signal == SignalKind::Scroll || event.kind == MotionKind::PanZoomUpdate
        {
            4
        } else {
            match event.kind {
                MotionKind::Down => 1,
                MotionKind::Up => 2,
                MotionKind::Move | MotionKind::Hover => 3,
                MotionKind::Cancel => 5,
                _ => return Ok(()),
            }
        };
        self.motion(&NativeMouseEvent {
            kind,
            x: event.x,
            y: event.y,
            wheel: -f64::from(event.delta_y),
            precise: true,
            buttons: event.buttons,
            shift: event.shift,
            control: event.control,
            alt: event.alt,
            clicks: 0,
        });
        Ok(())
    }
}
