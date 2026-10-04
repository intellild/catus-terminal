use super::*;

#[test]
fn coretext_fallback_color_and_real_font_metrics() {
    let mut rasterizer = Rasterizer::new().unwrap();
    let FontSize {
        fonts,
        size,
        metrics,
    } = load_size(&mut rasterizer, 38).unwrap();
    assert!(metrics.average_advance > 0. && metrics.line_height > 0.);
    for character in ['A', 'g', '中'] {
        let glyph = rasterizer
            .get_glyph(GlyphKey {
                character,
                font_key: fonts[0],
                size,
            })
            .unwrap();
        assert!(glyph.width > 0 && glyph.height > 0);
        let crossfont::BitmapBuffer::Rgb(bytes) = glyph.buffer else {
            panic!("Expected mask")
        };
        assert_eq!(
            bytes.len(),
            glyph.width as usize * glyph.height as usize * 3
        );
        assert!(bytes.iter().any(|&coverage| coverage > 0 && coverage < 255));
    }
    let space = rasterizer
        .get_glyph(GlyphKey {
            character: ' ',
            font_key: fonts[0],
            size,
        })
        .unwrap();
    assert_eq!(space.width * space.height, 0);
    let emoji = rasterizer
        .get_glyph(GlyphKey {
            character: '😀',
            font_key: fonts[0],
            size,
        })
        .unwrap();
    let crossfont::BitmapBuffer::Rgba(bytes) = emoji.buffer else {
        panic!("Expected color emoji")
    };
    assert!(
        bytes
            .chunks_exact(4)
            .all(|p| p[..3].iter().all(|&c| c <= p[3]))
    );
}

#[test]
fn gpu_cache_keeps_multiple_sizes_and_invalidates_only_on_clear() {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::METAL,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).unwrap();
    let validation = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let mut cache = GlyphCache::new(&device).unwrap();
    let mut encoder = device.create_command_encoder(&Default::default());
    let a = cache.get(&device, &mut encoder, 32, 'A', false).unwrap();
    assert_eq!(cache.get(&device, &mut encoder, 32, 'A', false).unwrap(), a);
    assert_eq!(cache.rasterizations(), 1);
    let bold = cache.get(&device, &mut encoder, 32, 'A', true).unwrap();
    assert_ne!(bold.origin, a.origin);
    let emoji = cache.get(&device, &mut encoder, 32, '😀', false).unwrap();
    assert!(emoji.multicolor);
    assert_ne!(emoji.page, a.page);
    let space = cache.get(&device, &mut encoder, 32, ' ', false).unwrap();
    assert_eq!(space.width * space.height, 0);
    assert_eq!((cache.len(), cache.atlas.uploads()), (4, 3));
    queue.submit([encoder.finish()]);
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    cache.clear();
    assert!(cache.atlas.view(&a).is_err());
    let mut encoder = device.create_command_encoder(&Default::default());
    let reloaded = cache.get(&device, &mut encoder, 32, 'A', false).unwrap();
    assert_eq!((reloaded.page, reloaded.origin), (a.page, a.origin));
    assert_eq!(cache.atlas.pages(), 2);
    queue.submit([encoder.finish()]);
    let mut encoder = device.create_command_encoder(&Default::default());
    let uploads = cache.atlas.uploads();
    let larger = cache.get(&device, &mut encoder, 48, 'A', false).unwrap();
    assert!(larger.height > a.height);
    assert!(cache.atlas.view(&reloaded).is_ok());
    assert_eq!(
        cache.get(&device, &mut encoder, 32, 'A', false).unwrap(),
        reloaded
    );
    assert_eq!(cache.atlas.uploads(), uploads + 1);
    assert!(cache.metrics(0).is_err());
    assert!(
        cache.metrics(48).unwrap().average_advance > cache.metrics(32).unwrap().average_advance
    );
    queue.submit([encoder.finish()]);
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    assert!(pollster::block_on(validation.pop()).is_none());
}
