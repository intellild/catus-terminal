use super::*;

#[test]
fn numeric_sessions_are_retained_until_explicit_release() {
    let first = create_session().unwrap();
    let second = create_session().unwrap();
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

#[cfg(all(feature = "native-view", target_os = "macos"))]
#[test]
fn layout_resizes_grid_and_session_keeps_renderer_across_native_handles() {
    use crate::frame::Viewport;
    let id = create_session().unwrap();
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
