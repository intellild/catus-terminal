// Adapted from Alacritty's renderer/text/atlas.rs at d692748d (MIT).
// The shelf allocator and page reuse follow Alacritty; GL uploads are replaced
// with aligned wgpu staging-buffer copies. See ../licenses/ALACRITTY-MIT.txt.

use std::fmt;

pub const ATLAS_SIZE: u32 = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AtlasError {
    Full,
    GlyphTooLarge,
    InvalidBitmap,
    InvalidSize,
    StaleGlyph,
}

impl fmt::Display for AtlasError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Glyph atlas: {self:?}")
    }
}
impl std::error::Error for AtlasError {}

/// Gray is coverage; RGB is normalized to grayscale; RGBA is premultiplied color.
pub enum BitmapBuffer<'a> {
    Gray(&'a [u8]),
    Rgb(&'a [u8]),
    Rgba(&'a [u8]),
}

/// Rasterizer-independent input, corresponding to crossfont::RasterizedGlyph.
pub struct RasterizedGlyph<'a> {
    pub width: u32,
    pub height: u32,
    pub top: i32,
    pub left: i32,
    pub buffer: BitmapBuffer<'a>,
}

/// A handle to an atlas region. Clear invalidates handles via generation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Glyph {
    pub page: usize,
    pub generation: u64,
    pub multicolor: bool,
    pub top: i32,
    pub left: i32,
    pub width: u32,
    pub height: u32,
    pub origin: [u32; 2],
    pub uv: [f32; 4],
}

/// Alacritty's row_extent / row_baseline / row_tallest shelf allocation.
#[derive(Debug)]
pub struct AtlasAllocator {
    size: u32,
    row_extent: u32,
    row_baseline: u32,
    row_tallest: u32,
}

impl AtlasAllocator {
    pub fn new(size: u32) -> Result<Self, AtlasError> {
        if size == 0 {
            return Err(AtlasError::InvalidSize);
        }
        Ok(Self {
            size,
            row_extent: 0,
            row_baseline: 0,
            row_tallest: 0,
        })
    }

    pub fn allocate(&mut self, width: u32, height: u32) -> Result<[u32; 2], AtlasError> {
        if width > self.size || height > self.size {
            return Err(AtlasError::GlyphTooLarge);
        }
        if width == 0 || height == 0 {
            return Ok([0, 0]);
        }
        // Unlike the original strict `<`, allow an exact-height fit.
        if self.row_extent + width > self.size || height > self.size - self.row_baseline {
            let next = self.row_baseline + self.row_tallest;
            if height > self.size - next {
                return Err(AtlasError::Full);
            }
            self.row_baseline = next;
            self.row_extent = 0;
            self.row_tallest = 0;
        }
        let origin = [self.row_extent, self.row_baseline];
        self.row_extent += width;
        self.row_tallest = self.row_tallest.max(height);
        Ok(origin)
    }

