#[path = "atlas_demo.rs"]
mod atlas_demo;
use atlas_demo::AtlasDemo;
use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_metal::{MTLTexture, MTLTextureType};
use std::time::Duration;

#[cxx::bridge(namespace = "catus")]
mod ffi {
    extern "Rust" {
        type TerminalRenderer;
        fn create_terminal_renderer() -> Result<Box<TerminalRenderer>>;
        fn metal_device(self: &TerminalRenderer) -> usize;
        fn adapter_name(self: &TerminalRenderer) -> &str;
        fn frames(self: &TerminalRenderer) -> u64;
        fn atlas_pages(self: &TerminalRenderer) -> u32;
        fn atlas_uploads(self: &TerminalRenderer) -> u64;
        fn atlas_instances(self: &TerminalRenderer) -> u32;
        fn cached_glyphs(self: &TerminalRenderer) -> u32;
        fn rasterizations(self: &TerminalRenderer) -> u64;
        fn font_pixels(self: &TerminalRenderer) -> f32;
        fn missing_glyphs(self: &TerminalRenderer) -> u64;
        fn clear_atlas(self: &mut TerminalRenderer);
        unsafe fn render_atlas(
            self: &mut TerminalRenderer,
            metal_texture: usize,
            width: u32,
            height: u32,
            pixel_ratio: f32,
        ) -> Result<()>;
        unsafe fn render_triangle(
            self: &mut TerminalRenderer,
            metal_texture: usize,
            width: u32,
            height: u32,
        ) -> Result<()>;
    }
}

pub struct TerminalRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    adapter_name: String,
    frames: u64,
    atlas: AtlasDemo,
}

fn create_terminal_renderer() -> Result<Box<TerminalRenderer>, String> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::METAL,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let adapter =
        pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default()))
            .map_err(|e| e.to_string())?;
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("Catus native terminal"),
        ..Default::default()
    }))
    .map_err(|e| e.to_string())?;
    let validation = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("Terminal triangle WGSL"),
        source: wgpu::ShaderSource::Wgsl(include_str!("triangle.wgsl").into()),
    });
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("Terminal triangle pipeline"),
        layout: None,
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_main"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        primitive: Default::default(),
        depth_stencil: None,
        multisample: Default::default(),
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: wgpu::TextureFormat::Bgra8Unorm,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    });
    let atlas = AtlasDemo::new(&device)?;
    if let Some(error) = pollster::block_on(validation.pop()) {
        return Err(error.to_string());
    }
    Ok(Box::new(TerminalRenderer {
        device,
        queue,
        pipeline,
        adapter_name: adapter.get_info().name,
        frames: 0,
        atlas,
    }))
}

impl TerminalRenderer {
    fn metal_device(&self) -> usize {
        // SAFETY: Metal is the only enabled backend; C++ borrows this pointer
        // only while this renderer (and hence the device) remains alive.
        let hal = unsafe { self.device.as_hal::<wgpu::hal::api::Metal>() }.unwrap();
        Retained::as_ptr(hal.raw_device()) as usize
    }

    fn adapter_name(&self) -> &str {
        &self.adapter_name
    }
    fn frames(&self) -> u64 {
        self.frames
    }

    fn atlas_pages(&self) -> u32 {
        self.atlas.pages()
    }
    fn atlas_uploads(&self) -> u64 {
        self.atlas.uploads()
    }
    fn atlas_instances(&self) -> u32 {
        self.atlas.instances()
    }
    fn cached_glyphs(&self) -> u32 {
        self.atlas.cached_glyphs()
    }
    fn rasterizations(&self) -> u64 {
        self.atlas.rasterizations()
    }
    fn font_pixels(&self) -> f32 {
        self.atlas.font_pixels()
    }
    fn missing_glyphs(&self) -> u64 {
        self.atlas.missing_glyphs()
    }
    fn clear_atlas(&mut self) {
        self.atlas.clear();
    }

    // SAFETY: Both entry points forward the same texture ownership and device
    // contract documented on render().
    unsafe fn render_triangle(
        &mut self,
        texture: usize,
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        unsafe { self.render(texture, width, height, false, 1.) }
    }
    unsafe fn render_atlas(
        &mut self,
        texture: usize,
        width: u32,
        height: u32,
        pixel_ratio: f32,
    ) -> Result<(), String> {
        unsafe { self.render(texture, width, height, true, pixel_ratio) }
    }

    /// # Safety
    /// The pointer must be a live MTLTexture created on metal_device(), backed
    /// by the exclusively acquired Lynx IOSurface, matching width/height/BGRA8.
    /// The caller must not swap or release the surface before this returns.
    unsafe fn render(
        &mut self,
        metal_texture: usize,
        width: u32,
        height: u32,
        draw_atlas: bool,
        pixel_ratio: f32,
    ) -> Result<(), String> {
        if metal_texture == 0
            || width == 0
            || height == 0
            || width > self.device.limits().max_texture_dimension_2d
            || height > self.device.limits().max_texture_dimension_2d
        {
            return Err("Invalid terminal texture or dimensions".into());
        }
        // SAFETY: The caller owns the live texture; retain gives the imported
        // HAL texture its own +1 reference. No ownership of IOSurface transfers.
        let validation = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let raw = unsafe { Retained::retain(metal_texture as *mut ProtocolObject<dyn MTLTexture>) }
            .ok_or("Could not retain Metal texture")?;
        let size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };
        // SAFETY: C++ creates this texture using our exact MTLDevice and BGRA8
        // render-target descriptor. We fully clear it before reading any pixel.
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
            self.device
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
        let view = texture.create_view(&Default::default());
        let mut encoder = self.device.create_command_encoder(&Default::default());
        if draw_atlas {
            if let Err(error) = self.atlas.draw(
                &self.device,
                &self.queue,
                &mut encoder,
                &view,
                [width, height],
                pixel_ratio,
            ) {
                // These uploads are still in an unsubmitted encoder. Do not
                // leave cached handles pointing at regions that were never written.
                self.atlas.clear();
                return Err(error);
            }
        } else {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Native terminal triangle"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.04,
                            g: 0.07,
                            b: 0.12,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            pass.set_pipeline(&self.pipeline);
            pass.draw(0..3, 0..1);
        }
        let submission = self.queue.submit([encoder.finish()]);
        // The POC deliberately waits for GPU completion before Lynx SwapBack.
        // A continuous terminal renderer should use asynchronous GPU fences.
        self.device
            .poll(wgpu::PollType::Wait {
                submission_index: Some(submission),
                timeout: Some(Duration::from_secs(10)),
            })
            .map_err(|e| e.to_string())?;
        if let Some(error) = pollster::block_on(validation.pop()) {
            self.atlas.clear();
            return Err(error.to_string());
        }
        self.frames += 1;
        Ok(())
    }
}
