use super::test_support::TEST_LOCK;
use super::*;
use crate::terminal_core::grid::TerminalGrid;

// These tests deliberately clear the process cache; isolate them from each other.
fn viewport(ratio: f32) -> Viewport {
    Viewport {
        width: 512,
        height: 128,
        pixel_ratio: ratio,
    }
}
fn target(renderer: &TerminalRenderer) -> wgpu::Texture {
    renderer
        .gpu
        .device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("Terminal grid test target"),
            size: wgpu::Extent3d {
                width: 512,
                height: 128,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Bgra8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        })
}
fn grid(renderer: &TerminalRenderer, viewport: &Viewport, text: &str) -> GridSnapshot {
    let size = renderer.grid_size(viewport).unwrap();
    let mut grid = TerminalGrid::new(size, std::sync::mpsc::channel().0);
    grid.advance(text.as_bytes());
    grid.snapshot()
}
fn uploads(renderer: &TerminalRenderer) -> u64 {
    renderer.gpu.glyphs().unwrap().cache.atlas.uploads()
}
fn draw(
    renderer: &mut TerminalRenderer,
    target: &wgpu::Texture,
    viewport: &Viewport,
    grid: &GridSnapshot,
) {
    renderer
        .render_into(&target.create_view(&Default::default()), viewport, grid)
        .unwrap();
}
fn pixels(renderer: &TerminalRenderer, target: &wgpu::Texture) -> Vec<u8> {
    let gpu = &renderer.gpu;
    let buffer = gpu.device.create_buffer(&wgpu::BufferDescriptor {
        label: None,
        size: 512 * 128 * 4,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = gpu.device.create_command_encoder(&Default::default());
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: target,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(512 * 4),
                rows_per_image: Some(128),
            },
        },
        wgpu::Extent3d {
            width: 512,
            height: 128,
            depth_or_array_layers: 1,
        },
    );
    gpu.queue.submit([encoder.finish()]);
    let (tx, rx) = std::sync::mpsc::channel();
    buffer
        .slice(..)
        .map_async(wgpu::MapMode::Read, move |result| {
            tx.send(result).unwrap();
        });
    gpu.device
        .poll(wgpu::PollType::wait_indefinitely())
        .unwrap();
    rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    let pixels = buffer.slice(..).get_mapped_range().unwrap().to_vec();
    buffer.unmap();
    pixels
}

#[test]
fn real_grid_renders_background_glyphs_and_reuses_atlas() {
    let _guard = TEST_LOCK.lock().unwrap();
    let mut renderer = create_terminal_renderer().unwrap();
    renderer.gpu.glyphs().unwrap().clear();
    let viewport = viewport(1.);
    let grid = grid(
        &renderer,
        &viewport,
        "\x1b[?25l\x1b[41m  \x1b[0m\x1b[32mHello 中 😀\x1b[0m",
    );
    let target = target(&renderer);
    draw(&mut renderer, &target, &viewport, &grid);
    let initial_uploads = uploads(&renderer);
    assert!(initial_uploads > 0);
    draw(&mut renderer, &target, &viewport, &grid);
    assert_eq!(uploads(&renderer), initial_uploads);
    assert!(!renderer.needs_grid(grid.revision, &viewport).unwrap());
    let pixels = pixels(&renderer, &target);
    assert!(pixels.chunks_exact(4).any(|p| p[..3] == [77, 77, 205]));
    assert!(pixels.chunks_exact(4).any(|p| p[1] > p[0] && p[1] > p[2]));
}

#[test]
fn views_share_device_atlas_and_multiple_scales_after_recreation() {
    let _guard = TEST_LOCK.lock().unwrap();
    let mut first = create_terminal_renderer().unwrap();
    first.gpu.glyphs().unwrap().clear();
    let mut second = create_terminal_renderer().unwrap();
    assert!(std::sync::Arc::ptr_eq(&first.gpu, &second.gpu));
    let small = viewport(1.);
    let large = viewport(2.);
    let grid = grid(&first, &small, "\x1b[?25lSAME 中 😀");
    let a = target(&first);
    let b = target(&second);
    draw(&mut first, &a, &small, &grid);
    let initial = uploads(&first);
    draw(&mut second, &b, &small, &grid);
    assert_eq!(uploads(&second), initial);
    assert_eq!(pixels(&first, &a), pixels(&second, &b));
    draw(&mut second, &b, &large, &grid);
    let both_sizes = uploads(&second);
    assert!(both_sizes > initial);
    assert!(!first.needs_grid(grid.revision, &small).unwrap());
    draw(&mut first, &a, &small, &grid);
    assert_eq!(uploads(&first), both_sizes);
    let gpu = std::sync::Arc::as_ptr(&first.gpu);
    drop(first);
    drop(second);
    let mut recreated = create_terminal_renderer().unwrap();
    assert_eq!(std::sync::Arc::as_ptr(&recreated.gpu), gpu);
    draw(&mut recreated, &a, &small, &grid);
    assert_eq!(uploads(&recreated), both_sizes);
}

