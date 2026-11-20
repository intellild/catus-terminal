use super::*;
use crate::{
    binding::types::MouseButtons,
    terminal_core::{
        pty::{WriterMessage, message_data},
        session::TerminalSession,
    },
};

use tokio::sync::mpsc::UnboundedReceiver;

fn terminal(
    output: &[u8],
    mouse: MouseState,
) -> (
    TerminalSession,
    MouseState,
    UnboundedReceiver<WriterMessage>,
) {
    let (session, input) = TerminalSession::recording(output);
    (session, mouse, input)
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
        let (session, mut mouse, mut input) = terminal(
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
        mouse.input(&session, None, &event).unwrap();
        assert_eq!(message_data(input.try_recv().unwrap()), expected);
        assert_eq!(mouse.button, 3);
        assert_eq!(mouse.remainder, 0.);
        assert!(mouse.click.is_none());
        mouse.input(&session, None, &event).unwrap();
        assert!(
            input.try_recv().is_err(),
            "a repeated cancel must not report another release"
        );
    }
    let (session, mut mouse, mut input) =
        terminal(b"\x1b[?1002h\x1b[?1006h", MouseState::default());
    mouse.input(&session, None, &cancel()).unwrap();
    assert!(input.try_recv().is_err(), "no press means no release");
}

#[test]
fn cancelling_a_shift_selection_does_not_report_or_extend_it() {
    let shift = MouseModifiers {
        shift: true,
        ..MouseModifiers::default()
    };
    let (session, mut mouse, mut input) = terminal(
        b"\x1b[?1002h\x1b[?1006hhello",
        MouseState {
            button: 0,
            position: (0, 1),
            modifiers: shift,
            ..MouseState::default()
        },
    );
    session
        .pointer(PointerAction::Down, 0, 1, false, 2, 0, shift)
        .unwrap();
    let mut event = cancel();
    event.shift = false;
    mouse.input(&session, None, &event).unwrap();
    assert!(
        input.try_recv().is_err(),
        "Shift selection never reported a press"
    );
    assert_eq!(session.selected_text().as_deref(), Some("hello"));
}

#[test]
fn failed_release_still_clears_the_local_press() {
    let (session, mut mouse, _input) = terminal(
        b"\x1b[?1002h\x1b[?1006h",
        MouseState {
            button: 0,
            remainder: 0.5,
            ..MouseState::default()
        },
    );
    session.close();
    assert!(mouse.input(&session, None, &cancel()).is_err());
    assert_eq!(mouse.button, 3);
    assert_eq!(mouse.remainder, 0.);
    assert!(mouse.input(&session, None, &cancel()).is_ok());
}
