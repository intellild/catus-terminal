//! One lazily initialized GPU/atlas context, with independent per-session drawing state.
use crate::{
    frame::{FrameBuffer, Viewport},
    terminal_core::grid::{GridSize, GridSnapshot},
    text::{GlyphRenderer, SharedGlyphs},
};
#[cfg(test)]
use objc2::rc::Retained;
use objc2_core_foundation::CFRetained;
use objc2_io_surface::IOSurfaceRef;
use objc2_metal::{
    MTLDevice, MTLPixelFormat, MTLStorageMode, MTLTextureDescriptor, MTLTextureType,
    MTLTextureUsage,
};
use std::{
    ptr::NonNull,
    sync::{LazyLock, Mutex, MutexGuard},
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
    #[cfg(test)]
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
    #[cfg(test)]
    pub(crate) fn needs_grid(&self, revision: u64, viewport: &Viewport) -> Result<bool, String> {
        Ok(self.rendered_grid
            != Some(RenderedGrid {
                revision,
                viewport: *viewport,
                generation: self.gpu.glyphs()?.cache.atlas.generation(),
            }))
    }

    pub(crate) fn try_needs_grid(
        &self,
        revision: u64,
        viewport: &Viewport,
    ) -> Result<Option<bool>, String> {
        match self.gpu.glyphs.try_lock() {
            Ok(shared) => Ok(Some(
                self.rendered_grid
                    != Some(RenderedGrid {
                        revision,
                        viewport: *viewport,
                        generation: shared.cache.atlas.generation(),
                    }),
            )),
            Err(std::sync::TryLockError::WouldBlock) => Ok(None),
            Err(std::sync::TryLockError::Poisoned(_)) => {
                Err("Shared glyph cache lock poisoned".into())
            }
        }
    }

    /// # Safety
    /// The framebuffer must contain a live, exclusively borrowed IOSurfaceRef
    /// which remains valid until this synchronous call completes.
    pub(crate) unsafe fn render_grid(
        &mut self,
        frame: &FrameBuffer,
        viewport: &Viewport,
        grid: &GridSnapshot,
        deadline: i64,
    ) -> Result<bool, String> {
        if crate::frame_callbacks::expired(deadline) {
            return Ok(false);
        }
        let Viewport { width, height, .. } = *viewport;
        if width == 0
            || height == 0
            || width > self.gpu.device.limits().max_texture_dimension_2d
            || height > self.gpu.device.limits().max_texture_dimension_2d
        {
            return Err("Invalid terminal texture dimensions".into());
        }
        viewport.font_pixels()?;
        let ptr = NonNull::new(frame.iosurface as *mut IOSurfaceRef)
            .ok_or("Lynx back buffer is unavailable")?;
        // Retain only our own reference; never consume Lynx's borrowed ownership.
        let surface = unsafe { CFRetained::retain(ptr) };
        if surface.width() != width as usize
            || surface.height() != height as usize
            || surface.bytes_per_element() != 4
        {
            return Err("Unexpected Lynx IOSurface dimensions or pixel layout".into());
        }
        let raw = objc2::rc::autoreleasepool(|_| {
            let device = unsafe { self.gpu.device.as_hal::<wgpu::hal::api::Metal>() }
                .ok_or("Shared GPU is not a Metal device")?;
            // Dimensions and format were validated before constructing the descriptor.
            let descriptor = unsafe {
                MTLTextureDescriptor::texture2DDescriptorWithPixelFormat_width_height_mipmapped(
                    MTLPixelFormat::BGRA8Unorm,
                    width as usize,
                    height as usize,
                    false,
                )
            };
            descriptor.setUsage(MTLTextureUsage::RenderTarget);
            descriptor.setStorageMode(MTLStorageMode::Shared);
            device
                .raw_device()
                .newTextureWithDescriptor_iosurface_plane(&descriptor, &surface, 0)
                .ok_or_else(|| String::from("Metal could not import the Lynx IOSurface"))
        })?;
        let size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };
        // SAFETY: The imported texture was created above using this wgpu device
        // and a BGRA8 render-target descriptor. Every grid pass clears it.
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
        self.render_into_before(
            &texture.create_view(&Default::default()),
            viewport,
            grid,
            Some(deadline),
        )
    }

    #[cfg(test)]
    fn render_into(
        &mut self,
        target: &wgpu::TextureView,
        viewport: &Viewport,
        grid: &GridSnapshot,
    ) -> Result<(), String> {
        self.render_into_before(target, viewport, grid, None)
            .map(|_| ())
    }

    fn render_into_before(
        &mut self,
        target: &wgpu::TextureView,
        viewport: &Viewport,
        grid: &GridSnapshot,
        deadline: Option<i64>,
    ) -> Result<bool, String> {
        let gpu = self.gpu;
        let mut shared = if deadline.is_some() {
            match gpu.glyphs.try_lock() {
                Ok(shared) => shared,
                Err(std::sync::TryLockError::WouldBlock) => return Ok(false),
                Err(std::sync::TryLockError::Poisoned(_)) => {
                    return Err("Shared glyph cache lock poisoned".into());
                }
            }
        } else {
            gpu.glyphs()?
        };
        if deadline.is_some_and(crate::frame_callbacks::expired) {
            return Ok(false);
        }
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
        let expired_before_submit = deadline.is_some_and(crate::frame_callbacks::expired);
        if result.is_ok() && !expired_before_submit {
            let submission = gpu.queue.submit([encoder.finish()]);
            // Lynx may swap the borrowed double buffer only after GPU writes finish.
            result = gpu
                .device
                .poll(wgpu::PollType::Wait {
                    submission_index: Some(submission),
                    // A frame deadline cannot cancel submitted GPU writes to a borrowed buffer.
                    timeout: None,
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
        if expired_before_submit {
            // draw_grid can create glyph handles whose uploads are in the
            // discarded encoder. Invalidate them rather than exposing stale data.
            shared.clear();
            self.rendered_grid = None;
            return Ok(false);
        }
        if deadline.is_some_and(crate::frame_callbacks::expired) {
            // Submitted GPU work has finished, so the borrowed buffer is safe,
            // but it is too late to present. Leave this session dirty.
            self.rendered_grid = None;
            return Ok(false);
        }
        self.rendered_grid = Some(RenderedGrid {
            revision: grid.revision,
            viewport: *viewport,
            generation: shared.cache.atlas.generation(),
        });
        Ok(true)
    }
}

#[cfg(test)]
#[path = "tests/renderer_support.rs"]
pub(crate) mod test_support;

#[cfg(test)]
use std::time::Duration;

#[cfg(test)]
#[path = "tests/renderer.rs"]
mod tests;
