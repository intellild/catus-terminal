//! Terminal component registration and window lifecycle, through Lynx's C ABI.
use std::{
    ptr::NonNull,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};

use napi::sys::napi_env;

use crate::{
    binding::{
        VsyncObserver,
        extension::{self, Extension, LynxView},
        native_view::{self, AttachedTarget},
        protocol::{ElementName, ExtensionName},
    },
    native_terminal_view::NativeTerminalView,
    platform::post_task_to_ui,
};

pub(crate) struct TerminalExtension {
    pub(crate) lynx_view: OnceLock<usize>,
    pub(crate) vsync: VsyncObserver,
    pub(crate) foreground: Arc<AtomicBool>,
    pub(crate) attached_element: Arc<AttachedTarget<NativeTerminalView>>,
}

impl Default for TerminalExtension {
    fn default() -> Self {
        Self {
            lynx_view: OnceLock::new(),
            vsync: VsyncObserver::default(),
            foreground: Arc::new(AtomicBool::new(true)),
            attached_element: Arc::default(),
        }
    }
}

impl TerminalExtension {
    fn notify_resume(&self) {
        if self.lynx_view.get().is_none() {
            return;
        }
        let attached_element = Arc::clone(&self.attached_element);
        post_task_to_ui(move || {
            if let Some(element) = attached_element.current()
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

impl Extension for TerminalExtension {
    fn vsync(&self) -> Option<&VsyncObserver> {
        Some(&self.vsync)
    }

    fn on_view_create(&self, view: NonNull<LynxView>) {
        self.lynx_view.get_or_init(|| view.as_ptr() as usize);
        // SAFETY: The module owns this boxed extension through the lifetime of
        // the registered factory. Creation only borrows it on the UI thread.
        unsafe {
            native_view::register::<NativeTerminalView>(view, ElementName::Terminal, self);
        }
    }

    fn on_runtime_attach(&self, _env: napi_env) {
        self.notify_resume();
    }

    fn on_enter_foreground(&self) {
        self.foreground.store(true, Ordering::Release);
        self.notify_resume();
    }

    fn on_enter_background(&self) {
        self.foreground.store(false, Ordering::Release);
    }
}

pub(crate) fn register_terminal_extension() {
    extension::register::<TerminalExtension>(ExtensionName::Terminal, false);
}

#[cfg(test)]
#[path = "tests/terminal_extension.rs"]
mod tests;
