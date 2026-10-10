//! AppKit text-input client, implemented with objc2 like winit's macOS view.
//! AppKit owns composition/keyboard interpretation; only committed text reaches PTY.
use super::terminal::ffi::NativeMouseEvent;
use anyhow::Result;
use objc2::{
    AnyThread, DefinedClass, MainThreadOnly, define_class, msg_send,
    rc::{Retained, Weak},
    runtime::{AnyObject, Sel},
};
use objc2_app_kit::{
    NSEvent, NSEventModifierFlags, NSPasteboard, NSPasteboardTypeString, NSTextInputClient,
    NSTextInputContext, NSTrackingArea, NSTrackingAreaOptions, NSView,
};
use objc2_foundation::{
    MainThreadMarker, NSArray, NSAttributedString, NSAttributedStringKey, NSCopying, NSNotFound,
    NSObjectProtocol, NSPoint, NSRange, NSRangePointer, NSRect, NSSize, NSString,
};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

pub(super) enum InputEvent {
    Text(String),
    Key {
        key: String,
        control: bool,
        alt: bool,
    },
    Preedit(String),
    Mouse(NativeMouseEvent),
    Copy,
}

pub(super) struct InputState {
    pub host: Option<Weak<NSView>>,
    pub cursor: Cell<NSRect>,
    pub overlay_width: Cell<f64>,
    pub emit: Box<dyn Fn(InputEvent) -> Result<()>>,
    pub focus: Box<dyn Fn()>,
    marked: RefCell<Retained<NSAttributedString>>,
    selection: Cell<NSRange>,
}
impl InputState {
    pub fn new(
        host: Option<&NSView>,
        emit: impl Fn(InputEvent) -> Result<()> + 'static,
        focus: impl Fn() + 'static,
    ) -> Rc<Self> {
        Rc::new(Self {
            host: host.map(Weak::new),
            overlay_width: Cell::new(0.),
            cursor: Cell::new(NSRect::new(NSPoint::new(8., 8.), NSSize::new(14., 20.))),
            emit: Box::new(emit),
            focus: Box::new(focus),
            marked: RefCell::new(NSAttributedString::new()),
            selection: Cell::new(NSRange::new(NSNotFound as usize, 0)),
        })
    }
    fn emit(&self, event: InputEvent) {
        if let Err(error) = (self.emit)(event) {
            eprintln!("Terminal input: {error:#}");
        }
    }
}

