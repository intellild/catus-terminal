use super::*;
use crate::terminal_core::{
    pty::{TmuxPtyDelegate, WriterMessage, message_data, test_channel, test_sender},
    session::TerminalSession,
};
use std::{
    process::Command,
    thread,
    time::{Duration, Instant},
};

fn options(session: &str, window: &str) -> TmuxOptions {
    TmuxOptions {
        session: session.into(),
        window: window.into(),
        command: "/bin/sh -i".into(),
        cwd: "/tmp".into(),
    }
}

#[test]
fn escapes_preserve_raw_bytes_and_reject_malformed_data() {
    assert_eq!(
        unescape(br"hello\015\012\134\000\377").unwrap(),
        b"hello\r\n\\\0\xff"
    );
    for input in [br"\12".as_slice(), br"\999", br"\400"] {
        assert!(unescape(input).is_err());
    }
}

#[test]
fn fragmented_protocol_routes_only_the_bound_pane_and_never_renders_command_results() {
    let (tx, mut rx) = test_channel();
    let mut grid = TerminalGrid::new(GridSize::new(20, 4), test_sender());
    let mut client = TmuxClient::new(options("test", "tab-1"), grid.size());
    client.pane = Some("%2".into());
    client.started = true;
    client.protocol = true;
    client.live = true;
    client.replies.clear();
    let protocol = b"%begin 1 2 1\n%output %2 should-not-render\n%end 1 2 1\n%output %9 wrong-pane\n%output %2 hello\\015\\012world\\134\n";
    for byte in protocol {
        client.advance(&[*byte], &mut grid, &tx).unwrap();
    }
    assert_eq!(grid.snapshot().text(), "hello\nworld\\\n\n");
    assert!(rx.try_recv().is_err());
    client
        .input("\0\r\x1b中文".as_bytes().to_vec(), &tx)
        .unwrap();
    let command = String::from_utf8(message_data(rx.try_recv().unwrap())).unwrap();
    assert_eq!(command, "send-keys -t %2 -H 00 0d 1b e4 b8 ad e6 96 87\n");
}

#[test]
fn snapshot_restores_cursor_and_app_cursor_mode_before_replaying_incremental_output() {
    let mut grid = TerminalGrid::new(GridSize::new(10, 3), test_sender());
    let mut client = TmuxClient::new(options("test", "tab-1"), grid.size());
    client.screen = vec![b"hello".to_vec(), vec![], vec![]];
    client.state = b"10|3|5|0|0|1|0|1|0|1|0|0|0|0|0|0|2|0|1,7,25,2004".to_vec();
    client.restore(&mut grid).unwrap();
    grid.advance(b"world");
    assert_eq!(grid.snapshot().text(), "helloworld\n\n");
    assert_eq!(grid.key("ArrowUp", false, false).unwrap(), b"\x1bOA");
    assert!(grid.paste("text").starts_with(b"\x1b[200~"));
}

fn protocol_command(rx: &mut tokio::sync::mpsc::UnboundedReceiver<WriterMessage>) -> String {
    String::from_utf8(message_data(rx.try_recv().unwrap())).unwrap()
}

#[test]
fn window_list_binds_the_active_window_and_switching_rebinds_the_pane() {
    let (tx, mut rx) = test_channel();
    let mut grid = TerminalGrid::new(GridSize::new(20, 4), test_sender());
    let mut client = TmuxClient::new(options("test", "tab-1"), grid.size());
    client.protocol = true;
    let initial =
        b"%begin 1 2 1\n@1|0|1|tab-1\n%end 1 2 1\n%begin 2 3 1\n@1|0|1|tab-1\n@2|1|0|logs\n%end 2 3 1\n";
    client.advance(initial, &mut grid, &tx).unwrap();
    assert!(protocol_command(&mut rx).contains("list-windows -t \"test\""));
    let bind = protocol_command(&mut rx);
    assert!(bind.contains("display-message -p -t \"@1\" '#{pane_id}'"));
    client
        .advance(b"%begin 3 4 1\n%0\n%end 3 4 1\n", &mut grid, &tx)
        .unwrap();
    let options =
        protocol_command(&mut rx) + &protocol_command(&mut rx) + &protocol_command(&mut rx);
    assert!(options.contains("set-window-option -t @1 automatic-rename off"));
    assert!(options.contains("resize-window -t @1 -x 20 -y 4"));
    // tmux answers every control command; clear the simulated pending replies.
    client.replies.clear();
    let info = client.session_info().unwrap();
    assert_eq!(info.windows.len(), 2);
    assert_eq!(info.active_window_id.as_deref(), Some("@1"));

    assert!(client.select_window("@2", &tx).unwrap());
    assert_eq!(protocol_command(&mut rx), "select-window -t \"@2\"\n");
    assert!(protocol_command(&mut rx).contains("list-windows -t \"test\""));
    client
        .advance(
            b"%begin 4 5 1\n%end 4 5 1\n%begin 4 6 1\n@1|0|0|tab-1\n@2|1|1|logs\n%end 4 6 1\n",
            &mut grid,
            &tx,
        )
        .unwrap();
    assert!(protocol_command(&mut rx).contains("display-message -p -t \"@2\" '#{pane_id}'"));
    client
        .advance(b"%begin 5 6 1\n%1\n%end 5 6 1\n", &mut grid, &tx)
        .unwrap();
    assert!(protocol_command(&mut rx).contains("set-window-option -t @2"));
    protocol_command(&mut rx);
    protocol_command(&mut rx);
    client.replies.clear();
    let info = client.session_info().unwrap();
    assert_eq!(info.active_window_id.as_deref(), Some("@2"));

    // An external tmux client or a prefix key changes the session window.
    client
        .advance(b"%session-window-changed $1 @1\n", &mut grid, &tx)
        .unwrap();
    assert!(protocol_command(&mut rx).contains("list-windows -t \"test\""));
    client.replies.clear();

    assert!(client.close_window("@1", &tx).unwrap());
    assert_eq!(protocol_command(&mut rx), "kill-window -t \"@1\"\n");
    assert!(protocol_command(&mut rx).contains("list-windows -t \"test\""));
    client.windows.retain(|window| window.id == "@2");
    assert!(!client.close_window("@2", &tx).unwrap());
}