    pub fn clear(&mut self) {
        self.row_extent = 0;
        self.row_baseline = 0;
        self.row_tallest = 0;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AtlasKind {
    Mask,
    Color,
}

impl AtlasKind {
    fn format(self) -> wgpu::TextureFormat {
        match self {
            Self::Mask => wgpu::TextureFormat::R8Unorm,
            Self::Color => wgpu::TextureFormat::Rgba8Unorm,
        }
    }
}

struct Atlas {
    kind: AtlasKind,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    allocator: AtlasAllocator,
}

impl Atlas {
    fn new(device: &wgpu::Device, size: u32, kind: AtlasKind) -> Result<Self, AtlasError> {
        let allocator = AtlasAllocator::new(size)?;
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Alacritty glyph atlas (wgpu)"),
            size: wgpu::Extent3d {
                width: size,
                height: size,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: kind.format(),
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        Ok(Self {
            kind,
            texture,
            view,
            allocator,
        })
    }
}

pub struct AtlasSet {
    pages: Vec<Atlas>,
    size: u32,
    current: [Option<usize>; 2],
    generation: u64,
    uploads: u64,
}

impl AtlasSet {
    pub fn new(device: &wgpu::Device, size: u32) -> Result<Self, AtlasError> {
        if size == 0 || size > device.limits().max_texture_dimension_2d {
            return Err(AtlasError::InvalidSize);
        }
        Ok(Self {
            pages: vec![Atlas::new(device, size, AtlasKind::Mask)?],
            size,
            current: [Some(0), None],
            generation: 0,
            uploads: 0,
        })
    }

    /// Records upload into the caller's encoder, before the pass sampling it.
    /// Submit the encoder before using this Glyph with a different submission.
    pub fn insert(
        &mut self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        rasterized: &RasterizedGlyph<'_>,
    ) -> Result<Glyph, AtlasError> {
        if rasterized.width > self.size || rasterized.height > self.size {
            return Err(AtlasError::GlyphTooLarge);
        }
        // Validate before allocating, so malformed input cannot consume space.
        let upload = prepare_upload(rasterized)?;
        let kind = if matches!(rasterized.buffer, BitmapBuffer::Rgba(_)) {
            AtlasKind::Color
        } else {
            AtlasKind::Mask
        };
        let slot = usize::from(kind == AtlasKind::Color);
        let mut page = self.current[slot].unwrap_or_else(|| {
            self.pages
                .iter()
                .position(|p| p.kind == kind)
                .unwrap_or(self.pages.len())
        });
        let origin = loop {
            if page == self.pages.len() {
                self.pages.push(Atlas::new(device, self.size, kind)?);
            }
            match self.pages[page]
                .allocator
                .allocate(rasterized.width, rasterized.height)
            {
                Ok(origin) => break origin,
                Err(AtlasError::Full) => {
                    // Reuse the next page of this format after clear, or grow.
                    page = self
                        .pages
                        .iter()
                        .enumerate()
                        .skip(page + 1)
                        .find(|(_, p)| p.kind == kind)
                        .map(|(i, _)| i)
                        .unwrap_or(self.pages.len());
                }
                Err(error) => return Err(error),
            }
        };
        self.current[slot] = Some(page);
        if !upload.bytes.is_empty() {
            let staging = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Glyph upload staging buffer"),
                size: upload.bytes.len() as u64,
                usage: wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: true,
            });
            staging
                .slice(..)
                .get_mapped_range_mut()
                .expect("New staging buffer covers the aligned upload")
                .copy_from_slice(&upload.bytes);
            staging.unmap();
            encoder.copy_buffer_to_texture(
                wgpu::TexelCopyBufferInfo {
                    buffer: &staging,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(upload.bytes_per_row),
                        rows_per_image: Some(rasterized.height),
                    },
                },
                wgpu::TexelCopyTextureInfo {
                    texture: &self.pages[page].texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: origin[0],
                        y: origin[1],
                        z: 0,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::Extent3d {
                    width: rasterized.width,
                    height: rasterized.height,
                    depth_or_array_layers: 1,
                },
            );
            // Encoded commands retain the buffer until the GPU finishes.
            self.uploads += 1;
        }
        let size = self.size as f32;
        Ok(Glyph {
            page,
            generation: self.generation,
            multicolor: matches!(rasterized.buffer, BitmapBuffer::Rgba(_)),
            top: rasterized.top,
            left: rasterized.left,
            width: rasterized.width,
            height: rasterized.height,
            origin,
            uv: [
                origin[0] as f32 / size,
                origin[1] as f32 / size,
                rasterized.width as f32 / size,
                rasterized.height as f32 / size,
            ],
        })
    }

    pub fn view(&self, glyph: &Glyph) -> Result<&wgpu::TextureView, AtlasError> {
        if glyph.generation != self.generation {
            return Err(AtlasError::StaleGlyph);
        }
        self.pages
            .get(glyph.page)
            .map(|p| &p.view)
            .ok_or(AtlasError::StaleGlyph)
    }

    pub fn page_view(&self, page: usize) -> Result<&wgpu::TextureView, AtlasError> {
        self.pages
            .get(page)
            .map(|p| &p.view)
            .ok_or(AtlasError::StaleGlyph)
    }

    pub fn texture(&self, glyph: &Glyph) -> Result<&wgpu::Texture, AtlasError> {
        if glyph.generation != self.generation {
            return Err(AtlasError::StaleGlyph);
        }
        self.pages
            .get(glyph.page)
            .map(|p| &p.texture)
            .ok_or(AtlasError::StaleGlyph)
    }

    /// Reuse GPU textures; callers must discard their glyph cache and batches.
    pub fn clear(&mut self) {
        for page in &mut self.pages {
            page.allocator.clear();
        }
        self.current = [None, None];
        self.generation = self
            .generation
            .checked_add(1)
            .expect("Atlas generation exhausted");
        self.uploads = 0;
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn pages(&self) -> usize {
        self.pages.len()
    }
    pub fn uploads(&self) -> u64 {
        self.uploads
    }
}

struct Upload {
    bytes: Vec<u8>,
    bytes_per_row: u32,
}

fn prepare_upload(glyph: &RasterizedGlyph<'_>) -> Result<Upload, AtlasError> {
    let (source, channels) = match glyph.buffer {
        BitmapBuffer::Gray(bytes) => (bytes, 1usize),
        BitmapBuffer::Rgb(bytes) => (bytes, 3usize),
        BitmapBuffer::Rgba(bytes) => (bytes, 4usize),
    };
    let pixels = (glyph.width as usize)
        .checked_mul(glyph.height as usize)
        .ok_or(AtlasError::InvalidBitmap)?;
    if source.len()
        != pixels
            .checked_mul(channels)
            .ok_or(AtlasError::InvalidBitmap)?
    {
        return Err(AtlasError::InvalidBitmap);
    }
    if pixels == 0 {
        return Ok(Upload {
            bytes: vec![],
            bytes_per_row: 0,
        });
    }
    let target_channels = if channels == 4 { 4 } else { 1 };
    let row_bytes = glyph
        .width
        .checked_mul(target_channels)
        .ok_or(AtlasError::InvalidBitmap)?;
    let bytes_per_row = row_bytes
        .checked_add(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT - 1)
        .ok_or(AtlasError::InvalidBitmap)?
        / wgpu::COPY_BYTES_PER_ROW_ALIGNMENT
        * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let len = (bytes_per_row as usize)
        .checked_mul(glyph.height as usize)
        .ok_or(AtlasError::InvalidBitmap)?;
    let mut bytes = vec![0; len];
    for y in 0..glyph.height as usize {
        for x in 0..glyph.width as usize {
            let src = (y * glyph.width as usize + x) * channels;
            let dst = y * bytes_per_row as usize + x * target_channels as usize;
            if channels == 4 {
                bytes[dst..dst + 4].copy_from_slice(&source[src..src + 4]);
            } else if channels == 3 {
                bytes[dst] = ((u16::from(source[src])
                    + u16::from(source[src + 1])
                    + u16::from(source[src + 2]))
                    / 3) as u8;
            } else {
                bytes[dst] = source[src];
            }
        }
    }
    Ok(Upload {
        bytes,
        bytes_per_row,
    })
}

#[cfg(test)]
#[path = "../tests/atlas.rs"]
mod tests;
