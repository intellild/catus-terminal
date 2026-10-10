use super::*;
use crate::{
    binding::types::MouseButtons, terminal_core::pty::TerminalSession, terminal_session::Session,
};
use std::sync::{Arc, Mutex, mpsc::Receiver};

fn terminal(output: &[u8], mouse: MouseState) -> (TerminalHandle, Receiver<Vec<u8>>) {
    let (core, input) = TerminalSession::recording(output);
    (
        TerminalHandle {
            session: Arc::new(Session {
                core,
                // Cancellation must work after rendering/layout have gone away.
                rendering: Mutex::new(None),
            }),
            preedit: Arc::new(Mutex::new(String::new())),
            mouse: Arc::new(Mutex::new(mouse)),
        },
        input,
    )
}

fn cancel() -> NativeMouseEvent {
    NativeMouseEvent {
        kind: 5,
        x: f32::NAN,
        y: f32::NAN,
        wheel: f64::NAN,
        precise: false,
        // Cancel fields do not describe the remembered press.
        buttons: MouseButtons::EMPTY,
        shift: true,
        control: false,
        alt: false,
        clicks: 0,
    }
}

#[test]
fn cancel_releases_the_stored_button_without_coordinates_or_layout_once() {
    for (mode, expected) in [
        (
            b"\x1b[?1002h\x1b[?1006h".as_slice(),
            b"\x1b[<17;8;5m".as_slice(),
        ),
        (b"\x1b[?1002h".as_slice(), b"\x1b[M3(%".as_slice()),
    ] {
        let (handle, input) = terminal(
            mode,
            MouseState {
                button: 1,
                position: (4, 7),
                modifiers: MouseModifiers {
                    control: true,
                    ..MouseModifiers::default()
                },
                remainder: 0.5,
                click: Some((std::time::Instant::now(), 4, 7, 1, 2)),
            },
        );
        let mut event = cancel();
        event.buttons = MouseButton::Secondary.into();
        handle.mouse_input(&event).unwrap();
        assert_eq!(input.try_recv().unwrap(), expected);
        let state = handle.mouse.lock().unwrap();
        assert_eq!(state.button, 3);
        assert_eq!(state.remainder, 0.);
        assert!(state.click.is_none());
        drop(state);
        handle.mouse_input(&event).unwrap();
        assert!(
            input.try_recv().is_err(),
            "a repeated cancel must not report another release"
        );
    }
    let (handle, input) = terminal(b"\x1b[?1002h\x1b[?1006h", MouseState::default());
    handle.mouse_input(&cancel()).unwrap();
    assert!(input.try_recv().is_err(), "no press means no release");
}

#[test]
fn cancelling_a_shift_selection_does_not_report_or_extend_it() {
    let shift = MouseModifiers {
        shift: true,
        ..MouseModifiers::default()
    };
    let (handle, input) = terminal(
        b"\x1b[?1002h\x1b[?1006hhello",
        MouseState {
            button: 0,
            position: (0, 1),
            modifiers: shift,
            ..MouseState::default()
        },
    );
    handle
        .session
        .core
        .pointer(PointerAction::Down, 0, 1, false, 2, 0, shift)
        .unwrap();
    let mut event = cancel();
    event.shift = false;
    handle.mouse_input(&event).unwrap();
    assert!(
        input.try_recv().is_err(),
        "Shift selection never reported a press"
    );
    assert_eq!(
        handle.session.core.selected_text().as_deref(),
        Some("hello")
    );
}

#[test]
fn failed_release_still_clears_the_local_press() {
    let (handle, _input) = terminal(
        b"\x1b[?1002h\x1b[?1006h",
        MouseState {
            button: 0,
            remainder: 0.5,
            ..MouseState::default()
        },
    );
    handle.session.core.close();
    assert!(handle.mouse_input(&cancel()).is_err());
    assert_eq!(handle.mouse.lock().unwrap().button, 3);
    assert_eq!(handle.mouse.lock().unwrap().remainder, 0.);
    assert!(handle.mouse_input(&cancel()).is_ok());
}
