//! Real crossfont glyphs exercise mask/color atlases and instanced rendering.
use crate::{atlas::Glyph, font::GlyphCache};
use unicode_width::UnicodeWidthChar;

pub struct AtlasDemo {
    cache: GlyphCache,
    bindings: Vec<wgpu::BindGroup>,
    pipeline: wgpu::RenderPipeline,
    sampler: wgpu::Sampler,
    instances: Option<wgpu::Buffer>,
    instance_capacity: usize,
    rendered_instances: u32,
}

impl AtlasDemo {
    pub fn new(device: &wgpu::Device) -> Result<Self, String> {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Glyph atlas sampling WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("atlas.wgsl").into()),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Instanced glyph atlas pipeline"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &shader, entry_point: Some("vs_main"), compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: 64, step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4, 2 => Float32x4, 3 => Float32x4],
                })],
            },
            primitive: Default::default(), depth_stencil: None, multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader, entry_point: Some("fs_main"), compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Bgra8Unorm,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None, cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Glyph atlas sampler"),
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });
        Ok(Self {
            cache: GlyphCache::new(device, 22)?,
            bindings: vec![],
            pipeline,
            sampler,
            instances: None,
            instance_capacity: 0,
            rendered_instances: 0,
        })
    }

    pub fn clear(&mut self) {
        self.cache.clear();
        self.rendered_instances = 0;
    }
    pub fn pages(&self) -> u32 {
        self.cache.atlas.pages() as u32
    }
    pub fn uploads(&self) -> u64 {
        self.cache.atlas.uploads()
    }
    pub fn instances(&self) -> u32 {
        self.rendered_instances
    }

    pub fn cached_glyphs(&self) -> u32 {
        self.cache.len() as u32
    }
    pub fn rasterizations(&self) -> u64 {
        self.cache.rasterizations()
    }
    pub fn font_pixels(&self) -> f32 {
        self.cache.pixels()
    }
    pub fn missing_glyphs(&self) -> u64 {
        self.cache.missing()
    }

    pub fn draw(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        dimensions: [u32; 2],
        pixel_ratio: f32,
    ) -> Result<(), String> {
        let [width, height] = dimensions;
        if !pixel_ratio.is_finite() || pixel_ratio <= 0. {
            return Err("Invalid backing scale".into());
        }
        self.cache
            .set_size((22. * pixel_ratio).round().clamp(1., 512.) as u32)?;
        let mut items: Vec<(Glyph, [f32; 16])> = vec![];
        let metrics = self.cache.metrics();
        let cell_width = metrics.average_advance.round() as f32;
        let line_height = metrics.line_height.round() as f32;
        for (row, (text, color, bold)) in [
            ("Crossfont + wgpu", [0.3, 0.95, 0.7, 1.0], false),
            ("Atlas 中文 😀", [0.4, 0.65, 1.0, 1.0], true),
        ]
        .into_iter()
        .enumerate()
        {
            let columns: usize = text.chars().map(|ch| ch.width().unwrap_or(0)).sum();
            let mut x = ((width as f32 - columns as f32 * cell_width) / 2.).round();
            // Bounds top is measured above the baseline, including fallback fonts.
            let baseline = (height as f32 * if row == 0 { 0.3 } else { 0.7 }
                + (line_height + metrics.descent) / 2.)
                .round();
            for ch in text.chars() {
                let glyph = self.cache.get(device, encoder, ch, bold)?;
                if glyph.width > 0 && glyph.height > 0 {
                    items.push((
                        glyph,
                        instance(
                            glyph,
                            [
                                x + glyph.left as f32,
                                baseline - glyph.top as f32,
                                glyph.width as f32,
                                glyph.height as f32,
                            ],
                            color,
                            width,
                            height,
                        ),
                    ));
                }
                x += ch.width().unwrap_or(0) as f32 * cell_width;
            }
        }
        let bytes: Vec<u8> = items
            .iter()
            .flat_map(|(_, data)| data.iter().flat_map(|n| n.to_ne_bytes()))
            .collect();
        if self.instance_capacity < bytes.len() {
            self.instance_capacity = bytes.len().next_power_of_two();
            self.instances = Some(device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Glyph instance buffer"),
                size: self.instance_capacity as u64,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
        }
        let buffer = self.instances.as_ref().unwrap();
        queue.write_buffer(buffer, 0, &bytes);
        // Flush on atlas-page changes, following Alacritty's rendering order.
        let mut batches = vec![];
        let mut start = 0;
        while start < items.len() {
            let mut end = start + 1;
            while end < items.len() && items[end].0.page == items[start].0.page {
                end += 1;
            }
            // Page bindings survive clear and font-size changes because GPU
            // textures are reused. Create a binding only when a new page appears.
            while self.bindings.len() < self.cache.atlas.pages() {
                let page = self.bindings.len();
                let view = self
                    .cache
                    .atlas
                    .page_view(page)
                    .map_err(|e| e.to_string())?;
                let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("Glyph atlas page binding"),
                    layout: &self.pipeline.get_bind_group_layout(0),
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(&self.sampler),
                        },
                    ],
                });
                self.bindings.push(group);
            }
            batches.push((start as u32..end as u32, items[start].0.page));
            start = end;
        }
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Native terminal glyph atlas demo"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
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
        pass.set_vertex_buffer(0, buffer.slice(..bytes.len() as u64));
        for (range, page) in &batches {
            pass.set_bind_group(0, &self.bindings[*page], &[]);
            pass.draw(0..6, range.clone());
        }
        self.rendered_instances = items.len() as u32;
        Ok(())
    }
}

fn instance(glyph: Glyph, rect: [f32; 4], color: [f32; 4], width: u32, height: u32) -> [f32; 16] {
    [
        rect[0],
        rect[1],
        rect[2],
        rect[3],
        glyph.uv[0],
        glyph.uv[1],
        glyph.uv[2],
        glyph.uv[3],
        color[0],
        color[1],
        color[2],
        color[3],
        u8::from(glyph.multicolor) as f32,
        width as f32,
        height as f32,
        0.0,
    ]
}
