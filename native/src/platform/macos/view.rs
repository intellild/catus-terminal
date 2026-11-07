//! Rust ownership of the AppKit view, Metal layer and CEF-style OSR input route.
use super::input_view::{InputEvent, InputState, InputView};
use super::osr::OsrSurfaces;
use super::terminal::ffi::{NativeMouseEvent, NativeViewHost};
use crate::{binding::native_view::Handle, frame::Viewport, terminal_session::TerminalHandle};
use anyhow::{Context, Result};
use objc2::{ClassType, MainThreadOnly, rc::Retained, runtime::ProtocolObject};
use objc2_app_kit::{NSEvent, NSEventType, NSTextInputContext, NSView, NSWindowOcclusionState};
use objc2_foundation::{MainThreadMarker, NSPoint, NSRect, NSSize};
use objc2_quartz_core::{CALayer, CAMetalLayer};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

pub struct MacTerminalView {
    host: NativeViewHost,
    input: Retained<InputView>,
    state: Rc<InputState>,
    layer: Retained<CAMetalLayer>,
    terminal: Rc<RefCell<Option<TerminalHandle>>>,
    osr_surfaces: RefCell<OsrSurfaces>,
    context: RefCell<Option<Retained<NSTextInputContext>>>,
    osr: Cell<bool>,
    explicit_osr: Cell<bool>,
    attached: Cell<bool>,
    overlay_mask: Cell<Option<(f64, f64, f64)>>,
}

