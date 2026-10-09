use crate::frame::Viewport;
use objc2_core_foundation::CFRetained;
use objc2_core_foundation::{CFDictionary, CFNumber};
use objc2_io_surface::IOSurfaceRef;
use objc2_io_surface::{
    IOSurfaceLockOptions, kIOSurfaceBytesPerElement, kIOSurfaceBytesPerRow, kIOSurfaceHeight,
    kIOSurfacePixelFormat, kIOSurfaceWidth,
};

// Real IOSurface storage exercises the same native-buffer import as Lynx.
pub(crate) struct Target {
    surface: CFRetained<IOSurfaceRef>,
}

impl Target {
    pub(crate) fn new(viewport: Viewport) -> Self {
        Self::with_bytes_per_element(viewport, 4)
    }

    pub(crate) fn with_bytes_per_element(viewport: Viewport, bytes: u32) -> Self {
        let values = [
            CFNumber::new_i64(viewport.width.into()),
            CFNumber::new_i64(viewport.height.into()),
            CFNumber::new_i64(bytes.into()),
            CFNumber::new_i64(((viewport.width * bytes).div_ceil(256) * 256).into()),
            CFNumber::new_i64(
                u32::from_be_bytes(if bytes == 4 { *b"BGRA" } else { *b"L008" }).into(),
            ),
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
        let surface = unsafe { IOSurfaceRef::new(properties.as_opaque()) }.unwrap();
        let target = Self { surface };
        let _lock = SurfaceLock::new(&target.surface, IOSurfaceLockOptions::empty());
        // Initialize the owned allocation to make skipped-frame comparisons deterministic.
        unsafe {
            target
                .surface
                .base_address()
                .as_ptr()
                .cast::<u8>()
                .write_bytes(0, target.surface.alloc_size());
        }
        drop(_lock);
        target
    }

    pub(crate) fn surface(&self) -> &IOSurfaceRef {
        &self.surface
    }

    pub(crate) fn pixels(&self) -> Vec<u8> {
        // render_surface waits for GPU completion; lock before CPU readback.
        let _lock = SurfaceLock::new(&self.surface, IOSurfaceLockOptions::ReadOnly);
        let bytes = unsafe {
            std::slice::from_raw_parts(
                self.surface.base_address().as_ptr().cast::<u8>(),
                self.surface.alloc_size(),
            )
        };
        bytes
            .chunks_exact(self.surface.bytes_per_row())
            .take(self.surface.height())
            .flat_map(|row| {
                row[..self.surface.width() * self.surface.bytes_per_element()]
                    .iter()
                    .copied()
            })
            .collect()
    }
}

struct SurfaceLock<'a> {
    surface: &'a IOSurfaceRef,
    options: IOSurfaceLockOptions,
}
impl<'a> SurfaceLock<'a> {
    fn new(surface: &'a IOSurfaceRef, options: IOSurfaceLockOptions) -> Self {
        assert_eq!(unsafe { surface.lock(options, std::ptr::null_mut()) }, 0);
        Self { surface, options }
    }
}
impl Drop for SurfaceLock<'_> {
    fn drop(&mut self) {
        assert_eq!(
            unsafe { self.surface.unlock(self.options, std::ptr::null_mut()) },
            0
        );
    }
}
