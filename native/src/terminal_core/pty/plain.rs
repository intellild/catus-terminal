use super::{PtyDelegate, pty_size};
use crate::terminal_core::grid::{GridSize, TerminalGrid};
use anyhow::{Context, Result};
use portable_pty::MasterPty;
use std::{sync::mpsc, time::Duration};

/// Ordinary local shells and SSH connections exchange raw terminal bytes.
pub(crate) struct PlainPtyDelegate;
impl PtyDelegate for PlainPtyDelegate {
    fn answers_queries(&self) -> bool {
        false
    }
    fn advance(
        &self,
        bytes: &[u8],
        grid: &mut TerminalGrid,
        _tx: &mpsc::Sender<Vec<u8>>,
    ) -> Result<()> {
        grid.advance(bytes);
        Ok(())
    }
    fn input(&self, bytes: Vec<u8>, tx: &mpsc::Sender<Vec<u8>>) -> Result<()> {
        tx.send(bytes).context("Send PTY input")
    }
    fn resize(
        &self,
        size: GridSize,
        master: Option<&(dyn MasterPty + Send)>,
        _tx: &mpsc::Sender<Vec<u8>>,
    ) -> Result<()> {
        if let Some(master) = master {
            master
                .resize(pty_size(size))
                .context("Resize terminal PTY")?;
        }
        Ok(())
    }
    fn close(&self, _preserve: bool, _tx: &mpsc::Sender<Vec<u8>>) -> Duration {
        Duration::ZERO
    }
}