define_class!(
    // SAFETY: NSView methods and protocol signatures follow AppKit's declarations.
    // All instances and ivars are restricted to the macOS main thread.
    #[unsafe(super = NSView)]
    #[name = "CatusTerminalInputView"]
    #[thread_kind = MainThreadOnly]
    #[ivars = Rc<InputState>]
    pub(super) struct InputView;

    unsafe impl NSObjectProtocol for InputView {}
    impl InputView {
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, point: NSPoint) -> *mut NSView {
            let local = self.convertPoint_fromView(point, unsafe { self.superview() }.as_deref());
            if self.ivars().overlay_width.get() > 0. && local.x >= self.bounds().size.width - self.ivars().overlay_width.get() { return std::ptr::null_mut(); }
            unsafe { msg_send![super(self), hitTest: point] }
        }
        #[unsafe(method(isFlipped))]
        fn is_flipped(&self) -> bool { true }
        #[unsafe(method(acceptsFirstResponder))]
        fn accepts_first_responder(&self) -> bool { true }
        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _event: Option<&NSEvent>) -> bool { true }
        #[unsafe(method(mouseDown:))]
        fn mouse_down(&self, event: &NSEvent) { self.pointer_event(event, 1); (self.ivars().focus)(); if let Some(window) = self.window() { window.makeFirstResponder(Some(self)); } }
        #[unsafe(method(mouseMoved:))]
        fn mouse_moved(&self, event: &NSEvent) { self.pointer_event(event, 3); }
        #[unsafe(method(mouseDragged:))]
        fn mouse_dragged(&self, event: &NSEvent) { self.pointer_event(event, 3); }
        #[unsafe(method(mouseUp:))]
        fn mouse_up(&self, event: &NSEvent) { self.pointer_event(event, 2); }
        #[unsafe(method(rightMouseDown:))]
        fn right_mouse_down(&self, event: &NSEvent) { self.pointer_event(event, 1); }
        #[unsafe(method(rightMouseDragged:))]
        fn right_mouse_dragged(&self, event: &NSEvent) { self.pointer_event(event, 3); }
        #[unsafe(method(rightMouseUp:))]
        fn right_mouse_up(&self, event: &NSEvent) { self.pointer_event(event, 2); }
        #[unsafe(method(otherMouseDown:))]
        fn other_mouse_down(&self, event: &NSEvent) { self.pointer_event(event, 1); }
        #[unsafe(method(otherMouseDragged:))]
        fn other_mouse_dragged(&self, event: &NSEvent) { self.pointer_event(event, 3); }
        #[unsafe(method(otherMouseUp:))]
        fn other_mouse_up(&self, event: &NSEvent) { self.pointer_event(event, 2); }
        #[unsafe(method(scrollWheel:))]
        fn scroll_wheel(&self, event: &NSEvent) { self.pointer_event(event, 4); }
        #[unsafe(method(copy:))]
        fn copy(&self, _sender: Option<&AnyObject>) { self.ivars().emit(InputEvent::Copy); }
        #[unsafe(method(keyDown:))]
        fn key_down(&self, event: &NSEvent) { self.handle_key(event, None); }
        #[unsafe(method(paste:))]
        fn paste(&self, _sender: Option<&AnyObject>) {
            let board = NSPasteboard::generalPasteboard();
            if let Some(text) = unsafe { board.stringForType(NSPasteboardTypeString) } {
                self.ivars().emit(InputEvent::Text(text.to_string()));
            }
        }
    }
    unsafe impl NSTextInputClient for InputView {
        #[unsafe(method(insertText:replacementRange:))]
        unsafe fn insert_text_replacement_range(&self, text: &AnyObject, _range: NSRange) {
            let text = input_string(text);
            self.reset_composition();
            if !text.is_empty() { self.ivars().emit(InputEvent::Text(text)); }
        }
        #[unsafe(method(doCommandBySelector:))]
        unsafe fn do_command_by_selector(&self, selector: Sel) {
            if <Self as NSTextInputClient>::hasMarkedText(self) { return; }
            if let Some(key) = command_key(selector.name().to_str().unwrap_or_default()) {
                self.ivars().emit(InputEvent::Key { key: key.into(), control: false, alt: false });
            }
        }
        #[unsafe(method(setMarkedText:selectedRange:replacementRange:))]
        unsafe fn set_marked_text_selected_range_replacement_range(&self, text: &AnyObject, selected: NSRange, _range: NSRange) {
            let value = if let Some(value) = text.downcast_ref::<NSAttributedString>() {
                value.copy()
            } else {
                NSAttributedString::initWithString(NSAttributedString::alloc(), &NSString::from_str(&input_string(text)))
            };
            let length = value.length();
            let start = selected.location.min(length);
            self.ivars().selection.set(NSRange::new(start, selected.length.min(length - start)));
            *self.ivars().marked.borrow_mut() = value;
            self.ivars().emit(InputEvent::Preedit(input_string(text)));
        }
        #[unsafe(method(unmarkText))]
        fn unmark_text(&self) { self.reset_composition(); }
        #[unsafe(method(hasMarkedText))]
        fn has_marked_text(&self) -> bool { self.ivars().marked.borrow().length() != 0 }
        #[unsafe(method(markedRange))]
        fn marked_range(&self) -> NSRange {
            if <Self as NSTextInputClient>::hasMarkedText(self) { NSRange::new(0, self.ivars().marked.borrow().length()) }
            else { NSRange::new(NSNotFound as usize, 0) }
        }
        #[unsafe(method(selectedRange))]
        fn selected_range(&self) -> NSRange { self.ivars().selection.get() }
        #[unsafe(method_id(validAttributesForMarkedText))]
        fn valid_attributes_for_marked_text(&self) -> Retained<NSArray<NSAttributedStringKey>> { NSArray::new() }
        #[unsafe(method_id(attributedSubstringForProposedRange:actualRange:))]
        unsafe fn attributed_substring_for_proposed_range_actual_range(&self, range: NSRange, actual: NSRangePointer) -> Option<Retained<NSAttributedString>> {
            let marked = self.ivars().marked.borrow();
            let start = range.location.min(marked.length());
            let end = range.location.saturating_add(range.length).min(marked.length());
            let range = NSRange::new(start, end.saturating_sub(start));
            if !actual.is_null() { unsafe { *actual = range; } }
            (range.length != 0).then(|| marked.attributedSubstringFromRange(range))
        }
        #[unsafe(method(characterIndexForPoint:))]
        fn character_index_for_point(&self, _point: NSPoint) -> usize { NSNotFound as usize }
        #[unsafe(method(firstRectForCharacterRange:actualRange:))]
        unsafe fn first_rect_for_character_range_actual_range(&self, _range: NSRange, actual: NSRangePointer) -> NSRect {
            if !actual.is_null() { unsafe { *actual = <Self as NSTextInputClient>::markedRange(self); } }
            let cursor = self.ivars().cursor.get();
            if unsafe { self.superview() }.is_some() {
                let rect = self.convertRect_toView(cursor, None);
                return self.window().map(|window| window.convertRectToScreen(rect)).unwrap_or_default();
            }
            let Some(host) = self.ivars().host.as_ref().and_then(Weak::load) else { return NSRect::default(); };
            let frame = self.frame();
            let y = if host.isFlipped() {
                frame.origin.y + cursor.origin.y
            } else {
                frame.origin.y + frame.size.height - cursor.origin.y - cursor.size.height
            };
            let rect = NSRect::new(NSPoint::new(cursor.origin.x + frame.origin.x, y), cursor.size);
            let rect = host.convertRect_toView(rect, None);
            host.window().map(|window| window.convertRectToScreen(rect)).unwrap_or_default()
        }
    }
);