/// Create the Rust-owned native terminal adapter.
///
/// # Safety
/// The host must lend live AppKit/Lynx handles and C function pointers with the
/// declared signatures. Callbacks and the adapter must stay on the UI thread.
pub unsafe fn create_mac_terminal_view(host: &NativeViewHost) -> Result<Box<MacTerminalView>> {
    let mtm =
        MainThreadMarker::new().context("Terminal NSView must be created on the UI thread")?;
    let parent = unsafe { (host.parent as *const NSView).as_ref() };
    let terminal = Rc::new(RefCell::new(None::<TerminalHandle>));
    let binding = terminal.clone();
    let host = *host;
    let state = InputState::new(
        parent,
        move |event| {
            if let Some(terminal) = binding.borrow().as_ref() {
                match event {
                    InputEvent::Text(text) => terminal.write(&text)?,
                    InputEvent::Paste(text) => terminal.paste(&text)?,
                    InputEvent::Key { key, control, alt } => terminal.key(&key, control, alt)?,
                    InputEvent::Preedit(text) => terminal.set_preedit(&text),
                    InputEvent::Mouse(event) => terminal.mouse_input(&event)?,
                    InputEvent::Copy => {
                        if let Some(text) = terminal.session.core.selected_text() {
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
            }
            Ok(())
        },
        move || {
            if let Some(callback) = host.request_focus {
                unsafe {
                    callback(host.native_view);
                }
            }
        },
    );
    let input = InputView::new(mtm, state.clone());
    input.setHidden(true);
    let layer = CAMetalLayer::layer();
    layer.setAllowsNextDrawableTimeout(true);
    input.setLayer(Some(&layer));
    input.setWantsLayer(true);
    Ok(Box::new(MacTerminalView {
        host,
        input,
        state,
        layer,
        terminal,
        osr_surfaces: RefCell::new(OsrSurfaces::default()),
        context: RefCell::new(None),
        osr: Cell::new(parent.is_none_or(|parent| parent.window().is_none())),
        explicit_osr: Cell::new(false),
        attached: Cell::new(false),
        overlay_mask: Cell::new(None),
    }))
}

impl MacTerminalView {
    fn assert_ui(&self) {
        MainThreadMarker::new().expect("Terminal view requires the UI thread");
    }
    fn parent(&self) -> Option<Retained<NSView>> {
        self.state.host.as_ref().and_then(objc2::rc::Weak::load)
    }
    pub fn uses_osr(&self) -> bool {
        self.assert_ui();
        self.osr.get()
    }
    pub fn set_osr(&self, requested: bool) {
        self.assert_ui();
        // An explicit `use-osr` prop owns the mode; do not switch it later.
        self.explicit_osr.set(true);
        self.apply_osr(requested);
    }
    fn apply_osr(&self, requested: bool) {
        let osr = requested || self.parent().is_none_or(|parent| parent.window().is_none());
        if self.osr.replace(osr) != osr {
            self.blur();
            self.input.removeFromSuperview();
            if let Some(terminal) = self.terminal.borrow().as_ref() {
                terminal.invalidate_frame();
            }
            self.attach_view();
        }
    }
    /// The host window may not exist yet when Lynx creates the view during a
    /// cold launch. The automatic OSR choice must not stay frozen in that state:
    /// once the window appears, switch to the embedded CAMetalLayer and attach.
    fn refresh_osr(&self) {
        if self.explicit_osr.get() || !self.osr.get() {
            return;
        }
        if self
            .parent()
            .is_some_and(|parent| parent.window().is_some())
        {
            self.apply_osr(false);
        }
    }
    pub fn bind_terminal(&self, terminal: &TerminalHandle) {
        self.assert_ui();
        self.input.reset_composition();
        *self.terminal.borrow_mut() = Some(terminal.clone());
        self.input.setHidden(false);
    }
    pub fn clear_terminal(&self) {
        self.assert_ui();
        self.blur();
        self.terminal.borrow_mut().take();
        self.input.setHidden(true);
        self.state.overlay_width.set(0.);
        self.overlay_mask.set(None);
        unsafe {
            self.layer.setMask(None);
        }
    }
    pub fn attach(&self) {
        self.assert_ui();
        self.refresh_osr();
        self.attached.set(true);
        self.attach_view();
    }
    fn attach_view(&self) {
        if self.attached.get()
            && !self.osr.get()
            && unsafe { self.input.superview() }.is_none()
            && let Some(parent) = self.parent()
        {
            parent.addSubview(&self.input);
        }
    }
    pub fn detach(&self) {
        self.assert_ui();
        self.attached.set(false);
        self.blur();
        self.input.removeFromSuperview();
    }
    pub fn layout(&self, left: f32, top: f32, width: f32, height: f32, ratio: f32) {
        self.assert_ui();
        self.refresh_osr();
        if ![left, top, width, height, ratio]
            .into_iter()
            .all(f32::is_finite)
            || ratio <= 0.
        {
            self.input.setFrame(NSRect::default());
            return;
        }
        let (width, height, ratio) = (
            f64::from(width.max(0.)),
            f64::from(height.max(0.)),
            f64::from(ratio),
        );
        let origin = self
            .parent()
            .map_or(NSPoint::new(left.into(), top.into()), |parent| {
                let bounds = parent.bounds();
                NSPoint::new(
                    bounds.origin.x + f64::from(left),
                    if parent.isFlipped() {
                        bounds.origin.y + f64::from(top)
                    } else {
                        bounds.origin.y + bounds.size.height - f64::from(top) - height
                    },
                )
            });
        self.input
            .setFrame(NSRect::new(origin, NSSize::new(width, height)));
        self.layer.setContentsScale(ratio);
        self.layer
            .setDrawableSize(NSSize::new((width * ratio).ceil(), (height * ratio).ceil()));
    }
    pub fn motion(&self, event: &NativeMouseEvent) {
        self.assert_ui();
        if self.osr.get() {
            (self.state.emit)(InputEvent::Mouse(*event))
                .unwrap_or_else(|error| eprintln!("Terminal mouse: {error:#}"));
        }
    }
    pub fn focus(&self) {
        self.assert_ui();
        if self.input.isHidden() || !self.attached.get() {
            return;
        }
        if !self.osr.get() {
            if let Some(window) = self.input.window() {
                window.makeFirstResponder(Some(&self.input));
            }
        } else if self.context.borrow().is_none() {
            let context = NSTextInputContext::initWithClient(
                NSTextInputContext::alloc(self.input.mtm()),
                ProtocolObject::from_ref(&*self.input),
            );
            *self.context.borrow_mut() = Some(context.clone());
            self.register_ime(
                ime_event as *const () as usize,
                self as *const Self as usize,
            );
            context.activate();
        }
    }
    fn register_ime(&self, handler: usize, opaque: usize) {
        if let Some(callback) = self.host.register_ime {
            unsafe {
                callback(self.host.lynx_view, handler, opaque);
            }
        }
    }
    pub fn blur(&self) {
        self.assert_ui();
        let context = self.context.borrow_mut().take();
        if let Some(context) = context {
            context.discardMarkedText();
            context.deactivate();
            self.register_ime(0, 0);
        }
        self.input.reset_composition();
        if let Some(window) = self.input.window()
            && window
                .firstResponder()
                .as_deref()
                .is_some_and(|responder| std::ptr::eq(responder, self.input.as_super().as_super()))
        {
            let parent = self.parent();
            window.makeFirstResponder(parent.as_deref().map(NSView::as_super));
        }
    }
    pub fn destroy(&self) {
        self.detach();
        self.clear_terminal();
    }
    fn update_overlay(&self, terminal: &TerminalHandle) {
        // AppKit subviews sit above Lynx's composited UI. Reveal the overlay strip
        // without resizing the terminal grid, and let Lynx receive hits there.
        let Ok(scroll) = terminal.scroll_state() else {
            return;
        };
        let width = if scroll.history_rows > 0 { 12. } else { 0. };
        let bounds = self.input.bounds();
        let key = (bounds.size.width, bounds.size.height, width);
        if self.overlay_mask.get() == Some(key) {
            return;
        }
        self.overlay_mask.set(Some(key));
        self.state.overlay_width.set(width);
        if width == 0. {
            unsafe {
                self.layer.setMask(None);
            }
        } else {
            let mask = CALayer::layer();
            mask.setFrame(NSRect::new(
                NSPoint::new(0., 0.),
                NSSize::new((bounds.size.width - width).max(0.), bounds.size.height),
            ));
            mask.setBackgroundColor(Some(&objc2_core_graphics::CGColor::new_generic_rgb(
                0., 0., 0., 1.,
            )));
            unsafe {
                self.layer.setMask(Some(&mask));
            }
        }
    }
    /// Automatic frames may arrive before the window has been composited (cold
    /// launch, occluded window, display wake). Presenting then marks the grid as
    /// rendered while nothing is on screen, so wait until the window is actually
    /// visible; the grid stays dirty and the next RAF retries. Explicit
    /// `renderFrame` calls bypass the gate.
    fn is_presentable(&self) -> bool {
        let Some(window) = self.parent().and_then(|parent| parent.window()) else {
            return false;
        };
        window.isVisible()
            && !window.isMiniaturized()
            && window
                .occlusionState()
                .contains(NSWindowOcclusionState::Visible)
    }

    pub fn render_native(&self, deadline: i64, force: bool) -> Result<bool> {
        self.assert_ui();
        if !force && !self.is_presentable() {
            return Ok(false);
        }
        let binding = self.terminal.borrow();
        let terminal = binding.as_ref().context("Terminal is not bound")?;
        self.update_overlay(terminal);
        let rendered =
            unsafe { terminal.render_layer(Retained::as_ptr(&self.layer) as usize, deadline)? };
        if rendered {
            self.update_cursor(terminal);
        }
        Ok(rendered)
    }
    /// Render the bound session into an owned IOSurface and hand it to Lynx.
    /// The surface stays valid through presentation because the pool keeps a
    /// retain; no Lynx back buffer is borrowed.
    pub fn render_osr(&self, handle: &Handle, viewport: &Viewport, deadline: i64) -> Result<bool> {
        self.assert_ui();
        // Release the terminal borrow before calling into Lynx.
        let terminal = self
            .terminal
            .borrow()
            .as_ref()
            .context("Terminal is not bound")?
            .clone();
        let frame = self.osr_surfaces.borrow_mut().next(viewport)?;
        let rendered = unsafe { terminal.render_surface(frame.surface(), deadline)? };
        if !rendered {
            return Ok(false);
        }
        if crate::frame::expired(deadline) {
            terminal.invalidate_frame();
            return Ok(false);
        }
        self.update_cursor(&terminal);
        if let Err(error) =
            handle.present_surface(viewport.width, viewport.height, None, frame.handle())
        {
            terminal.invalidate_frame();
            return Err(error);
        }
        Ok(true)
    }
    fn update_cursor(&self, terminal: &TerminalHandle) {
        if let Ok(cursor) = terminal.cursor_rect() {
            self.state.cursor.set(NSRect::new(
                NSPoint::new(cursor.x.into(), cursor.y.into()),
                NSSize::new(cursor.width.into(), cursor.height.into()),
            ));
        }
    }
}
impl Drop for MacTerminalView {
    fn drop(&mut self) {
        self.destroy();
        // Keep presented surfaces alive until Lynx has released the native view.
        self.osr_surfaces.borrow_mut().clear();
    }
}

// Registered through the same Lynx host IME route used by CEF's OSR client.
// Registration is removed before Box<MacTerminalView> is dropped.
unsafe extern "C" fn ime_event(event: *const NSEvent, opaque: *const MacTerminalView) {
    if let (Some(event), Some(view)) = (unsafe { event.as_ref() }, unsafe { opaque.as_ref() }) {
        view.assert_ui();
        if event.r#type() == NSEventType::KeyDown {
            view.input
                .handle_key(event, view.context.borrow().as_deref());
        }
    }
}

#[cfg(feature = "native-input-tests")]
#[path = "../../tests/macos/view.rs"]
mod tests;
#[cfg(feature = "native-input-tests")]
pub(crate) use tests::run_view_lifecycle_tests;
