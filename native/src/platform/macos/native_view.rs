//! Lynx/AppKit host adaptation; the shared element never handles OS pointers.
use super::input_view::InputEvent;
use super::terminal::ffi::{NativeMouseEvent, NativeViewHost};
use super::view::{MacTerminalView, create_mac_terminal_view};
use crate::native_terminal_view::NativeTerminalView;
use crate::{
    binding::native_view::{Handle, MotionEvent, RawView, Target},
    binding::types::{MotionKind, SignalKind},
    binding::{extension::LynxView, host},
    renderer::{PreparedFrame, RenderOutcome},
};
use anyhow::Result;

pub(crate) fn create_terminal_platform(
    view: usize,
    handle: &Handle,
    target: Target<NativeTerminalView>,
) -> Result<Box<MacTerminalView>> {
    let view = view as *mut LynxView;
    // SAFETY: Native view factories run on UI while their Lynx view is alive.
    unsafe {
        create_mac_terminal_view(
            &NativeViewHost {
                parent: host::native_window(view) as usize,
                lynx_view: view as usize,
                native_view: handle.as_ptr()?.as_ptr() as usize,
                request_focus: Some(request_focus),
                register_ime: Some(register_ime),
            },
            move |event| target.dispatch(|element| element.platform_event(event)),
        )
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
    pub(crate) fn present(
        &self,
        handle: &Handle,
        frame: &mut PreparedFrame<'_>,
    ) -> Result<RenderOutcome> {
        if self.uses_osr() {
            self.present_osr(handle, frame)
        } else {
            self.present_native(frame)
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

impl NativeTerminalView {
    fn platform_event(&self, event: InputEvent) -> Result<()> {
        let Ok(session) = self.session() else {
            return Ok(());
        };
        match event {
            InputEvent::Redraw => self.invalidate_frame(),
            InputEvent::Preedit(text) => self.set_preedit(text),
            InputEvent::Text(text) => session.write(text.into_bytes())?,
            InputEvent::Paste(text) => session.paste(&text)?,
            InputEvent::Key { key, control, alt } => session.key(&key, control, alt)?,
            InputEvent::Mouse(event) => {
                self.mouse
                    .borrow_mut()
                    .input(&session, self.cell_geometry(), &event)?;
            }
            InputEvent::Copy => {
                if let Some(text) = session.selected_text() {
                    let board = objc2_app_kit::NSPasteboard::generalPasteboard();
                    board.clearContents();
                    unsafe {
                        board.setString_forType(
                            &objc2_foundation::NSString::from_str(&text),
                            objc2_app_kit::NSPasteboardTypeString,
                        );
                    }
                }
            }
        }
        Ok(())
    }
}