struct Server {
    socket: String,
}
impl Server {
    fn new() -> Option<Self> {
        if Command::new("tmux").arg("-V").output().is_err() {
            return None;
        }
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        Some(Self {
            socket: format!(
                "catus-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ),
        })
    }
    fn run(&self, args: &[&str]) -> String {
        let output = Command::new("tmux")
            .args(["-L", &self.socket])
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    }
    fn attach(&self, session: &str, window: &str) -> TerminalSession {
        let args = [
            "-L",
            &self.socket,
            "-f",
            "/dev/null",
            "-CC",
            "new-session",
            "-A",
            "-s",
            session,
            "-n",
            window,
            "-x",
            "20",
            "-y",
            "4",
            "/bin/sh -i",
        ];
        TerminalSession::command_with_delegate(
            "tmux",
            &args.map(String::from),
            Some("/tmp"),
            GridSize::new(20, 4),
            std::sync::Arc::new(TmuxPtyDelegate::new(
                options(session, window),
                GridSize::new(20, 4),
            )),
        )
        .unwrap()
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        let _ = Command::new("tmux")
            .args(["-L", &self.socket, "kill-server"])
            .output();
    }
}
fn wait(terminal: &TerminalSession, condition: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(8);
    while !condition() {
        assert!(terminal.error().is_none(), "{:?}", terminal.error());
        assert!(
            Instant::now() < deadline,
            "tmux timed out: {}",
            terminal.snapshot().text()
        );
        thread::sleep(Duration::from_millis(10));
    }
}
fn ready(terminal: &TerminalSession) -> bool {
    terminal.ready()
}

#[test]
fn real_tmux_session_lists_creates_selects_and_closes_windows() {
    let Some(server) = Server::new() else {
        eprintln!("tmux is not installed; skipping integration test");
        return;
    };
    let terminal = server.attach("test-1", "tab-1");
    wait(&terminal, || ready(&terminal));
    terminal
        .write(b"printf '\\033[32mFIRST\\033[0m\\n'\r".to_vec())
        .unwrap();
    wait(&terminal, || {
        terminal
            .snapshot()
            .cells
            .iter()
            .any(|c| c.characters == ['F'] && c.foreground == [122, 194, 126])
    });
    let initial = terminal.tmux_info().unwrap();
    assert_eq!(initial.windows.len(), 1);
    let first_window = initial.windows[0].id.clone();
    assert!(initial.windows[0].active);

    terminal.resize(GridSize::new(40, 6)).unwrap();
    wait(&terminal, || {
        ready(&terminal)
            && server
                .run(&[
                    "display-message",
                    "-p",
                    "-t",
                    "test-1:tab-1",
                    "#{pane_width} #{pane_height}",
                ])
                .trim()
                == "40 6"
    });

    assert!(terminal.create_tmux_window().unwrap());
    wait(&terminal, || {
        ready(&terminal) && terminal.tmux_info().unwrap().windows.len() == 2
    });
    let second = terminal.tmux_info().unwrap();
    let second_window = second
        .windows
        .iter()
        .find(|window| window.id != first_window)
        .unwrap()
        .id
        .clone();
    assert_eq!(
        second.active_window_id.as_deref(),
        Some(second_window.as_str())
    );
    terminal.write(b"printf 'SECOND\\n'\r".to_vec()).unwrap();
    wait(&terminal, || {
        let text = terminal.snapshot().text();
        text.contains("SECOND") && !text.contains("FIRST")
    });

    assert!(terminal.select_tmux_window(&first_window).unwrap());
    wait(&terminal, || {
        ready(&terminal)
            && terminal.tmux_info().unwrap().active_window_id.as_deref()
                == Some(first_window.as_str())
            && terminal.snapshot().text().contains("FIRST")
    });

    terminal.detach();
    let reattached = server.attach("test-1", "tab-1");
    wait(&reattached, || {
        ready(&reattached)
            && reattached.snapshot().text().contains("FIRST")
            && reattached.tmux_info().unwrap().windows.len() == 2
    });
    assert!(
        reattached
            .snapshot()
            .cells
            .iter()
            .any(|c| c.characters == ['F'] && c.foreground == [122, 194, 126])
    );
    assert!(reattached.close_tmux_window(&second_window).unwrap());
    wait(&reattached, || {
        ready(&reattached) && reattached.tmux_info().unwrap().windows.len() == 1
    });
    reattached.close();
}
