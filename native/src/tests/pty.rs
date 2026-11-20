use super::*;
use std::time::{Duration, Instant};

/// Mimics a protocol backend that must flush a shutdown command before the
/// transport kills the process. The shell writes proof that it received it.
struct ShutdownDelegate {
    path: std::path::PathBuf,
    parser_gate: Option<(std::sync::mpsc::Sender<()>, tokio::sync::Notify)>,
}
#[async_trait::async_trait]
impl PtyDelegate for ShutdownDelegate {
    fn configure_command(&self, command: &mut CommandBuilder) {
        command.env("CATUS_PTY_SHUTDOWN_FILE", &self.path);
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
        if let Some((started, resume)) = &self.parser_gate {
            started.send(())?;
            resume.notified().await;
        }
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
        let session = TerminalSession::command_with_delegate(
            "/bin/sh",
            &["-i".into()],
            None,
            GridSize::new(80, 24),
            Arc::new(ShutdownDelegate {
                path: path.clone(),
                parser_gate: None,
            }),
        )
        .unwrap();
        if !preserve {
            session.close();
            session.close();
            session.detach_pty();
            assert!(session.exited());
            assert!(session.write(b"late input".to_vec()).is_err());
        }
        drop(session);
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

#[test]
fn last_reference_released_by_parser_detaches_the_pty() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("parser-detach");
    let (started, parsing) = std::sync::mpsc::channel();
    let delegate = Arc::new(ShutdownDelegate {
        path: path.clone(),
        parser_gate: Some((started, tokio::sync::Notify::new())),
    });
    let session = TerminalSession::command_with_delegate(
        "/bin/sh",
        &["-c".into(), "printf ready; exec /bin/sh -i".into()],
        None,
        GridSize::new(80, 24),
        delegate.clone(),
    )
    .unwrap();
    let weak = Arc::downgrade(&session);
    parsing.recv_timeout(Duration::from_secs(5)).unwrap();
    drop(session);
    assert_eq!(weak.strong_count(), 1);
    delegate.parser_gate.as_ref().unwrap().1.notify_one();

    let deadline = Instant::now() + Duration::from_secs(5);
    while std::fs::read_to_string(&path).ok().as_deref() != Some("DETACH") {
        assert!(Instant::now() < deadline, "Parser did not detach the PTY");
        thread::sleep(Duration::from_millis(10));
    }
    assert!(weak.upgrade().is_none());
}
