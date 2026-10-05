//! Font rasterization, glyph caching, atlas uploads and instanced text drawing.

pub mod atlas;
#[cfg(target_os = "macos")]
pub mod font;
#[cfg(target_os = "macos")]
mod glyph_renderer;

#[cfg(target_os = "macos")]
pub(crate) use glyph_renderer::{GlyphRenderer, SharedGlyphs};
