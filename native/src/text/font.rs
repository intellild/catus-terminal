//! Crossfont rasterization and atlas handles keyed by font, size and character.
use anyhow::{Context, Result, ensure};
use std::collections::HashMap;

use crossfont::{FontKey, GlyphKey, Metrics, Rasterize, Rasterizer, Size};

use super::atlas::{ATLAS_SIZE, AtlasSet, BitmapBuffer, Glyph, RasterizedGlyph};

pub struct GlyphCache {
    pub atlas: AtlasSet,
    rasterizer: Rasterizer,
    sizes: HashMap<u32, FontSize>,
    glyphs: HashMap<GlyphKey, Glyph>,
    rasterizations: u64,
    missing: u64,
}

impl GlyphCache {
    pub fn new(device: &wgpu::Device) -> Result<Self> {
        Ok(Self {
            atlas: AtlasSet::new(device, ATLAS_SIZE)?,
            rasterizer: Rasterizer::new().context("Create font rasterizer")?,
            sizes: HashMap::new(),
            glyphs: HashMap::new(),
            rasterizations: 0,
            missing: 0,
        })
    }

    fn font_size(&mut self, pixels: u32) -> Result<&FontSize> {
        ensure!(
            (1..=512).contains(&pixels),
            "Font pixel size must be in 1..=512"
        );
        if let std::collections::hash_map::Entry::Vacant(entry) = self.sizes.entry(pixels) {
            entry.insert(crate::platform::load_font_size(
                &mut self.rasterizer,
                pixels,
            )?);
        }
        Ok(&self.sizes[&pixels])
    }

    pub fn clear(&mut self) {
        self.glyphs.clear();
        self.atlas.clear();
        self.rasterizations = 0;
        self.missing = 0;
    }

    pub fn metrics(&mut self, pixels: u32) -> Result<Metrics> {
        Ok(self.font_size(pixels)?.metrics)
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
        pixels: u32,
        character: char,
        bold: bool,
    ) -> Result<Glyph> {
        let font = self.font_size(pixels)?;
        let key = GlyphKey {
            character,
            font_key: font.fonts[usize::from(bold)],
            size: font.size,
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
            Err(error) => {
                return Err(anyhow::Error::new(error)
                    .context(format!("Rasterize glyph {character:?} at {pixels}px")));
            }
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
        let glyph = self.atlas.insert(
            device,
            encoder,
            &RasterizedGlyph {
                width: bitmap.width.try_into().context("Negative glyph width")?,
                height: bitmap.height.try_into().context("Negative glyph height")?,
                top: bitmap.top,
                left: bitmap.left,
                buffer,
            },
        )?;
        self.glyphs.insert(key, glyph);
        Ok(glyph)
    }
}

pub(crate) struct FontSize {
    pub(crate) fonts: [FontKey; 2],
    pub(crate) size: Size,
    pub(crate) metrics: Metrics,
}

#[cfg(test)]
#[path = "../tests/font.rs"]
mod tests;
