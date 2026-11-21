use anyhow::Error;
#[cfg(feature = "native-view")]
pub mod binding;
#[cfg(feature = "native-view")]
mod frame;
#[cfg(feature = "native-view")]
mod native_terminal_view;
mod platform;
mod sftp;
mod sftp_api;
#[cfg(feature = "native-view")]
mod terminal_extension;
pub use sftp_api::{SftpConnection, SftpEntry, SftpMetadata, SftpOptions, connect_sftp};
mod host;
#[cfg(feature = "native-view")]
mod renderer;
pub mod terminal_core;
mod terminal_session;
#[cfg(feature = "native-view")]
pub mod text;
pub use terminal_session::{
    TerminalSessionCommand, TerminalSessionInfo, close_terminal_session, close_tmux_window,
    create_terminal_session, create_tmux_window, detach_terminal_session,
    get_terminal_session_info, get_tmux_session_info, select_tmux_window, write_terminal_session,
};
#[cfg(feature = "native-view")]
mod terminal_content;
fn napi_error(error: Error) -> napi::Error {
    napi::Error::from_reason(format!("{error:#}"))
}