impl InputView {
    pub(super) fn new(mtm: MainThreadMarker, state: Rc<InputState>) -> Retained<Self> {
        let allocated = Self::alloc(mtm).set_ivars(state);
        let view: Retained<Self> =
            unsafe { msg_send![super(allocated), initWithFrame: NSRect::default()] };
        let tracking = unsafe {
            NSTrackingArea::initWithRect_options_owner_userInfo(
                NSTrackingArea::alloc(),
                NSRect::default(),
                NSTrackingAreaOptions::MouseMoved
                    | NSTrackingAreaOptions::ActiveAlways
                    | NSTrackingAreaOptions::InVisibleRect,
                Some(&view),
                None,
            )
        };
        view.addTrackingArea(&tracking);
        view
    }
    pub(super) fn reset_composition(&self) {
        *self.ivars().marked.borrow_mut() = NSAttributedString::new();
        self.ivars()
            .selection
            .set(NSRange::new(NSNotFound as usize, 0));
        self.ivars().emit(InputEvent::Preedit(String::new()));
    }
    fn pointer_event(&self, event: &NSEvent, kind: u8) {
        let point = self.convertPoint_fromView(event.locationInWindow(), None);
        // AppKit tracking areas also deliver hover inside the transparent overlay strip.
        if event.r#type() == objc2_app_kit::NSEventType::MouseMoved
            && self.ivars().overlay_width.get() > 0.
            && point.x >= self.bounds().size.width - self.ivars().overlay_width.get()
        {
            return;
        }
        let mods = event.modifierFlags();
        let buttons = match if kind == 4 || event.r#type() == objc2_app_kit::NSEventType::MouseMoved
        {
            -1
        } else {
            event.buttonNumber()
        } {
            0 => 1,
            1 => 2,
            2 => 4,
            _ => 0,
        };
        self.ivars().emit(InputEvent::Mouse(NativeMouseEvent {
            kind,
            x: point.x as f32,
            y: point.y as f32,
            wheel: if kind == 4 {
                event.scrollingDeltaY()
            } else {
                0.
            },
            precise: kind == 4 && event.hasPreciseScrollingDeltas(),
            buttons,
            shift: mods.contains(NSEventModifierFlags::Shift),
            control: mods.contains(NSEventModifierFlags::Control),
            alt: mods.contains(NSEventModifierFlags::Option),
            clicks: if kind == 1 {
                event.clickCount().clamp(1, 3) as u8
            } else {
                1
            },
        }));
    }
    pub(super) fn handle_key(&self, event: &NSEvent, context: Option<&NSTextInputContext>) {
        let modifiers = event.modifierFlags();
        if modifiers.contains(NSEventModifierFlags::Command) {
            if event
                .charactersIgnoringModifiers()
                .is_some_and(|key| key.to_string().eq_ignore_ascii_case("c"))
            {
                self.ivars().emit(InputEvent::Copy);
                return;
            }
            if !self.performKeyEquivalent(event) {
                unsafe {
                    let _: () = msg_send![super(self), keyDown: event];
                }
            }
            return;
        }
        let control = modifiers.contains(NSEventModifierFlags::Control);
        let alt = modifiers.contains(NSEventModifierFlags::Option);
        if !<Self as NSTextInputClient>::hasMarkedText(self) {
            if let Some(key) = special_key(event.keyCode()) {
                self.ivars().emit(InputEvent::Key {
                    key: key.into(),
                    control,
                    alt,
                });
                return;
            }
            if control {
                if let Some(key) = event.charactersIgnoringModifiers() {
                    self.ivars().emit(InputEvent::Key {
                        key: key.to_string(),
                        control,
                        alt,
                    });
                }
                return;
            }
        }
        if let Some(context) = context {
            context.handleEvent(event);
        } else {
            self.interpretKeyEvents(&NSArray::from_slice(&[event]));
        }
    }
}

