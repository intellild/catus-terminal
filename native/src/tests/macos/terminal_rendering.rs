use super::*;
use crate::terminal_session::acquire_terminal;
use crate::terminal_session::{
    TerminalSessionCommand, close_terminal_session, create_terminal_session,
};
use crate::{frame::Viewport, platform::test_support::Target, renderer::test_support::TEST_LOCK};
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
                workspace_id: None,
                tmux: None,
                cwd: None,
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
    Target::new(viewport)
}
fn render(handle: &TerminalHandle, target: &Target) -> bool {
    // Target owns an IOSurface borrowed by the synchronous Rust render call.
    unsafe { handle.render_surface(target.surface(), i64::MAX).unwrap() }
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

#[test]
fn session_drops_expired_and_busy_frames_then_renders_the_latest_grid() {
    let _guard = TEST_LOCK.lock().unwrap();
    let session = FakeSession::new(2004);
    let handle = session.handle();
    let viewport = Viewport {
        width: 512,
        height: 256,
        pixel_ratio: 1.,
    };
    let target = layout(&handle, viewport);
    wait_text(&handle, "FAKE PTY READY");
    let initial = target.pixels();
    assert!(!unsafe { handle.render_surface(target.surface(), 0).unwrap() });
    assert_eq!(target.pixels(), initial);
    assert!(handle.needs_frame().unwrap());
    let held = handle.session.rendering.lock().unwrap();
    assert!(!unsafe { handle.render_surface(target.surface(), i64::MAX).unwrap() });
    drop(held);
    handle.write("update\r").unwrap();
    wait_text(&handle, "FAKE PTY UPDATED");
    assert!(unsafe { handle.render_surface(target.surface(), i64::MAX).unwrap() });
    assert!(
        target
            .pixels()
            .chunks_exact(4)
            .any(|pixel| pixel[..3] == [225, 158, 108])
    );
    assert!(!handle.needs_frame().unwrap());
}

#[test]
fn rust_validates_borrowed_iosurface_layout_and_preserves_dirty_state_on_failure() {
    let _guard = TEST_LOCK.lock().unwrap();
    let session = FakeSession::new(2005);
    let handle = session.handle();
    let viewport = Viewport {
        width: 512,
        height: 256,
        pixel_ratio: 1.,
    };
    let valid = layout(&handle, viewport);
    wait_text(&handle, "FAKE PTY READY");
    let wrong_size = Target::new(Viewport {
        width: 128,
        ..viewport
    });
    assert!(
        unsafe { handle.render_surface(wrong_size.surface(), i64::MAX) }
            .unwrap_err()
            .to_string()
            .contains("dimensions or pixel layout")
    );
    assert!(handle.needs_frame().unwrap());
    let wrong_pixels = Target::with_bytes_per_element(viewport, 1);
    assert!(
        unsafe { handle.render_surface(wrong_pixels.surface(), i64::MAX) }
            .unwrap_err()
            .to_string()
            .contains("dimensions or pixel layout")
    );
    assert!(handle.needs_frame().unwrap());
    assert!(render(&handle, &valid));
    assert!(
        valid
            .pixels()
            .chunks_exact(4)
            .any(|pixel| pixel[..3] == [77, 77, 205])
    );
    assert!(!handle.needs_frame().unwrap());
}

#[test]
fn metal_layer_drawable_uses_the_session_renderer_and_skips_idle_or_expired_frames() {
    use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
    use objc2_core_foundation::CGSize;
    let _guard = TEST_LOCK.lock().unwrap();
    let session = FakeSession::new(2099);
    let handle = session.handle();
    let viewport = Viewport {
        width: 512,
        height: 256,
        pixel_ratio: 1.,
    };
    let _target = layout(&handle, viewport);
    wait_text(&handle, "FAKE PTY READY");
    objc2::rc::autoreleasepool(|_| unsafe {
        let layer: Retained<AnyObject> = msg_send![class!(CAMetalLayer), new];
        let _: () = msg_send![&*layer, setDrawableSize: CGSize::new(512., 256.)];
        let pointer = &*layer as *const AnyObject as usize;
        assert!(!handle.render_layer(pointer, 0).unwrap());
        assert!(handle.needs_frame().unwrap());
        assert!(handle.render_layer(pointer, i64::MAX).unwrap());
        assert!(!handle.needs_frame().unwrap());
        assert!(!handle.render_layer(pointer, i64::MAX).unwrap());
        let cursor = handle.cursor_rect().unwrap();
        assert!(cursor.width > 0. && cursor.height > 0.);
        handle.write("update\r").unwrap();
        wait_text(&handle, "FAKE PTY UPDATED");
        assert!(handle.render_layer(pointer, i64::MAX).unwrap());
    });
}

#[test]
fn osr_preedit_is_rendered_without_writing_or_changing_the_terminal_grid() {
    let _guard = TEST_LOCK.lock().unwrap();
    let session = FakeSession::new(2098);
    let handle = session.handle();
    let target = layout(
        &handle,
        Viewport {
            width: 512,
            height: 256,
            pixel_ratio: 1.,
        },
    );
    wait_text(&handle, "FAKE PTY READY");
    assert!(render(&handle, &target));
    let pixels = target.pixels();
    let text = handle.session.core.snapshot().text();
    // The Rust input view owns a clone; its preedit must reach the render handle.
    let input_handle = handle.clone();
    input_handle.set_preedit("中文");
    assert!(handle.needs_frame().unwrap());
    assert!(render(&handle, &target));
    assert_ne!(target.pixels(), pixels);
    assert_eq!(handle.session.core.snapshot().text(), text);
    input_handle.set_preedit("");
    assert!(render(&handle, &target));
    assert_eq!(target.pixels(), pixels);
}

#[test]
fn supplied_grid_renders_to_surface_without_a_terminal_session() {
    use crate::terminal_core::grid::TerminalGrid;
    let _guard = TEST_LOCK.lock().unwrap();
    let mut renderer = crate::renderer::create_terminal_renderer().unwrap();
    let viewport = Viewport {
        width: 512,
        height: 128,
        pixel_ratio: 1.,
    };
    let mut grid = TerminalGrid::new(
        renderer.grid_size(&viewport).unwrap(),
        std::sync::mpsc::channel().0,
    );
    grid.advance(b"\x1b[?25l\x1b[41m  \x1b[0mHello");
    let snapshot = grid.snapshot();
    let target = Target::new(viewport);
    let render = |renderer: &mut crate::renderer::TerminalRenderer, surface, deadline| unsafe {
        super::super::surface::render_to_surface(renderer, &viewport, &snapshot, surface, deadline)
    };
    let blank = target.pixels();
    assert!(!render(&mut renderer, target.surface(), 0).unwrap());
    assert_eq!(target.pixels(), blank);
    assert!(render(&mut renderer, target.surface(), i64::MAX).unwrap());
    let drawn = target.pixels();
    assert_ne!(drawn, blank);
    assert!(drawn.chunks_exact(4).any(|p| p[..3] == [77, 77, 205]));
    let wrong_size = Target::new(Viewport {
        width: 64,
        ..viewport
    });
    assert!(render(&mut renderer, wrong_size.surface(), i64::MAX).is_err());
    // Rejected targets leave the original buffer intact.
    assert_eq!(target.pixels(), drawn);
}

#[test]
fn direct_metal_and_lynx_osr_use_opposite_target_y_origins() {
    use crate::terminal_core::grid::TerminalGrid;
    let _guard = TEST_LOCK.lock().unwrap();
    let mut renderer = crate::renderer::create_terminal_renderer().unwrap();
    let viewport = Viewport {
        width: 512,
        height: 128,
        pixel_ratio: 1.,
    };
    let mut grid = TerminalGrid::new(
        renderer.grid_size(&viewport).unwrap(),
        std::sync::mpsc::channel().0,
    );
    grid.advance(b"\x1b[?25l\x1b[41m  \x1b[0m");
    let snapshot = grid.snapshot();
    let direct = Target::new(viewport);
    let osr = Target::new(viewport);
    assert!(
        renderer
            .render_grid(&viewport, &snapshot, i64::MAX, |device| unsafe {
                super::super::surface::import_surface(device, direct.surface(), &viewport)
            })
            .unwrap()
    );
    assert!(
        unsafe {
            super::super::surface::render_to_surface(
                &mut renderer,
                &viewport,
                &snapshot,
                osr.surface(),
                i64::MAX,
            )
        }
        .unwrap()
    );
    let direct_pixels = direct.pixels();
    let osr_pixels = osr.pixels();
    let pixel = |pixels: &[u8], y: u32| {
        let offset = ((y * viewport.width + 9) * 4) as usize;
        pixels[offset..offset + 3].to_vec()
    };
    assert_eq!(
        pixel(&direct_pixels, 9),
        [77, 77, 205],
        "first row belongs at top of direct Metal target"
    );
    assert_ne!(pixel(&direct_pixels, viewport.height - 10), [77, 77, 205]);
    assert_eq!(
        pixel(&osr_pixels, viewport.height - 10),
        [77, 77, 205],
        "OSR host composition flips Y"
    );
    assert_ne!(pixel(&osr_pixels, 9), [77, 77, 205]);
}

#[test]
fn native_mouse_selection_and_precision_scroll_refresh_the_surface() {
    let _guard = TEST_LOCK.lock().unwrap();
    let session = FakeSession::new(2097);
    let handle = session.handle();
    let target = layout(
        &handle,
        Viewport {
            width: 512,
            height: 256,
            pixel_ratio: 2.,
        },
    );
    wait_text(&handle, "FAKE PTY READY");
    assert!(render(&handle, &target));
    let initial = target.pixels();
    let (cw, ch) = {
        let rendering = handle.session.rendering.lock().unwrap();
        let state = rendering.as_ref().unwrap();
        let (cw, ch) = state.renderer.cell_size(&state.viewport).unwrap();
        (cw / 2., ch / 2.)
    };
    let mut event = ffi::NativeMouseEvent {
        kind: 1,
        x: 8. + cw * 3.2,
        y: 8. + ch * 0.5,
        wheel: 0.,
        precise: true,
        buttons: crate::binding::types::MouseButton::Primary.into(),
        shift: false,
        control: false,
        alt: false,
        clicks: 2,
    };
    handle.mouse_input(&event).unwrap();
    assert_eq!(handle.session.core.selected_text().as_deref(), Some("FAKE"));
    assert!(handle.needs_frame().unwrap());
    assert!(render(&handle, &target));
    let selected = target.pixels();
    assert_ne!(selected, initial);
    assert!(selected.chunks_exact(4).any(|p| p[..3] == [112, 82, 61]));
    event.kind = 5;
    event.buttons = crate::binding::types::MouseButtons::EMPTY;
    event.x = f32::NAN;
    event.y = f32::NAN;
    handle.mouse_input(&event).unwrap();
    assert_eq!(handle.session.core.selected_text().as_deref(), Some("FAKE"));
    event.kind = 3;
    event.x = 8. + cw * 8.2;
    event.y = 8. + ch * 0.5;
    handle.mouse_input(&event).unwrap();
    assert_eq!(
        handle.session.core.selected_text().as_deref(),
        Some("FAKE"),
        "movement after cancellation cannot extend the selection"
    );
    handle.write("history\r").unwrap();
    wait_text(&handle, "history 39");
    assert!(handle.session.core.selected_text().is_none());
    assert!(render(&handle, &target));
    let live_text = handle.session.core.snapshot().text();
    let live_pixels = target.pixels();
    event.kind = 4;
    event.wheel = f64::from(ch) / 6.;
    handle.mouse_input(&event).unwrap();
    assert_eq!(
        handle.session.core.snapshot().text(),
        live_text,
        "fractional line must accumulate"
    );
    handle.mouse_input(&event).unwrap();
    assert_ne!(handle.session.core.snapshot().text(), live_text);
    assert!(handle.needs_frame().unwrap());
    assert!(render(&handle, &target));
    assert_ne!(target.pixels(), live_pixels);
    event.wheel = -f64::from(ch) / 3.;
    handle.mouse_input(&event).unwrap();
    assert_eq!(handle.session.core.snapshot().text(), live_text);
}
