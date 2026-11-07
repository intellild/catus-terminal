//! Owned OSR surfaces; frames rotate so Lynx never composites a buffer while
//! wgpu writes it. Each entry is presented with the SDK's external surface API.
use std::ptr::NonNull;

use anyhow::Result;
use objc2_core_foundation::CFRetained;
use objc2_io_surface::IOSurfaceRef;

use crate::{binding::native_view::RawSurface, frame::Viewport};

use super::surface;

/// One frame is being composited while the next is rendered.
const SURFACE_COUNT: usize = 2;

#[derive(Default)]
pub(crate) struct OsrSurfaces {
    width: u32,
    height: u32,
    slots: Vec<OsrSurface>,
    next: usize,
}

impl OsrSurfaces {
    /// Borrow one surface for this frame and advance the rotation. The frame
    /// keeps its own retain, so it stays valid while calls into Lynx run.
    pub(crate) fn next(&mut self, viewport: &Viewport) -> Result<OsrFrame> {
        if self.width != viewport.width || self.height != viewport.height {
            self.rebuild(viewport.width, viewport.height)?;
        }
        let index = self.next;
        self.next = (index + 1) % self.slots.len();
        let surface = &self.slots[index].surface;
        Ok(OsrFrame {
            surface: surface.clone(),
            handle: CFRetained::as_ptr(surface).cast(),
        })
    }

    pub(crate) fn clear(&mut self) {
        *self = Self::default();
    }

    fn rebuild(&mut self, width: u32, height: u32) -> Result<()> {
        let mut slots = Vec::with_capacity(SURFACE_COUNT);
        for _ in 0..SURFACE_COUNT {
            slots.push(OsrSurface {
                surface: surface::create_surface(width, height)?,
            });
        }
        self.width = width;
        self.height = height;
        self.slots = slots;
        self.next = 0;
        Ok(())
    }
}

struct OsrSurface {
    surface: CFRetained<IOSurfaceRef>,
}

pub(crate) struct OsrFrame {
    surface: CFRetained<IOSurfaceRef>,
    handle: NonNull<RawSurface>,
}

impl OsrFrame {
    pub(crate) fn surface(&self) -> &IOSurfaceRef {
        &self.surface
    }

    /// The SDK's Darwin surface handle is the IOSurfaceRef object pointer.
    pub(crate) fn handle(&self) -> NonNull<RawSurface> {
        self.handle
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn surfaces_rotate_and_rebuild_for_new_dimensions() {
        let viewport = Viewport {
            width: 64,
            height: 32,
            pixel_ratio: 2.,
        };
        let mut surfaces = OsrSurfaces::default();
        let first = surfaces.next(&viewport).unwrap();
        let second = surfaces.next(&viewport).unwrap();
        assert_ne!(first.handle(), second.handle());
        assert_eq!(surfaces.next(&viewport).unwrap().handle(), first.handle());

        let resized = Viewport {
            width: 128,
            ..viewport
        };
        let frame = surfaces.next(&resized).unwrap();
        assert_eq!(frame.surface().width(), 128);
        assert_eq!(frame.surface().height(), 32);
        assert_eq!(frame.surface().bytes_per_element(), 4);
    }
}
