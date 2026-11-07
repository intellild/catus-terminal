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
    /// Slot last handed to Lynx; rendering always targets the other slot.
    displayed: Option<usize>,
}

impl OsrSurfaces {
    /// Select the slot that is not currently displayed. The rotation commits
    /// only after presentation, so failed or expired attempts reuse the same
    /// target instead of writing into the surface Lynx is showing.
    pub(crate) fn acquire(&mut self, viewport: &Viewport) -> Result<OsrFrame> {
        if self.width != viewport.width || self.height != viewport.height {
            self.rebuild(viewport.width, viewport.height)?;
        }
        let index = self
            .displayed
            .map_or(0, |displayed| (displayed + 1) % self.slots.len());
        let surface = &self.slots[index].surface;
        Ok(OsrFrame {
            index,
            surface: surface.clone(),
            handle: CFRetained::as_ptr(surface).cast(),
        })
    }

    /// Record a completed presentation; the other slot becomes the next target.
    pub(crate) fn commit(&mut self, index: usize) {
        debug_assert!(index < self.slots.len());
        self.displayed = Some(index);
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
        self.displayed = None;
        Ok(())
    }
}

struct OsrSurface {
    surface: CFRetained<IOSurfaceRef>,
}

pub(crate) struct OsrFrame {
    index: usize,
    surface: CFRetained<IOSurfaceRef>,
    handle: NonNull<RawSurface>,
}

impl OsrFrame {
    pub(crate) fn index(&self) -> usize {
        self.index
    }

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
    fn surfaces_reuse_the_working_slot_until_presentation_commits() {
        let viewport = Viewport {
            width: 64,
            height: 32,
            pixel_ratio: 2.,
        };
        let mut surfaces = OsrSurfaces::default();
        let first = surfaces.acquire(&viewport).unwrap();
        let retry = surfaces.acquire(&viewport).unwrap();
        assert_eq!(retry.handle(), first.handle());
        assert_eq!(retry.index(), first.index());

        surfaces.commit(first.index());
        let second = surfaces.acquire(&viewport).unwrap();
        assert_ne!(second.handle(), first.handle());
        assert_eq!(
            surfaces.acquire(&viewport).unwrap().handle(),
            second.handle()
        );

        surfaces.commit(second.index());
        assert_eq!(
            surfaces.acquire(&viewport).unwrap().handle(),
            first.handle()
        );

        let resized = Viewport {
            width: 128,
            ..viewport
        };
        let frame = surfaces.acquire(&resized).unwrap();
        assert_eq!(frame.index(), 0);
        assert_eq!(frame.surface().width(), 128);
        assert_eq!(frame.surface().height(), 32);
        assert_eq!(frame.surface().bytes_per_element(), 4);
    }
}
