use super::*;
use crate::{terminal_core::pty::TmuxPtyDelegate, terminal_core::session::TerminalSession};
use std::{
    process::Command,
    thread,
    time::{Duration, Instant},
};

fn options(window: &str) -> TmuxOptions {
    TmuxOptions {
        session: "test".into(),
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
    let (tx, rx) = std::sync::mpsc::channel();
    let mut grid = TerminalGrid::new(GridSize::new(20, 4), std::sync::mpsc::channel().0);
    let mut client = TmuxClient::new(options("tab-1"), grid.size());
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
    let command = String::from_utf8(rx.try_recv().unwrap()).unwrap();
    assert_eq!(command, "send-keys -t %2 -H 00 0d 1b e4 b8 ad e6 96 87\n");
}

#[test]
fn snapshot_restores_cursor_and_app_cursor_mode_before_replaying_incremental_output() {
    let mut grid = TerminalGrid::new(GridSize::new(10, 3), std::sync::mpsc::channel().0);
    let mut client = TmuxClient::new(options("tab-1"), grid.size());
    client.screen = vec![b"hello".to_vec(), vec![], vec![]];
    client.state = b"10|3|5|0|0|1|0|1|0|1|0|0|0|0|0|0|2|0|1,7,25,2004".to_vec();
    client.restore(&mut grid).unwrap();
    grid.advance(b"world");
    assert_eq!(grid.snapshot().text(), "helloworld\n\n");
    assert_eq!(grid.key("ArrowUp", false, false).unwrap(), b"\x1bOA");
    assert!(grid.paste("text").starts_with(b"\x1b[200~"));
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
    fn attach(&self, window: &str) -> TerminalSession {
        let args = [
            "-L",
            &self.socket,
            "-f",
            "/dev/null",
            "-CC",
            "new-session",
            "-A",
            "-s",
            "test",
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
            std::sync::Arc::new(TmuxPtyDelegate::new(options(window), GridSize::new(20, 4))),
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
fn real_tmux_round_trip_resize_detach_snapshot_and_tab_isolation() {
    let Some(server) = Server::new() else {
        eprintln!("tmux is not installed; skipping integration test");
        return;
    };
    let first = server.attach("tab-1");
    wait(&first, || ready(&first));
    first
        .write(b"printf '\\033[32mFIRST\\033[0m\\n'\r".to_vec())
        .unwrap();
    wait(&first, || {
        first
            .snapshot()
            .cells
            .iter()
            .any(|c| c.characters == ['F'] && c.foreground == [122, 194, 126])
    });
    let second = server.attach("tab-2");
    wait(&second, || ready(&second));
    second.resize(GridSize::new(40, 6)).unwrap();
    wait(&second, || {
        ready(&second)
            && server
                .run(&[
                    "display-message",
                    "-p",
                    "-t",
                    "test:tab-2",
                    "#{pane_width} #{pane_height}",
                ])
                .trim()
                == "40 6"
    });
    assert_eq!(
        server
            .run(&[
                "display-message",
                "-p",
                "-t",
                "test:tab-1",
                "#{pane_width} #{pane_height}"
            ])
            .trim(),
        "20 4"
    );
    second.write(b"printf 'SECOND\\n'\r".to_vec()).unwrap();
    wait(&second, || second.snapshot().text().contains("SECOND"));
    assert!(!second.snapshot().text().contains("FIRST"));
    first.detach();
    let reattached = server.attach("tab-1");
    wait(&reattached, || {
        ready(&reattached) && reattached.snapshot().text().contains("FIRST")
    });
    assert!(
        reattached
            .snapshot()
            .cells
            .iter()
            .any(|c| c.characters == ['F'] && c.foreground == [122, 194, 126])
    );
    second.close();
    wait(&reattached, || {
        server
            .run(&["list-windows", "-t", "test", "-F", "#{window_name}"])
            .trim()
            == "tab-1"
    });
    reattached.close();
}
