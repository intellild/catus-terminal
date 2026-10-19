//! Per-connection protocol behavior; Pty owns the shared transport resources.
use super::WriterSender;
use crate::terminal_core::grid::{GridSize, TerminalGrid};
use crate::terminal_core::tmux::TmuxSessionInfo;
use anyhow::Result;
use async_trait::async_trait;
use portable_pty::CommandBuilder;
use std::time::Duration;

#[async_trait]
pub(crate) trait PtyDelegate: Send + Sync {
    fn configure_command(&self, _command: &mut CommandBuilder) {}
    fn answers_queries(&self) -> bool;
    async fn advance(&self, bytes: &[u8], grid: &mut TerminalGrid, tx: &WriterSender)
    -> Result<()>;
    async fn input(&self, bytes: Vec<u8>, tx: &WriterSender) -> Result<()>;
    /// Apply protocol-specific resize commands; `Pty` already resized the
    /// portable-pty master.
    async fn resize(&self, size: GridSize, tx: &WriterSender) -> Result<()>;
    async fn close(&self, preserve: bool, tx: &WriterSender) -> Duration;
    async fn tmux_info(&self) -> Option<TmuxSessionInfo> {
        None
    }
    async fn select_tmux_window(&self, _window_id: &str, _tx: &WriterSender) -> Result<bool> {
        Ok(false)
    }
    async fn create_tmux_window(&self, _tx: &WriterSender) -> Result<bool> {
        Ok(false)
    }
    async fn close_tmux_window(&self, _window_id: &str, _tx: &WriterSender) -> Result<bool> {
        Ok(false)
    }
    #[cfg(test)]
    fn ready(&self) -> bool {
        true
    }
}
