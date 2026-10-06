use anyhow::Error;
#[cfg(feature = "native-view")]
mod frame;
#[cfg(feature = "native-view")]
mod frame_callbacks;
#[cfg(feature = "native-view")]
mod frame_driver;
#[cfg(feature = "native-view")]
pub use frame_driver::dispatch_animation_frame;
mod platform;
#[cfg(feature = "native-view")]
mod renderer;
pub mod terminal_core;
mod terminal_session;
#[cfg(feature = "native-view")]
pub mod text;
pub use terminal_session::{
    TerminalSessionCommand, TerminalSessionInfo, close_terminal_session, create_terminal_session,
    get_terminal_session_info, write_terminal_session,
};
#[cfg(feature = "native-view")]
mod terminal_view;
fn napi_error(error: Error) -> napi::Error {
    napi::Error::from_reason(format!("{error:#}"))
}

#[cfg(test)]
#[path = "tests/errors.rs"]
mod tests;
