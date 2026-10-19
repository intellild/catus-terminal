use super::*;
use std::time::{Duration, Instant};

/// Mimics a protocol backend that must flush a shutdown command before the
/// transport kills the process. The shell writes proof that it received it.
struct ShutdownDelegate(std::path::PathBuf);
#[async_trait::async_trait]
impl PtyDelegate for ShutdownDelegate {
    fn configure_command(&self, command: &mut CommandBuilder) {
        command.env("CATUS_PTY_SHUTDOWN_FILE", &self.0);
    }
    fn answers_queries(&self) -> bool {
        false
    }
    async fn advance(
        &self,
        bytes: &[u8],
        grid: &mut TerminalGrid,
        tx: &WriterSender,
    ) -> Result<()> {
        PlainPtyDelegate.advance(bytes, grid, tx).await
    }
    async fn input(&self, bytes: Vec<u8>, tx: &WriterSender) -> Result<()> {
        PlainPtyDelegate.input(bytes, tx).await
    }
    async fn resize(&self, size: GridSize, tx: &WriterSender) -> Result<()> {
        PlainPtyDelegate.resize(size, tx).await
    }
    async fn close(&self, preserve: bool, tx: &WriterSender) -> Duration {
        let mode = if preserve { "DETACH" } else { "CLOSE" };
        tx.send(WriterMessage::Data(
            format!("printf '{mode}' > \"$CATUS_PTY_SHUTDOWN_FILE\"; exit\r").into_bytes(),
        ))
        .unwrap();
        Duration::from_millis(500)
    }
}

#[test]
fn shutdown_flushes_delegate_commands_and_drop_detaches_without_repeating_explicit_close() {
    let directory = tempfile::tempdir().unwrap();
    for preserve in [false, true] {
        let path = directory
            .path()
            .join(if preserve { "detach" } else { "close" });
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-i");
        let (pty, _) = Pty::spawn(
            command,
            GridSize::new(80, 24),
            "/bin/sh".into(),
            Arc::new(ShutdownDelegate(path.clone())),
        )
        .unwrap();
        if !preserve {
            block_on(pty.close());
            block_on(pty.close());
            block_on(pty.detach());
            assert!(pty.exited());
            assert!(block_on(pty.write(b"late input".to_vec())).is_err());
        }
        drop(pty);
        let expected = if preserve { "DETACH" } else { "CLOSE" };
        let deadline = Instant::now() + Duration::from_secs(5);
        while std::fs::read_to_string(&path).ok().as_deref() != Some(expected) {
            assert!(
                Instant::now() < deadline,
                "PTY shutdown command was not flushed: {expected}"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }
}
