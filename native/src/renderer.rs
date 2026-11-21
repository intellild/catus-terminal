//! One lazily initialized GPU/atlas context, with UI-thread drawing state per native element.
mod scheduler;
use crate::{
    binding::{VsyncObserver, native_view::Target},
    native_terminal_view::NativeTerminalView,
};
use crate::{
    frame::Viewport,
    terminal_core::grid::GridSnapshot,
    text::{GlyphRenderer, SharedGlyphs},
};
use anyhow::{Context, Result, anyhow};
use once_cell::sync::OnceCell;
use std::sync::{
    Arc, Mutex, MutexGuard,
    atomic::{AtomicBool, AtomicU8},
};

// A failed device/pipeline initialization must not be cached for the process:
// a transient Metal failure on the first frame would otherwise keep the
// terminal blank until the app restarts. Retry on the next renderer request.
static GPU: OnceCell<GpuContext> = OnceCell::new();

/// Coalesces grid/state changes into one VSync-synchronized render.
pub(crate) struct Renderer {
    vsync: VsyncObserver,
    foreground: Arc<AtomicBool>,
    target: Option<Target<NativeTerminalView>>,
    active: AtomicBool,
    /// Tracks pending updates and the single in-flight VSync/UI callback.
    frame_state: AtomicU8,
}

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
    fn measure_cells(&self, viewport: &Viewport) -> Result<crate::frame::CellLayout> {
        let mut shared = self.glyphs()?;
        GlyphRenderer::measure_cells(&mut shared, viewport)
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

/// Mutable instance buffers and the last frame belong to the element's UI thread.
#[derive(Default)]
pub(crate) struct DrawState {
    glyphs: GlyphRenderer,
    rendered_grid: Option<RenderedGrid>,
}

impl DrawState {
    pub(crate) fn invalidate(&mut self) {
        self.rendered_grid = None;
    }
}

/// A single borrow of the element's drawing state while preparing or painting a frame.
pub(crate) struct GridPainter<'a> {
    gpu: &'static GpuContext,
    state: &'a mut DrawState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RenderOutcome {
    Presented,
    Idle,
    Retry,
}

/// A prepared frame owns its snapshot, so presentation never borrows the element's content.
pub(crate) struct PreparedFrame<'a> {
    painter: GridPainter<'a>,
    pub(crate) viewport: Viewport,
    snapshot: GridSnapshot,
    deadline: i64,
}
impl PreparedFrame<'_> {
    pub(crate) fn insertion_point(&self) -> (usize, usize) {
        self.snapshot.insertion_point.unwrap_or_default()
    }
    pub(crate) fn draw(
        &mut self,
        origin: crate::text::TargetOrigin,
        texture: impl FnOnce(&wgpu::Device, &Viewport) -> Result<wgpu::Texture>,
    ) -> Result<bool> {
        let viewport = &self.viewport;
        self.painter.render_grid_with_origin(
            viewport,
            &self.snapshot,
            self.deadline,
            origin,
            |device| texture(device, viewport),
        )
    }
    pub(crate) fn expired(&self) -> bool {
        crate::frame::expired(self.deadline)
    }
}

pub(crate) enum FramePreparation<'a> {
    Ready(PreparedFrame<'a>),
    Idle,
    Deferred,
}

impl Renderer {
    pub(crate) fn prepare_frame<'a>(
        &self,
        drawing: &'a mut DrawState,
        content: &crate::terminal_content::TerminalContent,
        viewport: Viewport,
        deadline: i64,
    ) -> Result<FramePreparation<'a>> {
        if crate::frame::expired(deadline) {
            return Ok(FramePreparation::Deferred);
        }
        let Some(revision) = content.session.try_revision()? else {
            return Ok(FramePreparation::Deferred);
        };
        let painter = self.painter(drawing)?;
        match painter.try_needs_grid(revision, &viewport)? {
            Some(true) => (),
            Some(false) => return Ok(FramePreparation::Idle),
            None => return Ok(FramePreparation::Deferred),
        }
        let Some(snapshot) = content.try_snapshot()? else {
            return Ok(FramePreparation::Deferred);
        };
        Ok(FramePreparation::Ready(PreparedFrame {
            painter,
            viewport,
            snapshot,
            deadline,
        }))
    }

    pub(crate) fn measure_cells(&self, viewport: &Viewport) -> Result<crate::frame::CellLayout> {
        GPU.get_or_try_init(GpuContext::new)?
            .measure_cells(viewport)
    }
    pub(crate) fn painter<'a>(&self, state: &'a mut DrawState) -> Result<GridPainter<'a>> {
        Ok(GridPainter {
            gpu: GPU.get_or_try_init(GpuContext::new)?,
            state,
        })
    }
}

impl GridPainter<'_> {
    pub(crate) fn try_needs_grid(
        &self,
        revision: u64,
        viewport: &Viewport,
    ) -> Result<Option<bool>> {
        match self.gpu.glyphs.try_lock() {
            Ok(shared) => Ok(Some(
                self.state.rendered_grid
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
    pub(crate) fn render_grid_with_origin(
        &mut self,
        viewport: &Viewport,
        grid: &GridSnapshot,
        deadline: i64,
        origin: crate::text::TargetOrigin,
        prepare_target: impl FnOnce(&wgpu::Device) -> Result<wgpu::Texture>,
    ) -> Result<bool> {
        self.state.glyphs.origin = origin;
        if crate::frame::expired(deadline) {
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

    fn render_into_before(
        &mut self,
        target: &wgpu::TextureView,
        viewport: &Viewport,
        grid: &GridSnapshot,
        deadline: Option<i64>,
    ) -> Result<bool> {
        let gpu = self.gpu;
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
        if deadline.is_some_and(crate::frame::expired) {
            return Ok(false);
        }
        let validation = gpu.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let mut encoder = gpu.device.create_command_encoder(&Default::default());
        let mut result = self.state.glyphs.draw_grid(
            &gpu.device,
            &gpu.queue,
            &mut encoder,
            target,
            &mut shared,
            viewport,
            grid,
        );
        let expired_before_submit = deadline.is_some_and(crate::frame::expired);
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
            self.state.rendered_grid = None;
            return Ok(false);
        }
        if deadline.is_some_and(crate::frame::expired) {
            // Submitted GPU work has finished, so the borrowed buffer is safe,
            // but it is too late to present. Leave this session dirty.
            self.state.rendered_grid = None;
            return Ok(false);
        }
        self.state.rendered_grid = Some(RenderedGrid {
            revision: grid.revision,
            viewport: *viewport,
            generation: shared.cache.atlas.generation(),
        });
        Ok(true)
    }
}
