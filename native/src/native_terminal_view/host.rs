use super::NativeTerminalView;
use crate::{
    binding::{VsyncObserver, native_view::AttachedTarget},
    platform::post_task_to_ui,
};
use std::sync::{Arc, atomic::AtomicBool};

pub(crate) struct TerminalHost {
    pub(crate) view: usize,
    pub(crate) vsync: VsyncObserver,
    pub(crate) foreground: Arc<AtomicBool>,
    pub(super) element: AttachedTarget<NativeTerminalView>,
}

impl TerminalHost {
    pub(crate) fn new(view: usize, vsync: VsyncObserver, foreground: Arc<AtomicBool>) -> Self {
        Self {
            view,
            vsync,
            foreground,
            element: AttachedTarget::default(),
        }
    }

    pub(crate) fn notify_resume(self: &Arc<Self>) {
        let host = Arc::clone(self);
        post_task_to_ui(move || {
            if let Some(element) = host.element.current()
                && let Err(error) = element.dispatch(|view| {
                    view.invalidate_frame();
                    Ok(())
                })
            {
                eprintln!("Resume terminal view: {error:#}");
            }
        });
    }
}
