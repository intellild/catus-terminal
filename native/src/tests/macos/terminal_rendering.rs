use super::*;
use crate::renderer::{DrawState, FramePreparation, Renderer};
use crate::terminal_content::TerminalContent;
use crate::terminal_core::pty::test_sender;
use crate::terminal_session::Session;
use crate::terminal_session::session;
use crate::terminal_session::{
    TerminalSessionCommand, close_terminal_session, create_terminal_session,
};
use crate::{frame::Viewport, platform::test_support::Target, renderer::test_support::TEST_LOCK};
use anyhow::Context;
use std::time::{Duration, Instant};
use std::{
    cell::{Cell, RefCell},
    sync::Arc,
};

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
                host_id: None,
                tmux: None,
                cwd: None,
                program: std::env::var("CATUS_E2E_NODE").unwrap_or_else(|_| "node".into()),
                args: vec![fixture],
            }),
        )
        .unwrap();
        Self(id)
    }

    fn fixture(&self) -> RenderFixture {
        RenderFixture {
            renderer: Renderer::offscreen(),
            drawing: RefCell::default(),
            content: TerminalContent::new(session(self.0).unwrap()),
            viewport: Cell::new(None),
        }
    }
}

struct RenderFixture {
    renderer: Arc<Renderer>,
    drawing: RefCell<DrawState>,
    content: TerminalContent,
    viewport: Cell<Option<Viewport>>,
}

impl RenderFixture {
    fn session(&self) -> &Session {
        &self.content.session
    }

