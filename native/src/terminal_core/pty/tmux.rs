use super::{PtyDelegate, WriterSender};
use crate::terminal_core::{
    grid::{GridSize, TerminalGrid},
    tmux::{TmuxClient, TmuxOptions, TmuxSessionInfo},
};
use anyhow::Result;
use async_trait::async_trait;
use portable_pty::CommandBuilder;
use std::time::Duration;
use tokio::sync::Mutex;

pub(crate) struct TmuxPtyDelegate(Mutex<TmuxClient>);
impl TmuxPtyDelegate {
    pub(crate) fn new(options: TmuxOptions, size: GridSize) -> Self {
        Self(Mutex::new(TmuxClient::new(options, size)))
    }
}
#[async_trait]
impl PtyDelegate for TmuxPtyDelegate {
    fn configure_command(&self, command: &mut CommandBuilder) {
        command.env_remove("TMUX");
    }
    fn answers_queries(&self) -> bool {
        true
    }
    async fn advance(
        &self,
        bytes: &[u8],
        grid: &mut TerminalGrid,
        tx: &WriterSender,
    ) -> Result<()> {
        self.0.lock().await.advance(bytes, grid, tx)
    }
    async fn input(&self, bytes: Vec<u8>, tx: &WriterSender) -> Result<()> {
        self.0.lock().await.input(bytes, tx)
    }
    async fn resize(&self, size: GridSize, tx: &WriterSender) -> Result<()> {
        self.0.lock().await.resize(size, tx)
    }
    async fn close(&self, _preserve: bool, tx: &WriterSender) -> Duration {
        self.0.lock().await.close(tx);
        // Allow the queued detach command to reach the server over SSH.
        Duration::from_millis(500)
    }
    async fn tmux_info(&self) -> Option<TmuxSessionInfo> {
        self.0.lock().await.session_info()
    }
    async fn select_tmux_window(&self, window_id: &str, tx: &WriterSender) -> Result<bool> {
        self.0.lock().await.select_window(window_id, tx)
    }
    async fn create_tmux_window(&self, tx: &WriterSender) -> Result<bool> {
        self.0.lock().await.create_window(tx)
    }
    async fn close_tmux_window(&self, window_id: &str, tx: &WriterSender) -> Result<bool> {
        self.0.lock().await.close_window(window_id, tx)
    }
    #[cfg(test)]
    fn ready(&self) -> bool {
        self.0.blocking_lock().ready()
    }
}
