use std::sync::{Arc, Mutex, Weak, atomic::AtomicBool};

use crate::binding::VsyncObserver;

use super::render_scheduler::RenderScheduler;

pub(crate) struct TerminalHost {
    pub(crate) view: usize,
    pub(crate) vsync: VsyncObserver,
    pub(crate) foreground: Arc<AtomicBool>,
    schedulers: Mutex<Vec<Weak<RenderScheduler>>>,
}

impl TerminalHost {
    pub(crate) fn new(view: usize, vsync: VsyncObserver, foreground: Arc<AtomicBool>) -> Self {
        Self {
            view,
            vsync,
            foreground,
            schedulers: Mutex::new(Vec::new()),
        }
    }

    pub(super) fn register(&self, scheduler: &Arc<RenderScheduler>) {
        self.schedulers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(Arc::downgrade(scheduler));
    }

    pub(crate) fn schedule_all(&self) {
        let schedulers: Vec<_> = {
            let mut schedulers = self
                .schedulers
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            schedulers.retain(|scheduler| scheduler.strong_count() > 0);
            schedulers.iter().filter_map(Weak::upgrade).collect()
        };
        for scheduler in schedulers {
            scheduler.schedule();
        }
    }
}
