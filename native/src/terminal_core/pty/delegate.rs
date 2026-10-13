//! Per-connection protocol behavior; Pty owns the shared transport resources.
use crate::terminal_core::grid::{GridSize, TerminalGrid};
use anyhow::Result;
use portable_pty::{CommandBuilder, MasterPty};
use std::{sync::mpsc::Sender, time::Duration};

pub(crate) trait PtyDelegate: Send + Sync {
    fn configure_command(&self, _command: &mut CommandBuilder) {}
    fn answers_queries(&self) -> bool;
    fn advance(&self, bytes: &[u8], grid: &mut TerminalGrid, tx: &Sender<Vec<u8>>) -> Result<()>;
    fn input(&self, bytes: Vec<u8>, tx: &Sender<Vec<u8>>) -> Result<()>;
    fn resize(
        &self,
        size: GridSize,
        master: Option<&(dyn MasterPty + Send)>,
        tx: &Sender<Vec<u8>>,
    ) -> Result<()>;
    fn close(&self, preserve: bool, tx: &Sender<Vec<u8>>) -> Duration;
    #[cfg(test)]
    fn ready(&self) -> bool {
        true
    }
}
