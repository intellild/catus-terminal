use super::*;
use crate::terminal_core::tmux::TmuxOptions;
use std::{
    process::Command,
    thread,
    time::{Duration, Instant},
};

fn shell(host: &str) -> TerminalSessionCommand {
    TerminalSessionCommand {
        host_id: Some(host.into()),
        program: "/bin/sh".into(),
        args: vec!["-i".into()],
        cwd: Some("/tmp".into()),
        tmux: None,
    }
}

#[test]
fn hosts_own_membership_and_numeric_handles_remain_globally_unique() {
    let mut hosts = Hosts::default();
    hosts.create_session(1, Some(shell("first"))).unwrap();
    hosts.create_session(2, Some(shell("second"))).unwrap();
    assert_eq!(hosts.hosts["first"].sessions.len(), 1);
    assert_eq!(hosts.hosts["second"].sessions.len(), 1);
    assert!(
        hosts
            .create_session(1, Some(shell("second")))
            .unwrap_err()
            .to_string()
            .contains("Duplicate")
    );
    let retained = hosts.session(1).unwrap();
    hosts.close_session(1);
    assert!(hosts.session(1).is_err());
    assert!(retained.core.exited());
    assert!(!hosts.hosts.contains_key("first"));
    assert!(!hosts.session(2).unwrap().core.exited());
    hosts.detach_session(2);
    assert!(hosts.hosts.is_empty());
    assert!(hosts.owners.is_empty());
}

#[test]
fn failed_creation_leaves_no_host_or_handle_and_does_not_remove_existing_sessions() {
    let mut hosts = Hosts::default();
    let invalid = || TerminalSessionCommand {
        program: "/nonexistent/catus-host-shell".into(),
        ..shell("first")
    };
    assert!(hosts.create_session(1, Some(invalid())).is_err());
    assert!(hosts.hosts.is_empty());
    assert!(hosts.owners.is_empty());
    hosts.create_session(1, Some(shell("first"))).unwrap();
    let retained = hosts.session(1).unwrap();
    assert!(hosts.create_session(2, Some(invalid())).is_err());
    assert!(Arc::ptr_eq(&retained, &hosts.session(1).unwrap()));
    assert!(hosts.session(2).is_err());
    hosts.close_session(1);
}

struct Server(String);
impl Server {
    fn run(&self, args: &[&str]) -> std::process::Output {
        Command::new("tmux")
            .args(["-L", &self.0])
            .args(args)
            .output()
            .unwrap()
    }
    fn command(&self) -> TerminalSessionCommand {
        TerminalSessionCommand {
            program: "tmux".into(),
            args: [
                "-L",
                &self.0,
                "-f",
                "/dev/null",
                "-CC",
                "new-session",
                "-A",
                "-s",
                "test",
                "-n",
                "tab-2",
                "/bin/sh -i",
            ]
            .map(String::from)
            .to_vec(),
            tmux: Some(TmuxOptions {
                session: "test".into(),
                window: "tab-2".into(),
                command: "/bin/sh -i".into(),
                cwd: "/tmp".into(),
            }),
            ..shell("first")
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.run(&["kill-server"]);
    }
}
fn wait(session: &Session, condition: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(8);
    while !condition() {
        assert!(session.core.error().is_none(), "{:?}", session.core.error());
        assert!(
            Instant::now() < deadline,
            "Host timed out: {}",
            session.core.snapshot().text()
        );
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn changing_host_backend_keeps_existing_sessions_and_tmux_close_preserves_the_session() {
    if Command::new("tmux").arg("-V").output().is_err() {
        eprintln!("tmux is not installed; skipping integration test");
        return;
    }
    let server = Server(format!("catus-host-test-{}", std::process::id()));
    let mut hosts = Hosts::default();
    hosts.create_session(1, Some(shell("first"))).unwrap();
    let plain = hosts.session(1).unwrap();
    hosts.create_session(2, Some(server.command())).unwrap();
    let tmux = hosts.session(2).unwrap();
    wait(&tmux, || tmux.core.ready());
    hosts.create_session(3, Some(shell("first"))).unwrap();
    assert_eq!(hosts.hosts["first"].sessions.len(), 3);
    plain
        .core
        .write(b"printf 'PLAIN_BACKEND\\n'\r".to_vec())
        .unwrap();
    wait(&plain, || {
        plain.core.snapshot().text().contains("PLAIN_BACKEND")
    });
    tmux.core
        .write(b"printf 'TMUX_BACKEND\\n'\r".to_vec())
        .unwrap();
    wait(&tmux, || {
        tmux.core.snapshot().text().contains("TMUX_BACKEND")
    });
    assert!(!plain.core.snapshot().text().contains("TMUX_BACKEND"));
    hosts.detach_session(2);
    assert!(hosts.session(2).is_err());
    assert!(server.run(&["has-session", "-t", "test"]).status.success());
    hosts.create_session(2, Some(server.command())).unwrap();
    let reattached = hosts.session(2).unwrap();
    wait(&reattached, || {
        reattached.core.ready() && reattached.core.snapshot().text().contains("TMUX_BACKEND")
    });
    hosts.close_session(2);
    // Closing a tab detaches the client; the shared session keeps running until
    // it is closed explicitly from the tmux session menu.
    thread::sleep(Duration::from_millis(800));
    assert!(server.run(&["has-session", "-t", "test"]).status.success());
    assert!(
        String::from_utf8(
            server
                .run(&["list-clients", "-t", "test", "-F", "#{client_name}"])
                .stdout
        )
        .unwrap()
        .trim()
        .is_empty()
    );
    assert!(hosts.session(1).is_ok());
    assert!(hosts.session(3).is_ok());
    hosts.close_session(1);
    hosts.close_session(3);
    assert!(hosts.hosts.is_empty());
}
