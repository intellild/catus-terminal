use super::*;
use crate::terminal_core::tmux::TmuxOptions;
use std::{
    process::Command,
    thread,
    time::{Duration, Instant},
};

fn shell(workspace: &str) -> TerminalSessionCommand {
    TerminalSessionCommand {
        workspace_id: Some(workspace.into()),
        program: "/bin/sh".into(),
        args: vec!["-i".into()],
        cwd: Some("/tmp".into()),
        tmux: None,
    }
}

#[test]
fn workspaces_own_membership_and_numeric_handles_remain_globally_unique() {
    let mut workspaces = Workspaces::default();
    workspaces.create_session(1, Some(shell("first"))).unwrap();
    workspaces.create_session(2, Some(shell("second"))).unwrap();
    assert_eq!(workspaces.workspaces["first"].sessions.len(), 1);
    assert_eq!(workspaces.workspaces["second"].sessions.len(), 1);
    assert!(
        workspaces
            .create_session(1, Some(shell("second")))
            .unwrap_err()
            .to_string()
            .contains("Duplicate")
    );
    let retained = workspaces.session(1).unwrap();
    workspaces.close_session(1);
    assert!(workspaces.session(1).is_err());
    assert!(retained.core.exited());
    assert!(!workspaces.workspaces.contains_key("first"));
    assert!(!workspaces.session(2).unwrap().core.exited());
    workspaces.detach_session(2);
    assert!(workspaces.workspaces.is_empty());
    assert!(workspaces.owners.is_empty());
}

#[test]
fn failed_creation_leaves_no_workspace_or_handle_and_does_not_remove_existing_sessions() {
    let mut workspaces = Workspaces::default();
    let invalid = || TerminalSessionCommand {
        program: "/nonexistent/catus-workspace-shell".into(),
        ..shell("first")
    };
    assert!(workspaces.create_session(1, Some(invalid())).is_err());
    assert!(workspaces.workspaces.is_empty());
    assert!(workspaces.owners.is_empty());
    workspaces.create_session(1, Some(shell("first"))).unwrap();
    let retained = workspaces.session(1).unwrap();
    assert!(workspaces.create_session(2, Some(invalid())).is_err());
    assert!(Arc::ptr_eq(&retained, &workspaces.session(1).unwrap()));
    assert!(workspaces.session(2).is_err());
    workspaces.close_session(1);
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
            "Workspace timed out: {}",
            session.core.snapshot().text()
        );
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn changing_workspace_backend_keeps_existing_sessions_and_tmux_close_preserves_the_session() {
    if Command::new("tmux").arg("-V").output().is_err() {
        eprintln!("tmux is not installed; skipping integration test");
        return;
    }
    let server = Server(format!("catus-workspace-test-{}", std::process::id()));
    let mut workspaces = Workspaces::default();
    workspaces.create_session(1, Some(shell("first"))).unwrap();
    let plain = workspaces.session(1).unwrap();
    workspaces
        .create_session(2, Some(server.command()))
        .unwrap();
    let tmux = workspaces.session(2).unwrap();
    wait(&tmux, || tmux.core.ready());
    workspaces.create_session(3, Some(shell("first"))).unwrap();
    assert_eq!(workspaces.workspaces["first"].sessions.len(), 3);
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
    workspaces.detach_session(2);
    assert!(workspaces.session(2).is_err());
    assert!(server.run(&["has-session", "-t", "test"]).status.success());
    workspaces
        .create_session(2, Some(server.command()))
        .unwrap();
    let reattached = workspaces.session(2).unwrap();
    wait(&reattached, || {
        reattached.core.ready() && reattached.core.snapshot().text().contains("TMUX_BACKEND")
    });
    workspaces.close_session(2);
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
    assert!(workspaces.session(1).is_ok());
    assert!(workspaces.session(3).is_ok());
    workspaces.close_session(1);
    workspaces.close_session(3);
    assert!(workspaces.workspaces.is_empty());
}
