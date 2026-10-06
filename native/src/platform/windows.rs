//! Windows default process launch; portable-pty supplies the OS shell.
use portable_pty::CommandBuilder;

pub(crate) fn default_shell_command() -> (CommandBuilder, String) {
    let command = CommandBuilder::new_default_prog();
    let shell = command.get_shell();
    (command, shell)
}

pub(crate) fn pty_reader_closed(_error: &std::io::Error) -> bool {
    false
}
