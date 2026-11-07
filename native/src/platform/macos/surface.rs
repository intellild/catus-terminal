//! Own and import the OSR IOSurface used by the shared wgpu device.
use crate::frame::Viewport;
use anyhow::{Context, Result, anyhow};
use objc2_core_foundation::{CFDictionary, CFNumber, CFRetained};
use objc2_io_surface::{
    IOSurfaceRef, kIOSurfaceBytesPerElement, kIOSurfaceBytesPerRow, kIOSurfaceHeight,
    kIOSurfacePixelFormat, kIOSurfaceWidth,
};
use objc2_metal::{
    MTLDevice, MTLPixelFormat, MTLStorageMode, MTLTextureDescriptor, MTLTextureType,
    MTLTextureUsage,
};

/// Create a Metal-shareable BGRA8 IOSurface. Dimensions are physical pixels,
/// matching the layout Lynx expects from `PresentSurface`.
pub(crate) fn create_surface(width: u32, height: u32) -> Result<CFRetained<IOSurfaceRef>> {
    let bytes_per_element = 4;
    let bytes_per_row = (width * bytes_per_element).div_ceil(256) * 256;
    let values = [
        CFNumber::new_i64(width.into()),
        CFNumber::new_i64(height.into()),
        CFNumber::new_i64(bytes_per_element.into()),
        CFNumber::new_i64(bytes_per_row.into()),
        CFNumber::new_i64(u32::from_be_bytes(*b"BGRA").into()),
    ];
    // IOSurface keys are CFStrings; numeric layout values are CFNumbers.
    let properties = CFDictionary::from_slices(
        &unsafe {
            [
                kIOSurfaceWidth,
                kIOSurfaceHeight,
                kIOSurfaceBytesPerElement,
                kIOSurfaceBytesPerRow,
                kIOSurfacePixelFormat,
            ]
        },
        &values.iter().map(|value| &**value).collect::<Vec<_>>(),
    );
    unsafe { IOSurfaceRef::new(properties.as_opaque()) }
        .with_context(|| format!("Create {width}x{height} terminal IOSurface"))
}

/// Draw a supplied grid into an IOSurface, without accessing a session,
/// PTY or native view. Returns false when the frame is expired or contended.
///
/// # Safety
/// The caller must reserve the surface exclusively until GPU writes complete.
pub(crate) unsafe fn render_to_surface(
    renderer: &mut crate::renderer::TerminalRenderer,
    viewport: &Viewport,
    grid: &crate::terminal_core::grid::GridSnapshot,
    surface: &IOSurfaceRef,
    deadline: i64,
) -> Result<bool> {
    renderer.render_grid_with_origin(
        viewport,
        grid,
        deadline,
        crate::text::TargetOrigin::BottomLeft,
        |device| unsafe { import_surface(device, surface, viewport) },
    )
}

/// # Safety
/// `surface` must be exclusively borrowed until all
/// GPU writes complete. The caller validates the viewport before importing.
pub(crate) unsafe fn import_surface(
    device: &wgpu::Device,
    surface: &IOSurfaceRef,
    viewport: &Viewport,
) -> Result<wgpu::Texture> {
    let Viewport { width, height, .. } = *viewport;
    if surface.width() != width as usize
        || surface.height() != height as usize
        || surface.bytes_per_element() != 4
    {
        return Err(anyhow!(
            "Unexpected OSR IOSurface dimensions or pixel layout"
        ));
    }
    let raw = objc2::rc::autoreleasepool(|_| {
        let device = unsafe { device.as_hal::<wgpu::hal::api::Metal>() }
            .context("Shared GPU is not a Metal device")?;
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
            .newTextureWithDescriptor_iosurface_plane(&descriptor, surface, 0)
            .context("Metal could not import the OSR IOSurface")
    })?;
    unsafe { import_texture(device, raw, viewport) }
}

pub(crate) unsafe fn import_texture(
    device: &wgpu::Device,
    raw: objc2::rc::Retained<objc2::runtime::ProtocolObject<dyn objc2_metal::MTLTexture>>,
    viewport: &Viewport,
) -> Result<wgpu::Texture> {
    let Viewport { width, height, .. } = *viewport;
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
        device.create_texture_from_hal::<wgpu::hal::api::Metal>(
            hal_texture,
            &wgpu::TextureDescriptor {
                label: Some("Imported native terminal render target"),
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
    Ok(texture)
}

#[cfg(test)]
#[path = "../../tests/macos/surface_support.rs"]
pub(crate) mod test_support;
