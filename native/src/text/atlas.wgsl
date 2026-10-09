struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) @interpolate(flat) multicolor: f32,
};

@group(0) @binding(0) var atlas: texture_2d<f32>;
@group(0) @binding(1) var atlas_sampler: sampler;

@vertex
fn vs_main(@builtin(vertex_index) index: u32,
           @location(0) rect: vec4<f32>,
           @location(1) uv: vec4<f32>,
           @location(2) color: vec4<f32>,
           @location(3) params: vec4<f32>) -> VertexOutput {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(0, 0), vec2<f32>(1, 0), vec2<f32>(0, 1),
    vec2<f32>(0, 1), vec2<f32>(1, 0), vec2<f32>(1, 1)
  );
  let corner = corners[index];
  let pixel = rect.xy + rect.zw * corner;
  var out: VertexOutput;
  // wgpu NDC is Y-up; ordinary framebuffers use top-left pixels.
  // Only Lynx OSR targets need the opposite orientation for host composition.
  let ndc = pixel / params.yz * 2.0 - vec2<f32>(1);
  out.position = vec4<f32>(ndc.x, ndc.y * params.w, 0, 1);
  out.uv = uv.xy + uv.zw * corner;
  out.color = color;
  out.multicolor = params.x;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let bitmap = textureSample(atlas, atlas_sampler, in.uv);
  if in.multicolor > 1.5 { return in.color; }
  if in.multicolor > 0.5 {
    // Color glyphs arrive premultiplied; the pipeline uses premultiplied blending.
    return bitmap;
  }
  // Monochrome pages are R8Unorm coverage, not RGB subpixel masks.
  let coverage = bitmap.r * in.color.a;
  return vec4<f32>(in.color.rgb * coverage, coverage);
}