fn input_string(text: &AnyObject) -> String {
    if let Some(text) = text.downcast_ref::<NSAttributedString>() {
        text.string().to_string()
    } else if let Some(text) = text.downcast_ref::<NSString>() {
        text.to_string()
    } else {
        String::new()
    }
}
fn special_key(code: u16) -> Option<&'static str> {
    Some(match code {
        36 | 76 => "Enter",
        48 => "Tab",
        51 => "Backspace",
        117 => "Delete",
        53 => "Escape",
        123 => "ArrowLeft",
        124 => "ArrowRight",
        125 => "ArrowDown",
        126 => "ArrowUp",
        115 => "Home",
        119 => "End",
        116 => "PageUp",
        121 => "PageDown",
        _ => return None,
    })
}
fn command_key(selector: &str) -> Option<&'static str> {
    Some(match selector {
        "insertNewline:" => "Enter",
        "insertTab:" | "insertBacktab:" => "Tab",
        "deleteBackward:" => "Backspace",
        "deleteForward:" => "Delete",
        "moveLeft:" | "moveBackward:" => "ArrowLeft",
        "moveRight:" | "moveForward:" => "ArrowRight",
        "moveUp:" => "ArrowUp",
        "moveDown:" => "ArrowDown",
        "moveToBeginningOfLine:" => "Home",
        "moveToEndOfLine:" => "End",
        "scrollPageUp:" => "PageUp",
        "scrollPageDown:" => "PageDown",
        "cancelOperation:" => "Escape",
        _ => return None,
    })
}

#[cfg(feature = "native-input-tests")]
#[path = "../../tests/macos/input_view.rs"]
mod tests;
#[cfg(feature = "native-input-tests")]
pub(crate) use tests::run_native_input_tests;
