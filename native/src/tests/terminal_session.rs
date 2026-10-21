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
    assert!(retained.core.exited());
    assert!(retained.core.write(b"x".to_vec()).is_err());
    assert!(session(second).is_ok());
    close_terminal_session(first);
    close_terminal_session(second);
}

#[cfg(feature = "native-view")]
#[test]
fn layout_resizes_grid_and_session_keeps_renderer_across_native_handles() {
    use crate::frame::Viewport;
    let id = 1003;
    create_session_with_command(id, None).unwrap();
    let handle = acquire_terminal(id).unwrap();
    assert!(handle.session.rendering.lock().unwrap().is_none());
    let small = Viewport {
        width: 512,
        height: 128,
        pixel_ratio: 1.,
    };
    handle.resize_viewport(&small).unwrap();
    let state = handle.session.rendering.lock().unwrap();
    let renderer = &state.as_ref().unwrap().renderer;
    let pointer = &**renderer as *const _;
    let grid_size = renderer.grid_size(&small).unwrap();
    drop(state);
    let snapshot = handle.session.core.snapshot();
    assert_eq!(snapshot.size.columns, grid_size.columns);
    assert_eq!(snapshot.size.rows, grid_size.rows);
    drop(handle);
    let rebound = acquire_terminal(id).unwrap();
    let larger = Viewport {
        width: 1024,
        height: 256,
        ..small
    };
    rebound.resize_viewport(&larger).unwrap();
    let state = rebound.session.rendering.lock().unwrap();
    assert_eq!(&*state.as_ref().unwrap().renderer as *const _, pointer);
    let larger_size = state.as_ref().unwrap().renderer.grid_size(&larger).unwrap();
    drop(state);
    assert!(larger_size.columns > grid_size.columns);
    assert!(larger_size.rows > grid_size.rows);
    assert_eq!(
        rebound.session.core.snapshot().size.columns,
        larger_size.columns
    );
    assert_eq!(rebound.session.core.snapshot().size.rows, larger_size.rows);
    assert!(
        rebound
            .resize_viewport(&Viewport { width: 0, ..small })
            .is_err()
    );
    assert_eq!(rebound.viewport().unwrap(), larger);
    close_terminal_session(id);
    assert!(acquire_terminal(id).is_err());
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
    while !session.core.snapshot().text().contains(&expected) {
        assert!(
            std::time::Instant::now() < deadline,
            "Configured PTY command did not run in {expected}"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    close_terminal_session(id);
}
