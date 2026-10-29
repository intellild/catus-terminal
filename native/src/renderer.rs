//! One lazily initialized GPU/atlas context, with independent per-session drawing state.
use crate::{
    frame::Viewport,
    terminal_core::grid::{GridSize, GridSnapshot},
    text::{GlyphRenderer, SharedGlyphs},
};
use anyhow::{Context, Result, anyhow};
use std::sync::{Arc, Mutex, MutexGuard};

// A failed device/pipeline initialization must not be cached for the process:
// a transient Metal failure on the first frame would otherwise keep the
// terminal blank until the app restarts. Retry on the next renderer request.
static GPU: Mutex<Option<Arc<GpuContext>>> = Mutex::new(None);

struct GpuContext {
    device: wgpu::Device,
    queue: wgpu::Queue,
    // Keep atlas mutation, upload submission and GPU completion in one transaction.
    // A second view must never see a glyph whose upload is still unsubmitted.
    glyphs: Mutex<SharedGlyphs>,
}
impl GpuContext {
    fn new() -> Result<Self> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: crate::platform::GPU_BACKENDS,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let adapter = pollster::block_on(instance.request_adapter(&Default::default()))
            .context("Request terminal GPU adapter")?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("Catus shared terminal GPU"),
            ..Default::default()
        }))
        .context("Create shared terminal GPU device")?;
        let validation = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let glyphs = SharedGlyphs::new(&device)?;
        if let Some(error) = pollster::block_on(validation.pop()) {
            return Err(error.into());
        }
        Ok(Self {
            device,
            queue,
            glyphs: Mutex::new(glyphs),
        })
    }
    fn glyphs(&self) -> Result<MutexGuard<'_, SharedGlyphs>> {
        self.glyphs
            .lock()
            .map_err(|_| anyhow!("Shared glyph cache lock poisoned"))
    }
}

#[derive(PartialEq)]
struct RenderedGrid {
    revision: u64,
    viewport: Viewport,
    generation: u64,
}

pub struct TerminalRenderer {
    gpu: Arc<GpuContext>,
    glyphs: GlyphRenderer,
    rendered_grid: Option<RenderedGrid>,
}

fn shared_gpu() -> Result<Arc<GpuContext>> {
    let mut gpu = GPU.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(existing) = gpu.as_ref() {
        return Ok(existing.clone());
    }
    // Hold the lock while initializing so concurrent requests share one device.
    let created = Arc::new(GpuContext::new()?);
    *gpu = Some(created.clone());
    Ok(created)
}

pub(crate) fn create_terminal_renderer() -> Result<Box<TerminalRenderer>> {
    let gpu = shared_gpu()?;
    Ok(Box::new(TerminalRenderer {
        gpu,
        glyphs: GlyphRenderer::default(),
        rendered_grid: None,
    }))
}

impl TerminalRenderer {
    pub(crate) fn invalidate_grid(&mut self) {
        self.rendered_grid = None;
    }
    pub(crate) fn cell_size(&self, viewport: &Viewport) -> Result<(f32, f32)> {
        let mut shared = self
            .gpu
            .glyphs
            .try_lock()
            .map_err(|_| anyhow!("Glyph cache busy"))?;
        let metrics = shared.cache.metrics(viewport.font_pixels()?)?;
        Ok((
            metrics.average_advance.round().max(1.) as f32,
            metrics.line_height.round().max(1.) as f32,
        ))
    }
    pub(crate) fn grid_size(&self, viewport: &Viewport) -> Result<GridSize> {
        let mut shared = self.gpu.glyphs()?;
        GlyphRenderer::grid_size(&mut shared, viewport)
    }
    #[cfg(test)]
    pub(crate) fn needs_grid(&self, revision: u64, viewport: &Viewport) -> Result<bool> {
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
    ) -> Result<Option<bool>> {
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
                Err(anyhow!("Shared glyph cache lock poisoned"))
            }
        }
    }

    // The platform adapter supplies the texture only after idle/busy checks.
    // Submitted GPU work completes before returning a borrowed native target.
    pub(crate) fn render_grid(
        &mut self,
        viewport: &Viewport,
        grid: &GridSnapshot,
        deadline: i64,
        prepare_target: impl FnOnce(&wgpu::Device) -> Result<wgpu::Texture>,
    ) -> Result<bool> {
        self.render_grid_with_origin(
            viewport,
            grid,
            deadline,
            crate::text::TargetOrigin::TopLeft,
            prepare_target,
        )
    }

    pub(crate) fn render_grid_with_origin(
        &mut self,
        viewport: &Viewport,
        grid: &GridSnapshot,
        deadline: i64,
        origin: crate::text::TargetOrigin,
        prepare_target: impl FnOnce(&wgpu::Device) -> Result<wgpu::Texture>,
    ) -> Result<bool> {
        self.glyphs.origin = origin;
        if crate::frame_source::expired(deadline) {
            return Ok(false);
        }
        let Viewport { width, height, .. } = *viewport;
        if width == 0
            || height == 0
            || width > self.gpu.device.limits().max_texture_dimension_2d
            || height > self.gpu.device.limits().max_texture_dimension_2d
        {
            return Err(anyhow!("Invalid terminal texture dimensions"));
        }
        viewport.font_pixels()?;
        let texture = prepare_target(&self.gpu.device)?;
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
    ) -> Result<()> {
        self.render_into_before(target, viewport, grid, None)
            .map(|_| ())
    }

    fn render_into_before(
        &mut self,
        target: &wgpu::TextureView,
        viewport: &Viewport,
        grid: &GridSnapshot,
        deadline: Option<i64>,
    ) -> Result<bool> {
        let gpu = &self.gpu;
        let mut shared = if deadline.is_some() {
            match gpu.glyphs.try_lock() {
                Ok(shared) => shared,
                Err(std::sync::TryLockError::WouldBlock) => return Ok(false),
                Err(std::sync::TryLockError::Poisoned(_)) => {
                    return Err(anyhow!("Shared glyph cache lock poisoned"));
                }
            }
        } else {
            gpu.glyphs()?
        };
        if deadline.is_some_and(crate::frame_source::expired) {
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
        let expired_before_submit = deadline.is_some_and(crate::frame_source::expired);
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
                .context("Wait for terminal GPU submission");
        }
        if let Some(error) = pollster::block_on(validation.pop()) {
            result = Err(error.into());
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
        if deadline.is_some_and(crate::frame_source::expired) {
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
