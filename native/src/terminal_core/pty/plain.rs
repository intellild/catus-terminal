use super::{PtyDelegate, WriterMessage, WriterSender};
use crate::terminal_core::grid::{GridSize, TerminalGrid};
use anyhow::{Context, Result};
use async_trait::async_trait;
use std::time::Duration;

/// Ordinary local shells and SSH connections exchange raw terminal bytes.
pub(crate) struct PlainPtyDelegate;
#[async_trait]
impl PtyDelegate for PlainPtyDelegate {
    fn answers_queries(&self) -> bool {
        false
    }
    async fn advance(
        &self,
        bytes: &[u8],
        grid: &mut TerminalGrid,
        _tx: &WriterSender,
    ) -> Result<()> {
        grid.advance(bytes);
        Ok(())
    }
    async fn input(&self, bytes: Vec<u8>, tx: &WriterSender) -> Result<()> {
        tx.send(WriterMessage::Data(bytes))
            .context("Send PTY input")
    }
    async fn resize(&self, _size: GridSize, _tx: &WriterSender) -> Result<()> {
        Ok(())
    }
    async fn close(&self, _preserve: bool, _tx: &WriterSender) -> Duration {
        Duration::ZERO
    }
}
