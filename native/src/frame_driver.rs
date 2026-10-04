//! Replaceable JS RAF signal adapter; callback ownership lives in frame_callbacks.
use crate::frame_callbacks::{monotonic_now_ns, post_frame_to_ui};
use napi_derive::napi;

/// Temporary JS RAF adapter. The JS timestamp has a different clock origin;
/// start a 60 Hz rendering budget on the native monotonic clock at receipt.
/// UI dispatch checks this deadline, so a delayed tick is discarded.
#[napi]
pub fn dispatch_animation_frame() {
    let deadline = monotonic_now_ns().saturating_add(16_666_667);
    post_frame_to_ui(deadline);
}
