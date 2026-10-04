use super::*;
use crate::renderer::test_support::{TEST_LOCK, Target};
use crate::terminal_session::{
    TerminalSessionCommand, close_terminal_session, create_terminal_session,
};
use std::time::{Duration, Instant};

struct FakeSession(u32);
impl FakeSession {
    fn new(id: u32) -> Self {
        let fixture = format!(
            "{}/../tests/fixtures/fake-pty.mjs",
            env!("CARGO_MANIFEST_DIR")
        );
        create_terminal_session(
            id,
            Some(TerminalSessionCommand {
                program: std::env::var("CATUS_E2E_NODE").unwrap_or_else(|_| "node".into()),
                args: vec![fixture],
            }),
        )
        .unwrap();
        Self(id)
    }

    fn handle(&self) -> Box<TerminalHandle> {
        acquire_terminal(self.0).unwrap()
    }
}
impl Drop for FakeSession {
    fn drop(&mut self) {
        close_terminal_session(self.0);
    }
}
fn wait_text(handle: &TerminalHandle, expected: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let snapshot = handle.session.core.snapshot();
        if snapshot.text().contains(expected) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "Missing {expected:?}: {} / {:?}",
            snapshot.text(),
            handle.session.core.error()
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn layout(handle: &TerminalHandle, viewport: Viewport) -> Target {
    handle.resize_viewport(&viewport).unwrap();
    let size = handle.session.core.snapshot().size;
    wait_text(handle, &format!("SIZE {}x{}", size.columns, size.rows));
    let state = handle.session.rendering.lock().unwrap();
    Target::new(&state.as_ref().unwrap().renderer, viewport)
}
fn render(handle: &TerminalHandle, target: &Target) -> bool {
    // Target owns a live BGRA8 texture from this session's shared Metal device.
    unsafe { handle.render_frame(&target.frame()).unwrap() }
}

#[test]
fn pty_session_renders_updates_to_borrowed_framebuffer_and_skips_idle_frames() {
    let _guard = TEST_LOCK.lock().unwrap();
    let session = FakeSession::new(2001);
    let handle = session.handle();
    assert!(handle.needs_frame().is_err());
    let viewport = Viewport {
        width: 512,
        height: 256,
        pixel_ratio: 1.,
    };
    let target = layout(&handle, viewport);
    wait_text(&handle, "FAKE PTY READY");
    assert!(handle.needs_frame().unwrap());
    assert!(render(&handle, &target));
    let ready = target.pixels();
    assert!(
        ready
            .chunks_exact(4)
            .any(|pixel| pixel[..3] == [77, 77, 205])
    );
    assert!(!handle.needs_frame().unwrap());
    assert!(!render(&handle, &target));
    assert_eq!(target.pixels(), ready);
    handle.write("update\r").unwrap();
    wait_text(&handle, "FAKE PTY UPDATED");
    assert!(handle.needs_frame().unwrap());
    assert!(render(&handle, &target));
    let updated = target.pixels();
    assert_ne!(updated, ready);
    assert!(
        updated
            .chunks_exact(4)
            .any(|pixel| pixel[..3] == [225, 158, 108])
    );
    assert!(!handle.needs_frame().unwrap());
    handle.invalidate_frame();
    assert!(handle.needs_frame().unwrap());
    // A rejected framebuffer must not mark this grid as already presented.
    assert!(unsafe { handle.render_frame(&FrameBuffer { metal_texture: 0 }) }.is_err());
    assert!(handle.needs_frame().unwrap());
    assert!(render(&handle, &target));
    assert_eq!(target.pixels(), updated);
}

#[test]
fn rebinding_and_dpi_resize_keep_session_renderer_and_isolate_session_contents() {
    let _guard = TEST_LOCK.lock().unwrap();
    let first = FakeSession::new(2002);
    let second = FakeSession::new(2003);
    let a = first.handle();
    let b = second.handle();
    let viewport = Viewport {
        width: 512,
        height: 256,
        pixel_ratio: 1.,
    };
    let ta = layout(&a, viewport);
    let tb = layout(&b, viewport);
    a.write("update\r").unwrap();
    wait_text(&a, "FAKE PTY UPDATED");
    wait_text(&b, "FAKE PTY READY");
    assert!(render(&a, &ta));
    assert!(render(&b, &tb));
    let retained = ta.pixels();
    assert_ne!(retained, tb.pixels());
    let renderer = &*a
        .session
        .rendering
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .renderer as *const _;
    drop(a);
    let rebound = first.handle();
    assert_eq!(
        &*rebound
            .session
            .rendering
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .renderer as *const _,
        renderer
    );
    assert!(!rebound.needs_frame().unwrap());
    rebound.invalidate_frame();
    assert!(render(&rebound, &ta));
    assert_eq!(ta.pixels(), retained);
    let high_dpi = Viewport {
        pixel_ratio: 2.,
        ..viewport
    };
    let resized = layout(&rebound, high_dpi);
    assert!(rebound.needs_frame().unwrap());
    assert!(render(&rebound, &resized));
    assert_ne!(resized.pixels(), retained);
    close_terminal_session(first.0);
    assert!(acquire_terminal(first.0).is_err());
    assert!(rebound.write("x").is_err());
    assert!(b.write("still alive").is_ok());
}
