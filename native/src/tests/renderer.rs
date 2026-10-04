use super::*;
use crate::terminal_core::grid::{GridSize, TerminalGrid};

#[test]
fn real_grid_renders_background_glyphs_and_reuses_atlas() {
    let renderer = create_terminal_renderer().unwrap();
    let TerminalRenderer {
        device,
        queue,
        mut atlas,
        ..
    } = *renderer;
    let validation = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let (width, height) = (512, 128);
    let size = atlas.grid_size(width, height, 1.).unwrap();
    let mut grid = TerminalGrid::new(
        GridSize::new(size.columns, size.rows),
        std::sync::mpsc::channel().0,
    );
    grid.advance("\x1b[?25l\x1b[41m  \x1b[0m\x1b[32mHello 中 😀\x1b[0m".as_bytes());
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Terminal grid test target"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Bgra8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = target.create_view(&Default::default());
    let draw = |atlas: &mut GlyphRenderer| {
        let mut encoder = device.create_command_encoder(&Default::default());
        atlas
            .draw_grid(
                &device,
                &queue,
                &mut encoder,
                &view,
                [width, height],
                1.,
                &grid.snapshot(),
            )
            .unwrap();
        queue.submit([encoder.finish()]);
    };
    draw(&mut atlas);
    let uploads = atlas.uploads();
    assert!(uploads > 0 && atlas.instances() > 5);
    draw(&mut atlas);
    assert_eq!(atlas.uploads(), uploads);
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: None,
        size: (width * height * 4) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&Default::default());
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: &target,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(width * 4),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    queue.submit([encoder.finish()]);
    let (tx, rx) = std::sync::mpsc::channel();
    buffer
        .slice(..)
        .map_async(wgpu::MapMode::Read, move |result| {
            tx.send(result).unwrap();
        });
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    let pixels = buffer.slice(..).get_mapped_range().unwrap();
    assert!(pixels.chunks_exact(4).any(|p| p[..3] == [77, 77, 205])); // Solid ANSI red background.
    assert!(pixels.chunks_exact(4).any(|p| p[1] > p[0] && p[1] > p[2])); // Green atlas text.
    drop(pixels);
    buffer.unmap();
    assert!(pollster::block_on(validation.pop()).is_none());
}