    fn paint(
        &self,
        deadline: i64,
        present: impl FnOnce(&mut PreparedFrame<'_>) -> anyhow::Result<RenderOutcome>,
    ) -> anyhow::Result<RenderOutcome> {
        let viewport = self.viewport.get().context("Waiting for layout")?;
        match self.renderer.prepare_frame(
            &mut self.drawing.borrow_mut(),
            &self.content,
            viewport,
            deadline,
        )? {
            FramePreparation::Idle => Ok(RenderOutcome::Idle),
            FramePreparation::Deferred => Ok(RenderOutcome::Retry),
            FramePreparation::Ready(mut frame) => present(&mut frame),
        }
    }

    fn needs_frame(&self) -> anyhow::Result<bool> {
        let viewport = self.viewport.get().context("Waiting for layout")?;
        self.renderer
            .painter(&mut self.drawing.borrow_mut())?
            .needs_grid(self.session().revision(), &viewport)
    }
}
impl Drop for FakeSession {
    fn drop(&mut self) {
        close_terminal_session(self.0);
    }
}
fn wait_text(handle: &RenderFixture, expected: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let snapshot = handle.session().snapshot();
        if snapshot.text().contains(expected) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "Missing {expected:?}: {} / {:?}",
            snapshot.text(),
            handle.session().error()
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn layout(handle: &RenderFixture, viewport: Viewport) -> Target {
    handle
        .session()
        .resize(handle.renderer.measure_cells(&viewport).unwrap().size)
        .unwrap();
    handle.viewport.set(Some(viewport));
    let size = handle.session().snapshot().size;
    wait_text(handle, &format!("SIZE {}x{}", size.columns, size.rows));
    Target::new(viewport)
}
fn render_surface(
    handle: &RenderFixture,
    surface: &objc2_io_surface::IOSurfaceRef,
    deadline: i64,
) -> anyhow::Result<RenderOutcome> {
    handle.paint(deadline, |frame| {
        Ok(if super::super::osr::render_surface(frame, surface)? {
            RenderOutcome::Presented
        } else {
            RenderOutcome::Retry
        })
    })
}
fn render(handle: &RenderFixture, target: &Target) -> bool {
    // Target owns the IOSurface used by this synchronous render call.
    matches!(
        render_surface(handle, target.surface(), i64::MAX).unwrap(),
        RenderOutcome::Presented
    )
}

#[test]
fn pty_session_renders_updates_to_borrowed_framebuffer_and_skips_idle_frames() {
    let _guard = TEST_LOCK.lock().unwrap();
    let session = FakeSession::new(2001);
    let handle = session.fixture();
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
            .as_chunks::<4>()
            .0
            .iter()
            .any(|pixel| pixel[..3] == [77, 77, 205])
    );
    assert!(!handle.needs_frame().unwrap());
    assert!(!render(&handle, &target));
    assert!(matches!(
        render_surface(&handle, target.surface(), i64::MAX).unwrap(),
        RenderOutcome::Idle
    ));
    assert_eq!(target.pixels(), ready);
    handle.session().write(b"update\r".to_vec()).unwrap();
    wait_text(&handle, "FAKE PTY UPDATED");
    assert!(handle.needs_frame().unwrap());
    assert!(render(&handle, &target));
    let updated = target.pixels();
    assert_ne!(updated, ready);
    assert!(
        updated
            .as_chunks::<4>()
            .0
            .iter()
            .any(|pixel| pixel[..3] == [225, 158, 108])
    );
    assert!(!handle.needs_frame().unwrap());
    handle.drawing.borrow_mut().invalidate();
    assert!(handle.needs_frame().unwrap());
    assert!(render(&handle, &target));
    assert_eq!(target.pixels(), updated);
}

#[test]
fn rebinding_one_element_repaints_each_session_and_applies_its_viewport() {
    let _guard = TEST_LOCK.lock().unwrap();
    let first = FakeSession::new(2002);
    let second = FakeSession::new(2003);
    let mut content = first.fixture();
    let viewport = Viewport {
        width: 512,
        height: 256,
        pixel_ratio: 1.,
    };
    let target = layout(&content, viewport);
    content.session().write(b"update\r".to_vec()).unwrap();
    wait_text(&content, "FAKE PTY UPDATED");
    assert!(render(&content, &target));
    let first_pixels = target.pixels();

    content.content = TerminalContent::new(session(second.0).unwrap());
    content.drawing.borrow_mut().invalidate();
    layout(&content, viewport);
    assert!(render(&content, &target));
    assert_ne!(target.pixels(), first_pixels);
    assert!(!render(&content, &target));

    content.content = TerminalContent::new(session(first.0).unwrap());
    content.drawing.borrow_mut().invalidate();
    assert!(render(&content, &target));
    assert_eq!(target.pixels(), first_pixels);
    let resized = layout(
        &content,
        Viewport {
            pixel_ratio: 2.,
            ..viewport
        },
    );
    assert!(render(&content, &resized));
    assert_ne!(resized.pixels(), first_pixels);
    close_terminal_session(first.0);
    assert!(session(first.0).is_err());
    assert!(content.session().write(b"x".to_vec()).is_err());
    assert!(
        session(second.0)
            .unwrap()
            .write(b"still alive".to_vec())
            .is_ok()
    );
}

#[test]
fn session_drops_expired_and_busy_frames_then_renders_the_latest_grid() {
    let _guard = TEST_LOCK.lock().unwrap();
    let session = FakeSession::new(2004);
    let handle = session.fixture();
    let viewport = Viewport {
        width: 512,
        height: 256,
        pixel_ratio: 1.,
    };
    let target = layout(&handle, viewport);
    wait_text(&handle, "FAKE PTY READY");
    let initial = target.pixels();
    assert!(matches!(
        render_surface(&handle, target.surface(), 0).unwrap(),
        RenderOutcome::Retry
    ));
    assert_eq!(target.pixels(), initial);
    assert!(handle.needs_frame().unwrap());
    handle.session().with_grid_locked(|| {
        assert!(matches!(
            render_surface(&handle, target.surface(), i64::MAX).unwrap(),
            RenderOutcome::Retry
        ));
    });
    handle.session().write(b"update\r".to_vec()).unwrap();
    wait_text(&handle, "FAKE PTY UPDATED");
    assert!(matches!(
        render_surface(&handle, target.surface(), i64::MAX).unwrap(),
        RenderOutcome::Presented
    ));
    assert!(
        target
            .pixels()
            .as_chunks::<4>()
            .0
            .iter()
            .any(|pixel| pixel[..3] == [225, 158, 108])
    );
    assert!(!handle.needs_frame().unwrap());
}

#[test]
fn rust_validates_borrowed_iosurface_layout_and_preserves_dirty_state_on_failure() {
    let _guard = TEST_LOCK.lock().unwrap();
    let session = FakeSession::new(2005);
    let handle = session.fixture();
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
        render_surface(&handle, wrong_size.surface(), i64::MAX)
            .unwrap_err()
            .to_string()
            .contains("dimensions or pixel layout")
    );
    assert!(handle.needs_frame().unwrap());
    let wrong_pixels = Target::with_bytes_per_element(viewport, 1);
    assert!(
        render_surface(&handle, wrong_pixels.surface(), i64::MAX)
            .unwrap_err()
            .to_string()
            .contains("dimensions or pixel layout")
    );
    assert!(handle.needs_frame().unwrap());
    assert!(render(&handle, &valid));
    assert!(
        valid
            .pixels()
            .as_chunks::<4>()
            .0
            .iter()
            .any(|pixel| pixel[..3] == [77, 77, 205])
    );
    assert!(!handle.needs_frame().unwrap());
}

