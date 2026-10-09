//! Select OS policies and native adapters; shared terminal/wgpu logic stays outside.

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub(crate) use unix::{default_shell_command, pty_reader_closed};
#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub(crate) use windows::{default_shell_command, pty_reader_closed};

#[cfg(all(feature = "native-view", target_os = "macos"))]
mod macos;
#[cfg(all(test, feature = "native-view", target_os = "macos"))]
pub(crate) use macos::test_support;
#[cfg(all(feature = "native-view", target_os = "macos"))]
pub(crate) use macos::{GPU_BACKENDS, load_font_size, monotonic_now_ns, post_frame_to_ui};

#[cfg(all(feature = "native-view", not(target_os = "macos")))]
compile_error!("Native terminal views currently implement macOS only");
#[cfg(all(feature = "native-input-tests", target_os = "macos"))]
pub(crate) use macos::run_native_input_tests;
