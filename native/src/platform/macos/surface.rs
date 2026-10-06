//! Import a synchronously borrowed Lynx IOSurface into the shared wgpu device.
use crate::frame::Viewport;
use anyhow::{Context, Result, anyhow};
use objc2_core_foundation::CFRetained;
use objc2_io_surface::IOSurfaceRef;
use objc2_metal::{
    MTLDevice, MTLPixelFormat, MTLStorageMode, MTLTextureDescriptor, MTLTextureType,
    MTLTextureUsage,
};
use std::ptr::NonNull;

/// # Safety
/// `iosurface` must point to a live IOSurfaceRef, exclusively borrowed until all
/// GPU writes complete. The caller validates the viewport before importing.
pub(crate) unsafe fn import_surface(
    device: &wgpu::Device,
    iosurface: usize,
    viewport: &Viewport,
) -> Result<wgpu::Texture> {
    let Viewport { width, height, .. } = *viewport;
    let ptr =
        NonNull::new(iosurface as *mut IOSurfaceRef).context("Lynx back buffer is unavailable")?;
    // Retain only our own reference; never consume Lynx's borrowed ownership.
    let surface = unsafe { CFRetained::retain(ptr) };
    if surface.width() != width as usize
        || surface.height() != height as usize
        || surface.bytes_per_element() != 4
    {
        return Err(anyhow!(
            "Unexpected Lynx IOSurface dimensions or pixel layout"
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
            .newTextureWithDescriptor_iosurface_plane(&descriptor, &surface, 0)
            .context("Metal could not import the Lynx IOSurface")
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
        device.create_texture_from_hal::<wgpu::hal::api::Metal>(
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
    Ok(texture)
}

#[cfg(test)]
#[path = "../../tests/macos/surface_support.rs"]
pub(crate) mod test_support;