#[test]
fn metal_layer_drawable_uses_the_element_renderer_and_skips_idle_or_expired_frames() {
    use objc2::{class, msg_send, rc::Retained};
    use objc2_core_foundation::CGSize;
    use objc2_quartz_core::CAMetalLayer;
    use std::cell::Cell;
    let _guard = TEST_LOCK.lock().unwrap();
    let session = FakeSession::new(2099);
    let handle = session.fixture();
    let viewport = Viewport {
        width: 512,
        height: 256,
        pixel_ratio: 1.,
    };
    let _target = layout(&handle, viewport);
    wait_text(&handle, "FAKE PTY READY");
    objc2::rc::autoreleasepool(|_| unsafe {
        let layer: Retained<CAMetalLayer> = msg_send![class!(CAMetalLayer), new];
        let _: () = msg_send![&*layer, setDrawableSize: CGSize::new(512., 256.)];
        let configured = Cell::new(false);
        assert_eq!(
            handle
                .paint(0, |frame| super::render_layer(frame, &layer, &configured))
                .unwrap(),
            RenderOutcome::Retry
        );
        assert!(
            !configured.get(),
            "an expired tick must not configure or draw"
        );
        assert!(handle.needs_frame().unwrap());
        assert_eq!(
            handle
                .paint(i64::MAX, |frame| super::render_layer(
                    frame,
                    &layer,
                    &configured
                ))
                .unwrap(),
            RenderOutcome::Presented
        );
        assert!(configured.get());
        assert!(!handle.needs_frame().unwrap());
        assert_eq!(
            handle
                .paint(i64::MAX, |frame| super::render_layer(
                    frame,
                    &layer,
                    &configured
                ))
                .unwrap(),
            RenderOutcome::Idle
        );
        let cursor = handle
            .renderer
            .measure_cells(&viewport)
            .unwrap()
            .geometry
            .cursor_rect(
                handle
                    .session()
                    .snapshot()
                    .insertion_point
                    .unwrap_or_default(),
            );
        assert!(cursor.width > 0. && cursor.height > 0.);
        handle.session().write(b"update\r".to_vec()).unwrap();
        wait_text(&handle, "FAKE PTY UPDATED");
        assert_eq!(
            handle
                .paint(i64::MAX, |frame| super::render_layer(
                    frame,
                    &layer,
                    &configured
                ))
                .unwrap(),
            RenderOutcome::Presented
        );
    });
}

#[test]
fn osr_preedit_is_rendered_without_writing_or_changing_the_terminal_grid() {
    let _guard = TEST_LOCK.lock().unwrap();
    let session = FakeSession::new(2098);
    let mut handle = session.fixture();
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
    let text = handle.session().snapshot().text();
    handle.content.preedit = "中文".into();
    handle.drawing.borrow_mut().invalidate();
    assert!(handle.needs_frame().unwrap());
    assert!(render(&handle, &target));
    assert_ne!(target.pixels(), pixels);
    assert_eq!(handle.session().snapshot().text(), text);
    handle.content.preedit.clear();
    handle.drawing.borrow_mut().invalidate();
    assert!(render(&handle, &target));
    assert_eq!(target.pixels(), pixels);
}

