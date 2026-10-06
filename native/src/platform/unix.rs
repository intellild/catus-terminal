//! Unix shell launch and PTY EOF conventions, shared by macOS and Linux.
use portable_pty::CommandBuilder;

pub(crate) fn default_shell_command() -> (CommandBuilder, String) {
    // Resolve the account shell instead of trusting an inherited SHELL override.
    let mut defaults = CommandBuilder::new_default_prog();
    defaults.env_remove("SHELL");
    let shell = defaults.get_shell();
    let mut command = CommandBuilder::new(&shell);
    command.args(["-l", "-i"]);
    if let Some(home) = std::env::var_os("HOME") {
        command.cwd(home);
    }
    (command, shell)
}

pub(crate) fn pty_reader_closed(error: &std::io::Error) -> bool {
    // A closed slave reports EIO on some Unix implementations.
    error.raw_os_error() == Some(5)
}
