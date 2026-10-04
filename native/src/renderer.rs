//! One lazily initialized GPU/atlas context, with independent per-view drawing state.
#[path = "glyph_renderer.rs"]
mod glyph_renderer;
use crate::{
    frame::{FrameBuffer, Viewport},
    terminal_core::grid::{GridSize, GridSnapshot},
};
use glyph_renderer::{GlyphRenderer, SharedGlyphs};
use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_metal::{MTLTexture, MTLTextureType};
use std::{
    sync::{LazyLock, Mutex, MutexGuard},
    time::Duration,
};

static GPU: LazyLock<Result<GpuContext, String>> = LazyLock::new(GpuContext::new);

struct GpuContext {
    device: wgpu::Device,
    queue: wgpu::Queue,
    // Keep atlas mutation, upload submission and GPU completion in one transaction.
    // A second view must never see a glyph whose upload is still unsubmitted.
    glyphs: Mutex<SharedGlyphs>,
}
impl GpuContext {
    fn new() -> Result<Self, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::METAL,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let adapter = pollster::block_on(instance.request_adapter(&Default::default()))
            .map_err(|e| e.to_string())?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("Catus shared terminal GPU"),
            ..Default::default()
        }))
        .map_err(|e| e.to_string())?;
        let validation = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let glyphs = SharedGlyphs::new(&device)?;
        if let Some(error) = pollster::block_on(validation.pop()) {
            return Err(error.to_string());
        }
        Ok(Self {
            device,
            queue,
            glyphs: Mutex::new(glyphs),
        })
    }
    fn glyphs(&self) -> Result<MutexGuard<'_, SharedGlyphs>, String> {
        self.glyphs
            .lock()
            .map_err(|_| "Shared glyph cache lock poisoned".into())
    }
}

#[derive(PartialEq)]
struct RenderedGrid {
    revision: u64,
    viewport: Viewport,
    generation: u64,
}

pub struct TerminalRenderer {
    gpu: &'static GpuContext,
    glyphs: GlyphRenderer,
    rendered_grid: Option<RenderedGrid>,
}

pub(crate) fn create_terminal_renderer() -> Result<Box<TerminalRenderer>, String> {
    let gpu = GPU.as_ref().map_err(Clone::clone)?;
    Ok(Box::new(TerminalRenderer {
        gpu,
        glyphs: GlyphRenderer::default(),
        rendered_grid: None,
    }))
}

impl TerminalRenderer {
    pub(crate) fn metal_device(&self) -> usize {
        // The global context outlives every view and every imported framebuffer.
        let hal = unsafe { self.gpu.device.as_hal::<wgpu::hal::api::Metal>() }.unwrap();
        Retained::as_ptr(hal.raw_device()) as usize
    }
    pub(crate) fn invalidate_grid(&mut self) {
        self.rendered_grid = None;
    }
    pub(crate) fn grid_size(&self, viewport: &Viewport) -> Result<GridSize, String> {
        let mut shared = self.gpu.glyphs()?;
        GlyphRenderer::grid_size(&mut shared, viewport)
    }
    pub(crate) fn needs_grid(&self, revision: u64, viewport: &Viewport) -> Result<bool, String> {
        Ok(self.rendered_grid
            != Some(RenderedGrid {
                revision,
                viewport: *viewport,
                generation: self.gpu.glyphs()?.cache.atlas.generation(),
            }))
    }

    /// # Safety
    /// The framebuffer must be a live BGRA8 MTLTexture from metal_device(), backed
    /// by the exclusively acquired Lynx IOSurface. Keep it alive until this returns.
    pub(crate) unsafe fn render_grid(
        &mut self,
        frame: &FrameBuffer,
        grid: &GridSnapshot,
    ) -> Result<(), String> {
        let Viewport { width, height, .. } = frame.viewport;
        if frame.metal_texture == 0
            || width == 0
            || height == 0
            || width > self.gpu.device.limits().max_texture_dimension_2d
            || height > self.gpu.device.limits().max_texture_dimension_2d
        {
            return Err("Invalid terminal texture or dimensions".into());
        }
        frame.viewport.font_pixels()?;
        // Retain the borrowed framebuffer for the imported HAL texture.
        let raw =
            unsafe { Retained::retain(frame.metal_texture as *mut ProtocolObject<dyn MTLTexture>) }
                .ok_or("Could not retain Metal texture")?;
        let size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };
        // SAFETY: C++ creates this texture using our exact MTLDevice and BGRA8
        // render-target descriptor. Every grid pass clears the framebuffer.
        let hal_texture = unsafe {
            wgpu::hal::metal::Device::texture_from_raw(
                raw,
                wgpu::TextureFormat::Bgra8Unorm,
                MTLTextureType::Type2D,
                1,
                1,
                wgpu::hal::CopyExtent {
                    width,
                    height,
                    depth: 1,
                },
                None,
            )
        };
        let texture = unsafe {
            self.gpu
                .device
                .create_texture_from_hal::<wgpu::hal::api::Metal>(
                    hal_texture,
                    &wgpu::TextureDescriptor {
                        label: Some("Lynx IOSurface terminal back buffer"),
                        size,
                        mip_level_count: 1,
                        sample_count: 1,
                        dimension: wgpu::TextureDimension::D2,
                        format: wgpu::TextureFormat::Bgra8Unorm,
                        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                        view_formats: &[],
                    },
                    wgpu::TextureUses::UNINITIALIZED,
                )
        };
        self.render_into(
            &texture.create_view(&Default::default()),
            &frame.viewport,
            grid,
        )
    }

    fn render_into(
        &mut self,
        target: &wgpu::TextureView,
        viewport: &Viewport,
        grid: &GridSnapshot,
    ) -> Result<(), String> {
        let gpu = self.gpu;
        let mut shared = gpu.glyphs()?;
        let validation = gpu.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let mut encoder = gpu.device.create_command_encoder(&Default::default());
        let mut result = self.glyphs.draw_grid(
            &gpu.device,
            &gpu.queue,
            &mut encoder,
            target,
            &mut shared,
            viewport,
            grid,
        );
        if result.is_ok() {
            let submission = gpu.queue.submit([encoder.finish()]);
            // Lynx may swap the borrowed double buffer only after GPU writes finish.
            result = gpu
                .device
                .poll(wgpu::PollType::Wait {
                    submission_index: Some(submission),
                    timeout: Some(Duration::from_secs(10)),
                })
                .map(|_| ())
                .map_err(|e| e.to_string());
        }
        if let Some(error) = pollster::block_on(validation.pop()) {
            result = Err(error.to_string());
        }
        if let Err(error) = result {
            // Invalidate all views after dropping uploads that may not have completed.
            shared.clear();
            return Err(error);
        }
        self.rendered_grid = Some(RenderedGrid {
            revision: grid.revision,
            viewport: *viewport,
            generation: shared.cache.atlas.generation(),
        });
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/renderer.rs"]
mod tests;
