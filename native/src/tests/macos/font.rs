use super::*;
use crossfont::{GlyphKey, Rasterize};

#[test]
fn coretext_fallback_color_and_real_font_metrics() {
    let mut rasterizer = Rasterizer::new().unwrap();
    let FontSize {
        fonts,
        size,
        metrics,
    } = load_font_size(&mut rasterizer, 38).unwrap();
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
