use super::*;

#[test]
fn shelves_fit_exact_edges_and_failed_allocation_does_not_consume_space() {
    let mut a = AtlasAllocator::new(8).unwrap();
    assert_eq!(a.allocate(5, 3).unwrap(), [0, 0]);
    assert_eq!(a.allocate(3, 5).unwrap(), [5, 0]);
    assert_eq!(
        a.allocate(9, 1).unwrap_err().downcast_ref::<AtlasError>(),
        Some(&AtlasError::GlyphTooLarge)
    );
    assert_eq!(
        a.allocate(4, 4).unwrap_err().downcast_ref::<AtlasError>(),
        Some(&AtlasError::Full)
    );
    assert_eq!(a.allocate(8, 3).unwrap(), [0, 5]);
    assert_eq!(
        a.allocate(1, 1).unwrap_err().downcast_ref::<AtlasError>(),
        Some(&AtlasError::Full)
    );
    a.clear();
    assert_eq!(a.allocate(8, 8).unwrap(), [0, 0]);
    assert_eq!(a.allocate(0, 8).unwrap(), [0, 0]);
}

#[test]
fn mask_rows_are_normalized_and_padded_without_mixing_pixels() {
    let rgb: Vec<u8> = (0..18).collect();
    let upload = prepare_upload(&RasterizedGlyph {
        width: 3,
        height: 2,
        top: 0,
        left: 0,
        buffer: BitmapBuffer::Rgb(&rgb),
    })
    .unwrap();
    assert_eq!(upload.bytes_per_row, 256);
    assert_eq!(&upload.bytes[..3], &[1, 4, 7]);
    assert!(upload.bytes[3..256].iter().all(|b| *b == 0));
    assert_eq!(&upload.bytes[256..259], &[10, 13, 16]);
    assert!(
        prepare_upload(&RasterizedGlyph {
            width: 3,
            height: 2,
            top: 0,
            left: 0,
            buffer: BitmapBuffer::Rgb(&rgb[..17])
        })
        .is_err()
    );
}

// Exercises real Metal copies, not just CPU packing or a mocked queue.
#[test]
#[cfg(target_os = "macos")]
fn gpu_upload_page_rollover_clear_and_stale_handles() {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: crate::platform::GPU_BACKENDS,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).unwrap();
    let validation = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let mut atlas = AtlasSet::new(&device, 8).unwrap();
    let mut encoder = device.create_command_encoder(&Default::default());
    let rgb: Vec<u8> = (0..64).flat_map(|i| [i as u8, 23, 47]).collect();
    let first = atlas
        .insert(
            &device,
            &mut encoder,
            &RasterizedGlyph {
                width: 8,
                height: 8,
                top: 7,
                left: -2,
                buffer: BitmapBuffer::Rgb(&rgb),
            },
        )
        .unwrap();
    let rgba = [16, 32, 48, 64].repeat(6);
    let second = atlas
        .insert(
            &device,
            &mut encoder,
            &RasterizedGlyph {
                width: 3,
                height: 2,
                top: 2,
                left: 0,
                buffer: BitmapBuffer::Rgba(&rgba),
            },
        )
        .unwrap();
    let gray = [128, 255, 64, 0, 17, 99];
    let third = atlas
        .insert(
            &device,
            &mut encoder,
            &RasterizedGlyph {
                width: 3,
                height: 2,
                top: 2,
                left: 0,
                buffer: BitmapBuffer::Gray(&gray),
            },
        )
        .unwrap();
    assert_eq!(third.page, 2); // Mask page 0 is full; color page 1 is skipped.
    assert_eq!(
        atlas.texture(&first).unwrap().format(),
        wgpu::TextureFormat::R8Unorm
    );
    assert_eq!(
        atlas.texture(&second).unwrap().format(),
        wgpu::TextureFormat::Rgba8Unorm
    );
    assert_eq!(atlas.pages(), 3);
    assert_eq!(atlas.uploads(), 3);
    assert_eq!(
        (first.page, first.top, first.left, first.multicolor),
        (0, 7, -2, false)
    );
    assert_eq!((second.page, second.multicolor), (1, true));
    queue.submit([encoder.finish()]);
    fn read(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        atlas: &AtlasSet,
        glyph: &Glyph,
    ) -> Vec<u8> {
        let stride = 256u64;
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Atlas GPU test readback"),
            size: stride * glyph.height as u64,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let mut encoder = device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: atlas.texture(glyph).unwrap(),
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: glyph.origin[0],
                    y: glyph.origin[1],
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(stride as u32),
                    rows_per_image: Some(glyph.height),
                },
            },
            wgpu::Extent3d {
                width: glyph.width,
                height: glyph.height,
                depth_or_array_layers: 1,
            },
        );
        let submission = queue.submit([encoder.finish()]);
        let (tx, rx) = std::sync::mpsc::channel();
        buffer
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                tx.send(result).unwrap();
            });
        device
            .poll(wgpu::PollType::Wait {
                submission_index: Some(submission),
                timeout: Some(std::time::Duration::from_secs(10)),
            })
            .unwrap();
        rx.recv_timeout(std::time::Duration::from_secs(10))
            .unwrap()
            .unwrap();
        let mapped = buffer.slice(..).get_mapped_range().unwrap();
        let packed: Vec<u8> = mapped
            .chunks(stride as usize)
            .flat_map(|row| {
                row[..glyph.width as usize * if glyph.multicolor { 4 } else { 1 }]
                    .iter()
                    .copied()
            })
            .collect();
        drop(mapped);
        buffer.unmap();
        packed
    }
    let expected: Vec<u8> = rgb
        .chunks_exact(3)
        .map(|p| ((u16::from(p[0]) + u16::from(p[1]) + u16::from(p[2])) / 3) as u8)
        .collect();
    assert_eq!(read(&device, &queue, &atlas, &first), expected);
    assert_eq!(read(&device, &queue, &atlas, &second), rgba);
    assert_eq!(read(&device, &queue, &atlas, &third), gray);
    atlas.clear();
    assert_eq!(atlas.pages(), 3); // GPU allocation reused.
    assert_eq!(
        atlas.view(&first).unwrap_err().downcast_ref::<AtlasError>(),
        Some(&AtlasError::StaleGlyph)
    );
    let mut encoder = device.create_command_encoder(&Default::default());
    let reused = atlas
        .insert(
            &device,
            &mut encoder,
            &RasterizedGlyph {
                width: 3,
                height: 2,
                top: 0,
                left: 0,
                buffer: BitmapBuffer::Rgba(&rgba),
            },
        )
        .unwrap();
    assert_eq!((reused.page, reused.origin), (1, [0, 0]));
    queue.submit([encoder.finish()]);
    assert_eq!(read(&device, &queue, &atlas, &reused), rgba);
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    assert!(pollster::block_on(validation.pop()).is_none());
}
