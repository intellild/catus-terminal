use super::*;

#[test]
fn supplied_ids_reject_duplicates_without_replacing_the_session_and_allow_reuse_after_close() {
    let id = 3001;
    assert!(create_session_with_command(0, None).is_err());
    let threads: Vec<_> = (0..8)
        .map(|_| std::thread::spawn(move || create_session_with_command(id, None)))
        .collect();
    let results: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert!(
        results
            .iter()
            .filter_map(|result| result.as_ref().err())
            .all(|error| error.to_string().contains("Duplicate"))
    );
    let original = session(id).unwrap();
    assert!(create_session_with_command(id, None).is_err());
    assert!(Arc::ptr_eq(&original, &session(id).unwrap()));
    close_terminal_session(id);
    assert!(session(id).is_err());
    assert!(get_terminal_session_info(id).is_err());
    assert!(write_terminal_session(id, "x".into()).is_err());
    create_session_with_command(id, None).unwrap();
    assert!(!Arc::ptr_eq(&original, &session(id).unwrap()));
    close_terminal_session(id);
}

#[test]
fn failed_pty_creation_does_not_occupy_the_supplied_id() {
    let id = 3002;
    let error = create_session_with_command(
        id,
        Some(TerminalSessionCommand {
            host_id: None,
            tmux: None,
            cwd: None,
            program: "/nonexistent/catus-test-shell".into(),
            args: vec![],
        }),
    )
    .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("Spawn terminal process /nonexistent/catus-test-shell")
    );
    assert!(error.chain().count() > 1);
    assert!(session(id).is_err());
    create_session_with_command(id, None).unwrap();
    close_terminal_session(id);
}

#[test]
fn numeric_sessions_are_retained_until_explicit_release() {
    let first = 1001;
    create_session_with_command(first, None).unwrap();
    let second = 1002;
    create_session_with_command(second, None).unwrap();
    let retained = session(first).unwrap();
    assert_ne!(first, second);
    assert!(first > 0);
    assert!(Arc::ptr_eq(&retained, &session(first).unwrap()));
    assert!(session(0).is_err());
    close_terminal_session(first);
    assert!(session(first).is_err());
    assert!(retained.exited());
    assert!(retained.write(b"x".to_vec()).is_err());
    assert!(session(second).is_ok());
    close_terminal_session(first);
    close_terminal_session(second);
}

#[cfg(feature = "native-view")]
#[test]
fn only_the_attached_renderer_receives_grid_changes() {
    use crate::{renderer::Renderer, terminal_core::grid::GridSize};
    let (session, _input) = Session::recording(b"");
    let first = Renderer::offscreen();
    let second = Renderer::offscreen();
    let old = Arc::downgrade(&first);
    let current = Arc::downgrade(&second);
    session.attach(old.clone());
    session.resize(GridSize::new(90, 25)).unwrap();
    assert!(first.take_dirty());
    let (done, rebound) = std::sync::mpsc::channel();
    std::thread::scope(|scope| {
        session.with_grid_locked(|| {
            scope.spawn(|| {
                session.attach(current.clone());
                session.detach(&old);
                let _ = done.send(());
            });
            rebound
                .recv_timeout(std::time::Duration::from_secs(2))
                .expect("Renderer rebinding waited for the grid lock");
        });
    });
    session.resize(GridSize::new(90, 26)).unwrap();
    assert!(second.take_dirty());
    assert!(!first.take_dirty());
    session.detach(&current);
    session.resize(GridSize::new(90, 27)).unwrap();
    assert!(!second.take_dirty());

    session.attach(current.clone());
    drop(second);
    assert!(current.upgrade().is_none());
    session.resize(GridSize::new(90, 28)).unwrap();
}

#[test]
fn configured_command_runs_in_the_requested_directory() {
    let directory = tempfile::tempdir().unwrap();
    let id = 3010;
    create_session_with_command(
        id,
        Some(TerminalSessionCommand {
            host_id: None,
            tmux: None,
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "printf 'CWD='; pwd".into()],
            cwd: Some(directory.path().to_string_lossy().into_owned()),
        }),
    )
    .unwrap();
    let session = session(id).unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let expected = directory
        .path()
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    while !session.snapshot().text().contains(&expected) {
        assert!(
            std::time::Instant::now() < deadline,
            "Configured PTY command did not run in {expected}"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    close_terminal_session(id);
}
