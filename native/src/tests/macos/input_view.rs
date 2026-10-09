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
    println!("Rust terminal NSView input tests passed");
}
