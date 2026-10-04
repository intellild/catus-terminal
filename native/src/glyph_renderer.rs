//! Shared glyph resources and per-view instance buffers.
use crate::frame::Viewport;
use crate::{atlas::Glyph, font::GlyphCache};

pub struct SharedGlyphs {
    pub cache: GlyphCache,
    bindings: Vec<wgpu::BindGroup>,
    pipeline: wgpu::RenderPipeline,
    sampler: wgpu::Sampler,
}

#[derive(Default)]
pub struct GlyphRenderer {
    instances: Option<wgpu::Buffer>,
    instance_capacity: usize,
}

impl SharedGlyphs {
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
            cache: GlyphCache::new(device)?,
            bindings: vec![],
            pipeline,
            sampler,
        })
    }

    pub fn clear(&mut self) {
        self.cache.clear();
    }
}

impl GlyphRenderer {
    pub fn grid_size(
        shared: &mut SharedGlyphs,
        viewport: &Viewport,
    ) -> Result<crate::terminal_core::grid::GridSize, String> {
        let metrics = shared.cache.metrics(viewport.font_pixels()?)?;
        let padding = 8. * viewport.pixel_ratio;
        Ok(crate::terminal_core::grid::GridSize::new(
            ((viewport.width as f32 - 2. * padding).max(0.)
                / metrics.average_advance.round().max(1.) as f32) as usize,
            ((viewport.height as f32 - 2. * padding).max(0.)
                / metrics.line_height.round().max(1.) as f32) as usize,
        ))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn draw_grid(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        shared: &mut SharedGlyphs,
        viewport: &Viewport,
        grid: &crate::terminal_core::grid::GridSnapshot,
    ) -> Result<(), String> {
        let pixels = viewport.font_pixels()?;
        let metrics = shared.cache.metrics(pixels)?;
        let ratio = viewport.pixel_ratio;
        let cw = metrics.average_advance.round().max(1.) as f32;
        let ch = metrics.line_height.round().max(1.) as f32;
        let pad = (8. * ratio).round();
        let (width, height) = (viewport.width, viewport.height);
        // A real mask page supplies the binding for solid instances as well.
        let mask = shared.cache.get(device, encoder, pixels, 'M', false)?;
        let rgba = |rgb: [u8; 3]| {
            [
                rgb[0] as f32 / 255.,
                rgb[1] as f32 / 255.,
                rgb[2] as f32 / 255.,
                1.,
            ]
        };
        let solid = |rect, color| {
            let mut data = instance(mask, rect, rgba(color), width, height);
            data[12] = 2.;
            (mask, data)
        };
        let mut items = vec![];
        for cell in &grid.cells {
            if cell.background != grid.background {
                items.push(solid(
                    [
                        pad + cell.column as f32 * cw,
                        pad + cell.row as f32 * ch,
                        cw,
                        ch,
                    ],
                    cell.background,
                ));
            }
        }
        if let Some(cursor) = &grid.cursor {
            use alacritty_terminal::vte::ansi::CursorShape;
            let (w, h, dy) = match cursor.shape {
                CursorShape::Underline => (
                    cw * if cursor.wide { 2. } else { 1. },
                    ratio.max(1.),
                    ch - ratio.max(1.),
                ),
                CursorShape::Beam => (ratio.max(1.), ch, 0.),
                _ => (cw * if cursor.wide { 2. } else { 1. }, ch, 0.),
            };
            items.push(solid(
                [
                    pad + cursor.column as f32 * cw,
                    pad + cursor.row as f32 * ch + dy,
                    w,
                    h,
                ],
                cursor.color,
            ));
        }
        for cell in &grid.cells {
            let x = pad + cell.column as f32 * cw;
            let y = pad + cell.row as f32 * ch;
            let block_cursor = grid.cursor.as_ref().is_some_and(|cursor| {
                cursor.row == cell.row
                    && cursor.column == cell.column
                    && cursor.shape == alacritty_terminal::vte::ansi::CursorShape::Block
            });
            let color = if block_cursor {
                grid.background
            } else {
                cell.foreground
            };
            for &character in &cell.characters {
                if character == ' ' {
                    continue;
                }
                let glyph = shared
                    .cache
                    .get(device, encoder, pixels, character, cell.bold)?;
                if glyph.width == 0 || glyph.height == 0 {
                    continue;
                }
                items.push((
                    glyph,
                    instance(
                        glyph,
                        [
                            x + glyph.left as f32,
                            (y + ch + metrics.descent).round() - glyph.top as f32,
                            glyph.width as f32,
                            glyph.height as f32,
                        ],
                        rgba(color),
                        width,
                        height,
                    ),
                ));
            }
            let w = cw * if cell.wide { 2. } else { 1. };
            if cell.underline {
                items.push(solid([x, y + ch - ratio.max(1.), w, ratio.max(1.)], color));
            }
            if cell.strikeout {
                items.push(solid([x, y + ch * 0.5, w, ratio.max(1.)], color));
            }
        }
        self.draw_items(
            device,
            queue,
            encoder,
            target,
            shared,
            items,
            grid.background,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_items(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        shared: &mut SharedGlyphs,
        items: Vec<(Glyph, [f32; 16])>,
        background: [u8; 3],
    ) -> Result<(), String> {
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
        // An empty grid still needs to clear the surface, but has no vertex data.
        if let Some(buffer) = &self.instances
            && !bytes.is_empty()
        {
            queue.write_buffer(buffer, 0, &bytes);
        }
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
            while shared.bindings.len() < shared.cache.atlas.pages() {
                let page = shared.bindings.len();
                let view = shared
                    .cache
                    .atlas
                    .page_view(page)
                    .map_err(|e| e.to_string())?;
                let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("Glyph atlas page binding"),
                    layout: &shared.pipeline.get_bind_group_layout(0),
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(&shared.sampler),
                        },
                    ],
                });
                shared.bindings.push(group);
            }
            batches.push((start as u32..end as u32, items[start].0.page));
            start = end;
        }
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Native terminal glyph atlas"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color {
                        r: background[0] as f64 / 255.,
                        g: background[1] as f64 / 255.,
                        b: background[2] as f64 / 255.,
                        a: 1.0,
                    }),
                    store: wgpu::StoreOp::Store,
                },
            })],
            ..Default::default()
        });
        pass.set_pipeline(&shared.pipeline);
        if !bytes.is_empty() {
            pass.set_vertex_buffer(
                0,
                self.instances.as_ref().unwrap().slice(..bytes.len() as u64),
            );
        }
        for (range, page) in &batches {
            pass.set_bind_group(0, &shared.bindings[*page], &[]);
            pass.draw(0..6, range.clone());
        }
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