#[test]
fn supplied_grid_renders_to_surface_without_a_terminal_session() {
    use crate::terminal_core::grid::TerminalGrid;
    let _guard = TEST_LOCK.lock().unwrap();
    let mut renderer_state = crate::renderer::DrawState::default();
    let mut renderer = crate::renderer::Renderer::offscreen()
        .painter(&mut renderer_state)
        .unwrap();
    let viewport = Viewport {
        width: 512,
        height: 128,
        pixel_ratio: 1.,
    };
    let mut grid = TerminalGrid::new(
        crate::renderer::Renderer::offscreen()
            .measure_cells(&viewport)
            .unwrap()
            .size,
        test_sender(),
    );
    grid.advance(b"\x1b[?25l\x1b[41m  \x1b[0mHello");
    let snapshot = grid.snapshot();
    let target = Target::new(viewport);
    let render = |renderer: &mut crate::renderer::GridPainter<'_>, surface, deadline| unsafe {
        super::super::surface::render_to_surface(renderer, &viewport, &snapshot, surface, deadline)
    };
    let blank = target.pixels();
    assert!(!render(&mut renderer, target.surface(), 0).unwrap());
    assert_eq!(target.pixels(), blank);
    assert!(render(&mut renderer, target.surface(), i64::MAX).unwrap());
    let drawn = target.pixels();
    assert_ne!(drawn, blank);
    assert!(
        drawn
            .as_chunks::<4>()
            .0
            .iter()
            .any(|p| p[..3] == [77, 77, 205])
    );
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
    let mut renderer_state = crate::renderer::DrawState::default();
    let mut renderer = crate::renderer::Renderer::offscreen()
        .painter(&mut renderer_state)
        .unwrap();
    let viewport = Viewport {
        width: 512,
        height: 128,
        pixel_ratio: 1.,
    };
    let mut grid = TerminalGrid::new(
        crate::renderer::Renderer::offscreen()
            .measure_cells(&viewport)
            .unwrap()
            .size,
        test_sender(),
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
    let handle = session.fixture();
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
    let geometry = handle
        .renderer
        .measure_cells(&handle.viewport.get().unwrap())
        .unwrap()
        .geometry;
    let (cw, ch) = (geometry.width, geometry.height);
    let mut mouse = crate::platform::MouseState::default();
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
    mouse
        .input(handle.session(), Some(geometry), &event)
        .unwrap();
    assert_eq!(handle.session().selected_text().as_deref(), Some("FAKE"));
    assert!(handle.needs_frame().unwrap());
    assert!(render(&handle, &target));
    let selected = target.pixels();
    assert_ne!(selected, initial);
    assert!(
        selected
            .as_chunks::<4>()
            .0
            .iter()
            .any(|p| p[..3] == [112, 82, 61])
    );
    event.kind = 5;
    event.buttons = crate::binding::types::MouseButtons::EMPTY;
    event.x = f32::NAN;
    event.y = f32::NAN;
    mouse
        .input(handle.session(), Some(geometry), &event)
        .unwrap();
    assert_eq!(handle.session().selected_text().as_deref(), Some("FAKE"));
    event.kind = 3;
    event.x = 8. + cw * 8.2;
    event.y = 8. + ch * 0.5;
    mouse
        .input(handle.session(), Some(geometry), &event)
        .unwrap();
    assert_eq!(
        handle.session().selected_text().as_deref(),
        Some("FAKE"),
        "movement after cancellation cannot extend the selection"
    );
    handle.session().write(b"history\r".to_vec()).unwrap();
    wait_text(&handle, "history 39");
    assert!(handle.session().selected_text().is_none());
    assert!(render(&handle, &target));
    let live_text = handle.session().snapshot().text();
    let live_pixels = target.pixels();
    event.kind = 4;
    event.wheel = f64::from(ch) / 6.;
    mouse
        .input(handle.session(), Some(geometry), &event)
        .unwrap();
    assert_eq!(
        handle.session().snapshot().text(),
        live_text,
        "fractional line must accumulate"
    );
    mouse
        .input(handle.session(), Some(geometry), &event)
        .unwrap();
    assert_ne!(handle.session().snapshot().text(), live_text);
    assert!(handle.needs_frame().unwrap());
    assert!(render(&handle, &target));
    assert_ne!(target.pixels(), live_pixels);
    event.wheel = -f64::from(ch) / 3.;
    mouse
        .input(handle.session(), Some(geometry), &event)
        .unwrap();
    assert_eq!(handle.session().snapshot().text(), live_text);
}