#[test]
fn concurrent_views_keep_separate_buffers_and_failed_uploads_invalidate_all_views() {
    let _guard = TEST_LOCK.lock().unwrap();
    let mut first = create_terminal_renderer().unwrap();
    first.gpu.glyphs().unwrap().clear();
    let mut second = create_terminal_renderer().unwrap();
    let viewport = viewport(1.);
    let red = grid(&first, &viewport, "\x1b[?25l\x1b[41m RED");
    let green = grid(&second, &viewport, "\x1b[?25l\x1b[42m GREEN");
    let a = target(&first);
    let b = target(&second);
    std::thread::scope(|scope| {
        scope.spawn(|| draw(&mut first, &a, &viewport, &red));
        scope.spawn(|| draw(&mut second, &b, &viewport, &green));
    });
    assert!(
        pixels(&first, &a)
            .chunks_exact(4)
            .any(|p| p[..3] == [77, 77, 205])
    );
    assert!(
        pixels(&second, &b)
            .chunks_exact(4)
            .any(|p| p[..3] == [126, 194, 122])
    );
    assert!(!first.needs_grid(red.revision, &viewport).unwrap());
    assert!(!second.needs_grid(green.revision, &viewport).unwrap());
    let invalid = Viewport {
        pixel_ratio: 0.,
        ..viewport
    };
    assert!(
        first
            .render_into(&a.create_view(&Default::default()), &invalid, &red)
            .is_err()
    );
    assert!(first.needs_grid(red.revision, &viewport).unwrap());
    assert!(second.needs_grid(green.revision, &viewport).unwrap());
    draw(&mut first, &a, &viewport, &red);
    draw(&mut second, &b, &viewport, &green);
    assert!(!second.needs_grid(green.revision, &viewport).unwrap());
}

#[test]
fn expired_or_busy_frames_leave_the_grid_dirty_without_gpu_uploads() {
    let _guard = TEST_LOCK.lock().unwrap();
    let mut renderer = create_terminal_renderer().unwrap();
    let viewport = viewport(1.);
    let grid = grid(&renderer, &viewport, "\x1b[?25l DROP / RETRY");
    let target = target(&renderer);
    let view = target.create_view(&Default::default());
    let initial_uploads = uploads(&renderer);
    assert!(
        !renderer
            .render_into_before(&view, &viewport, &grid, Some(0))
            .unwrap()
    );
    assert!(renderer.needs_grid(grid.revision, &viewport).unwrap());
    assert_eq!(uploads(&renderer), initial_uploads);
    let gpu = renderer.gpu.clone();
    let shared = gpu.glyphs().unwrap();
    assert!(
        renderer
            .try_needs_grid(grid.revision, &viewport)
            .unwrap()
            .is_none()
    );
    assert!(
        !renderer
            .render_into_before(&view, &viewport, &grid, Some(i64::MAX))
            .unwrap()
    );
    drop(shared);
    assert!(renderer.needs_grid(grid.revision, &viewport).unwrap());
    assert_eq!(uploads(&renderer), initial_uploads);
    assert!(
        renderer
            .render_into_before(&view, &viewport, &grid, Some(i64::MAX))
            .unwrap()
    );
    assert!(!renderer.needs_grid(grid.revision, &viewport).unwrap());
}

#[test]
fn shared_renderer_prepares_wgpu_targets_only_for_valid_live_frames() {
    let _guard = TEST_LOCK.lock().unwrap();
    let mut renderer = create_terminal_renderer().unwrap();
    let viewport = viewport(1.);
    let grid = grid(&renderer, &viewport, "\x1b[?25l SHARED TARGET");
    let target = target(&renderer);
    assert!(
        !renderer
            .render_grid(&viewport, &grid, 0, |_| {
                panic!("Expired frames must not prepare a render target");
            })
            .unwrap()
    );
    assert!(
        renderer
            .render_grid(
                &Viewport {
                    width: 0,
                    ..viewport
                },
                &grid,
                i64::MAX,
                |_| {
                    panic!("Invalid layouts must not prepare a render target");
                }
            )
            .is_err()
    );
    let error = renderer
        .render_grid(&viewport, &grid, i64::MAX, |_| {
            Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe))
                .context("Prepare render target")
        })
        .unwrap_err();
    assert_eq!(
        error
            .root_cause()
            .downcast_ref::<std::io::Error>()
            .unwrap()
            .kind(),
        std::io::ErrorKind::BrokenPipe
    );
    assert!(renderer.needs_grid(grid.revision, &viewport).unwrap());
    assert!(
        renderer
            .render_grid(&viewport, &grid, i64::MAX, |_| Ok(target.clone()))
            .unwrap()
    );
    assert!(!renderer.needs_grid(grid.revision, &viewport).unwrap());
    assert!(
        pixels(&renderer, &target)
            .chunks_exact(4)
            .any(|pixel| pixel[1] > 32)
    );
}
