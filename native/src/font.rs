//! CoreText/crossfont rasterization and atlas handles keyed by font, size and character.
use std::collections::HashMap;

use crossfont::{
    FontDesc, FontKey, GlyphKey, Metrics, Rasterize, Rasterizer, Size, Slant, Style, Weight,
};

use crate::atlas::{ATLAS_SIZE, AtlasSet, BitmapBuffer, Glyph, RasterizedGlyph};

pub struct GlyphCache {
    pub atlas: AtlasSet,
    rasterizer: Rasterizer,
    fonts: [FontKey; 2],
    size: Size,
    metrics: Metrics,
    glyphs: HashMap<GlyphKey, Glyph>,
    rasterizations: u64,
    missing: u64,
}

impl GlyphCache {
    pub fn new(device: &wgpu::Device, pixels: u32) -> Result<Self, String> {
        let (rasterizer, fonts, size, metrics) = load_fonts(pixels)?;
        Ok(Self {
            atlas: AtlasSet::new(device, ATLAS_SIZE).map_err(|e| e.to_string())?,
            rasterizer,
            fonts,
            size,
            metrics,
            glyphs: HashMap::new(),
            rasterizations: 0,
            missing: 0,
        })
    }

    /// Recreate the rasterizer on size/DPI changes so old font keys do not accumulate.
    pub fn set_size(&mut self, pixels: u32) -> Result<(), String> {
        if self.size == Size::new(pixels as f32) {
            return Ok(());
        }
        let (rasterizer, fonts, size, metrics) = load_fonts(pixels)?;
        self.clear();
        self.rasterizer = rasterizer;
        self.fonts = fonts;
        self.size = size;
        self.metrics = metrics;
        Ok(())
    }

    pub fn clear(&mut self) {
        self.glyphs.clear();
        self.atlas.clear();
        self.rasterizations = 0;
        self.missing = 0;
    }

    pub fn metrics(&self) -> Metrics {
        self.metrics
    }
    pub fn pixels(&self) -> f32 {
        self.size.as_pt()
    }
    pub fn len(&self) -> usize {
        self.glyphs.len()
    }
    pub fn is_empty(&self) -> bool {
        self.glyphs.is_empty()
    }
    pub fn rasterizations(&self) -> u64 {
        self.rasterizations
    }
    pub fn missing(&self) -> u64 {
        self.missing
    }

    pub fn get(
        &mut self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        character: char,
        bold: bool,
    ) -> Result<Glyph, String> {
        let key = GlyphKey {
            character,
            font_key: self.fonts[usize::from(bold)],
            size: self.size,
        };
        if let Some(glyph) = self.glyphs.get(&key) {
            // Also handles a caller clearing the public atlas directly.
            if self.atlas.view(glyph).is_ok() {
                return Ok(*glyph);
            }
        }
        let bitmap = match self.rasterizer.get_glyph(key) {
            Ok(bitmap) => bitmap,
            Err(crossfont::Error::MissingGlyph(bitmap)) => {
                self.missing += 1;
                bitmap
            }
            Err(error) => return Err(error.to_string()),
        };
        self.rasterizations += 1;
        let gray;
        let buffer = match &bitmap.buffer {
            crossfont::BitmapBuffer::Rgb(bytes) => {
                // Keep the existing renderer's averaged RGB coverage policy.
                // Rasterization itself uses crossfont's platform defaults.
                gray = bytes
                    .chunks_exact(3)
                    .map(|p| ((u16::from(p[0]) + u16::from(p[1]) + u16::from(p[2])) / 3) as u8)
                    .collect::<Vec<_>>();
                BitmapBuffer::Gray(&gray)
            }
            crossfont::BitmapBuffer::Rgba(bytes) => BitmapBuffer::Rgba(bytes),
        };
        let glyph = self
            .atlas
            .insert(
                device,
                encoder,
                &RasterizedGlyph {
                    width: bitmap
                        .width
                        .try_into()
                        .map_err(|_| "Negative glyph width")?,
                    height: bitmap
                        .height
                        .try_into()
                        .map_err(|_| "Negative glyph height")?,
                    top: bitmap.top,
                    left: bitmap.left,
                    buffer,
                },
            )
            .map_err(|e| e.to_string())?;
        self.glyphs.insert(key, glyph);
        Ok(glyph)
    }
}

fn load_fonts(pixels: u32) -> Result<(Rasterizer, [FontKey; 2], Size, Metrics), String> {
    if !(1..=512).contains(&pixels) {
        return Err("Font pixel size must be in 1..=512".into());
    }
    let mut rasterizer = Rasterizer::new().map_err(|e| e.to_string())?;
    // CoreText backend uses Size::as_pt() directly as bitmap pixel size. The
    // caller has already applied the Lynx view's backing scale; do not apply
    // the FreeType 96/72 conversion here.
    let size = Size::new(pixels as f32);
    let mut load = |weight| {
        rasterizer
            .load_font(
                &FontDesc::new(
                    "Menlo",
                    Style::Description {
                        slant: Slant::Normal,
                        weight,
                    },
                ),
                size,
            )
            .map_err(|e| e.to_string())
    };
    let fonts = [load(Weight::Normal)?, load(Weight::Bold)?];
    let metrics = rasterizer
        .metrics(fonts[0], size)
        .map_err(|e| e.to_string())?;
    Ok((rasterizer, fonts, size, metrics))
}

#[cfg(test)]
#[path = "tests/font.rs"]
mod tests;
