use super::*;
use objc2::sel;
use objc2_app_kit::NSApplication;

pub(crate) fn run_native_input_tests() {
    let mtm = MainThreadMarker::new().expect("AppKit test must run on the main thread");
    let _app = NSApplication::sharedApplication(mtm);
    let events = Rc::new(RefCell::new(Vec::new()));
    let output = events.clone();
    let state = InputState::new(
        None,
        move |event| {
            output.borrow_mut().push(event);
            Ok(())
        },
        || {},
    );
    let input = InputView::new(mtm, state);
    let range = NSRange::new(NSNotFound as usize, 0);
    unsafe {
        NSTextInputClient::setMarkedText_selectedRange_replacementRange(
            &*input,
            &NSString::from_str("zhong"),
            NSRange::new(5, 0),
            range,
        );
        assert!(NSTextInputClient::hasMarkedText(&*input));
        assert!(
            events
                .borrow()
                .iter()
                .all(|event| !matches!(event, InputEvent::Text(_)))
        );
        let count = events.borrow().len();
        NSTextInputClient::doCommandBySelector(&*input, sel!(insertNewline:));
        assert_eq!(
            events.borrow().len(),
            count,
            "IME selection Enter must not reach PTY"
        );
        NSTextInputClient::insertText_replacementRange(&*input, &NSString::from_str("中文"), range);
        assert!(!NSTextInputClient::hasMarkedText(&*input));
        assert!(matches!(events.borrow().last(), Some(InputEvent::Text(text)) if text == "中文"));
        NSTextInputClient::doCommandBySelector(&*input, sel!(moveLeft:));
        assert!(
            matches!(events.borrow().last(), Some(InputEvent::Key { key, .. }) if key == "ArrowLeft")
        );

        // NSString ranges count UTF-16 code units, including surrogate pairs.
        NSTextInputClient::setMarkedText_selectedRange_replacementRange(
            &*input,
            &NSString::from_str("😀中"),
            NSRange::new(100, 4),
            range,
        );
        assert_eq!(
            NSTextInputClient::selectedRange(&*input),
            NSRange::new(3, 0)
        );
        let mut actual = NSRange::new(0, 0);
        let substring = NSTextInputClient::attributedSubstringForProposedRange_actualRange(
            &*input,
            NSRange::new(2, usize::MAX - 2),
            &mut actual,
        )
        .unwrap();
        assert_eq!(substring.string().to_string(), "中");
        assert_eq!(actual, NSRange::new(2, 1));
        input.reset_composition();
        assert!(!NSTextInputClient::hasMarkedText(&*input));
        assert!(
            matches!(events.borrow().last(), Some(InputEvent::Preedit(text)) if text.is_empty())
        );
    }
    // A private pasteboard exercises clipboard input without changing the
    // user's general clipboard. IME/insertText above must remain ordinary Text.
    let board = NSPasteboard::pasteboardWithUniqueName();
    let before = events.borrow().len();
    input.paste_from_board(&board);
    assert_eq!(events.borrow().len(), before);
    assert!(unsafe {
        board.setString_forType(&NSString::from_str("first\n中文"), NSPasteboardTypeString)
    });
    input.paste_from_board(&board);
    assert!(
        matches!(events.borrow().last(), Some(InputEvent::Paste(text)) if text == "first\n中文")
    );
    for (kind, native_kind) in [
        (objc2_app_kit::NSEventType::LeftMouseDown, 1),
        (objc2_app_kit::NSEventType::LeftMouseDragged, 3),
        (objc2_app_kit::NSEventType::LeftMouseUp, 2),
    ] {
        let event = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
            kind, NSPoint::new(24., 18.), NSEventModifierFlags::Shift, 0., 0, None, 0, 2, 1.,
        ).unwrap();
        unsafe {
            let _: () = match native_kind {
                1 => objc2::msg_send![&*input, mouseDown: &*event],
                2 => objc2::msg_send![&*input, mouseUp: &*event],
                _ => objc2::msg_send![&*input, mouseDragged: &*event],
            };
        }
        assert!(
            matches!(events.borrow().last(), Some(InputEvent::Mouse(mouse)) if mouse.kind == native_kind && mouse.buttons == MouseButton::Primary.into() && mouse.shift)
        );
    }
    unsafe {
        let _: () = objc2::msg_send![&*input, copy: std::ptr::null::<AnyObject>()];
    }
    assert!(matches!(events.borrow().last(), Some(InputEvent::Copy)));
    input.setFrame(NSRect::new(NSPoint::new(0., 0.), NSSize::new(200., 100.)));
    input.ivars().overlay_width.set(12.);
    let hit: *mut NSView = unsafe { objc2::msg_send![&*input, hitTest: NSPoint::new(195., 50.)] };
    assert!(
        hit.is_null(),
        "Lynx overlay strip must receive hits instead of the NSView"
    );
    let hit: *mut NSView = unsafe { objc2::msg_send![&*input, hitTest: NSPoint::new(100., 50.)] };
    assert!(!hit.is_null(), "terminal content retains native input");
    println!("Rust terminal NSView input tests passed");
}
