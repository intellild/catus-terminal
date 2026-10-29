//! Native VSync frame source; one request per display frame.
//!
//! The observer belongs to the Lynx runtime on BTS. Keep every call on the
//! thread that receives `on_runtime_attach`; only the target deadline crosses
//! to the UI queue. Pending requests are cancelled by Lynx with a zero target
//! during runtime detach, so the callback never re-arms after `stop`.
use crate::{
    binding::extension::{VsyncObserver, request_animation_frame},
    platform::post_frame_to_ui,
};
use std::{
    ffi::c_void,
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{Mutex, MutexGuard},
};

// A single logical request per observer. Lynx deduplicates pending requests by
// this id, so repeated re-arms never leave more than one callback outstanding.
const REQUEST_ID: usize = 1;

#[derive(Default)]
struct State {
    observer: usize,
    user_data: usize,
    running: bool,
}

pub(crate) struct NativeFrameSource {
    state: Mutex<State>,
}

impl Default for NativeFrameSource {
    fn default() -> Self {
        Self {
            state: Mutex::new(State::default()),
        }
    }
}

impl NativeFrameSource {
    pub(crate) fn start(&self, observer: *mut VsyncObserver, user_data: *mut c_void) {
        if observer.is_null() {
            return;
        }
        let mut state = self.lock();
        if state.running {
            return;
        }
        state.observer = observer as usize;
        state.user_data = user_data as usize;
        state.running = true;
        self.request(&mut state);
    }

    pub(crate) fn stop(&self) {
        let mut state = self.lock();
        state.running = false;
        state.observer = 0;
        state.user_data = 0;
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // A panic while holding the frame source lock must not stop later frames.
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn request(&self, state: &mut State) {
        if !state.running || state.observer == 0 {
            return;
        }
        // SAFETY: start stores the live observer and this source's stable address;
        // stop clears both, and Lynx cancels pending requests before the source dies.
        unsafe {
            request_animation_frame(
                state.observer as *mut VsyncObserver,
                REQUEST_ID,
                Some(on_animation_frame),
                state.user_data as *mut c_void,
            );
        }
    }

    fn frame(&self, target: i64) {
        if target <= 0 {
            return;
        }
        {
            let state = self.lock();
            if !state.running {
                return;
            }
        }
        post_frame_to_ui(target);
        let mut state = self.lock();
        self.request(&mut state);
    }
}

unsafe extern "C" fn on_animation_frame(user_data: *mut c_void, _start: i64, target: i64) {
    if user_data.is_null() {
        return;
    }
    // The host calls this across the C ABI; a Rust panic must not unwind through it.
    let _ = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: `start` stores the address of a NativeFrameSource that lives
        // in the extension until the host cancels pending requests.
        let source = unsafe { &*user_data.cast::<NativeFrameSource>() };
        source.frame(target);
    }));
}
