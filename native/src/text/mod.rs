//! Font rasterization, glyph caching, atlas uploads and instanced text drawing.

pub mod atlas;
pub mod font;
mod glyph_renderer;

pub(crate) use glyph_renderer::{GlyphRenderer, SharedGlyphs};
