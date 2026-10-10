use super::*;
use std::time::{Duration, Instant};

impl TerminalSession {
    /// Deterministic PTY sink for input tests; the real VT parser still owns modes.
    pub(crate) fn recording(output: &[u8]) -> (Self, mpsc::Receiver<Vec<u8>>) {
        let (tx, rx) = mpsc::channel();
        let mut grid = TerminalGrid::new(GridSize::new(80, 24), tx.clone());
        grid.advance(output);
        (
            Self {
                grid: Arc::new(Mutex::new(grid)),
                master: Mutex::new(None),
                child: Mutex::new(None),
                input: Mutex::new(Some(tx)),
                exited: Arc::new(AtomicBool::new(false)),
                error: Arc::new(Mutex::new(None)),
                shell: "recording".into(),
            },
            rx,
        )
    }
}

#[test]
fn paste_is_a_single_mode_encoded_packet_while_write_and_key_remain_raw() {
    let (terminal, input) = TerminalSession::recording(b"\x1b[?2004h");
    terminal.paste("first\n中文\x1b[201~\x03").unwrap();
    assert_eq!(
        input.try_recv().unwrap(),
        "\x1b[200~first\n中文[201~\x1b[201~".as_bytes()
    );
    assert!(input.try_recv().is_err());
    terminal.write(b"typed\n\x1b".to_vec()).unwrap();
    assert_eq!(input.try_recv().unwrap(), b"typed\n\x1b");
    terminal.key("Enter", false, false).unwrap();
    assert_eq!(input.try_recv().unwrap(), b"\r");
    terminal.grid.lock().unwrap().advance(b"\x1b[?2004l");
    terminal.paste("one\r\ntwo\n").unwrap();
    assert_eq!(input.try_recv().unwrap(), b"one\rtwo\r");
    terminal.close();
    assert!(terminal.paste("closed").is_err());
}

#[test]
fn stored_pty_errors_keep_their_causes_across_repeated_reads() {
    let terminal =
        TerminalSession::command("/bin/sh", &["-i".into()], GridSize::new(80, 24)).unwrap();
    let source = std::io::Error::from(std::io::ErrorKind::BrokenPipe);
    let reason = source.to_string();
    *terminal.error.lock().unwrap() = Some(
        anyhow::Error::new(source)
            .context("Write PTY input")
            .into_boxed_dyn_error()
            .into(),
    );
    for _ in 0..2 {
        let error = terminal.error().unwrap();
        assert_eq!(format!("{error:#}"), format!("Write PTY input: {reason}"));
        assert_eq!(
            error
                .root_cause()
                .downcast_ref::<std::io::Error>()
                .unwrap()
                .kind(),
            std::io::ErrorKind::BrokenPipe
        );
    }
    terminal.close();
}
#[test]
fn pty_shell_round_trip_resize_and_shutdown() {
    let mut command = CommandBuilder::new("/bin/sh");
    command.args(["-i"]);
    command.env("PS1", "");
    let terminal =
        TerminalSession::spawn(command, GridSize::new(80, 24), "/bin/sh".into()).unwrap();
    terminal.resize(GridSize::new(92, 28)).unwrap();
    terminal
        .write(b"printf '\\033[32mPTY_OK\\033[0m\\n'; stty size\r".to_vec())
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let snapshot = terminal.snapshot();
        // Check processed, green output rather than the echoed command.
        if snapshot.cells.windows(6).any(|cells| {
            cells
                .iter()
                .map(|c| c.characters.first().copied().unwrap_or(' '))
                .collect::<String>()
                == "PTY_OK"
                && cells.iter().all(|c| c.foreground == [122, 194, 126])
        }) && snapshot.text().contains("28 92")
        {
            break;
        }
        assert!(Instant::now() < deadline, "{}", snapshot.text());
        thread::sleep(Duration::from_millis(10));
    }
    terminal.write(b"exit\r".to_vec()).unwrap();
    while !terminal.exited() {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(10));
    }
    terminal.close();
    assert!(terminal.write(b"x".to_vec()).is_err());
}
