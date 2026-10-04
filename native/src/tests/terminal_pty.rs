use super::*;
use std::time::{Duration, Instant};
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
