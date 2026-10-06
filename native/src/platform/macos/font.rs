//! Menlo selection and CoreText physical-pixel sizing for macOS.
use crate::text::font::FontSize;
use anyhow::{Context, Result};
use crossfont::{FontDesc, Rasterize, Rasterizer, Size, Slant, Style, Weight};

pub(crate) fn load_font_size(rasterizer: &mut Rasterizer, pixels: u32) -> Result<FontSize> {
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
            .with_context(|| format!("Load Menlo {weight:?} at {pixels}px"))
    };
    let fonts = [load(Weight::Normal)?, load(Weight::Bold)?];
    let metrics = rasterizer
        .metrics(fonts[0], size)
        .context("Read font metrics")?;
    Ok(FontSize {
        fonts,
        size,
        metrics,
    })
}

#[cfg(test)]
#[path = "../../tests/macos/font.rs"]
mod tests;
