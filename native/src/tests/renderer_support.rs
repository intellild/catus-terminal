use super::*;

// All tests that deliberately invalidate the shared atlas must hold this lock.
pub(crate) static TEST_LOCK: Mutex<()> = Mutex::new(());

pub(crate) struct Target {
    texture: wgpu::Texture,
    gpu: &'static GpuContext,
    viewport: Viewport,
}

impl Target {
    pub(crate) fn new(renderer: &TerminalRenderer, viewport: Viewport) -> Self {
        let gpu = renderer.gpu;
        let texture = gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Session framebuffer test"),
            size: wgpu::Extent3d {
                width: viewport.width,
                height: viewport.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Bgra8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        // Initialize wgpu's original handle before importing the same Metal texture
        // as an external framebuffer, so readback does not clear external writes.
        let view = texture.create_view(&Default::default());
        let mut encoder = gpu.device.create_command_encoder(&Default::default());
        {
            let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
        }
        gpu.queue.submit([encoder.finish()]);
        Self {
            texture,
            gpu,
            viewport,
        }
    }

    pub(crate) fn frame(&self) -> FrameBuffer {
        let hal = unsafe { self.texture.as_hal::<wgpu::hal::api::Metal>() }.unwrap();
        FrameBuffer {
            metal_texture: hal.raw_handle() as *const _ as usize,
        }
    }

    pub(crate) fn pixels(&self) -> Vec<u8> {
        let Viewport { width, height, .. } = self.viewport;
        let stride = (width * 4).div_ceil(256) * 256;
        let buffer = self.gpu.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (stride * height) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(stride),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        self.gpu.queue.submit([encoder.finish()]);
        let (tx, rx) = std::sync::mpsc::channel();
        buffer
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                tx.send(result).unwrap();
            });
        self.gpu
            .device
            .poll(wgpu::PollType::wait_indefinitely())
            .unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
        let pixels = buffer
            .slice(..)
            .get_mapped_range()
            .unwrap()
            .chunks_exact(stride as usize)
            .flat_map(|row| row[..width as usize * 4].iter().copied())
            .collect();
        buffer.unmap();
        pixels
    }
}
