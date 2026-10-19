use super::PtyDelegate;
use crate::terminal_core::{
    grid::{GridSize, TerminalGrid},
    tmux::{TmuxClient, TmuxOptions, TmuxSessionInfo},
};
use anyhow::Result;
use portable_pty::{CommandBuilder, MasterPty};
use std::{
    sync::{Mutex, mpsc::Sender},
    time::Duration,
};

pub(crate) struct TmuxPtyDelegate(Mutex<TmuxClient>);
impl TmuxPtyDelegate {
    pub(crate) fn new(options: TmuxOptions, size: GridSize) -> Self {
        Self(Mutex::new(TmuxClient::new(options, size)))
    }
}
impl PtyDelegate for TmuxPtyDelegate {
    fn configure_command(&self, command: &mut CommandBuilder) {
        command.env_remove("TMUX");
    }
    fn answers_queries(&self) -> bool {
        true
    }
    fn advance(&self, bytes: &[u8], grid: &mut TerminalGrid, tx: &Sender<Vec<u8>>) -> Result<()> {
        self.0.lock().unwrap().advance(bytes, grid, tx)
    }
    fn input(&self, bytes: Vec<u8>, tx: &Sender<Vec<u8>>) -> Result<()> {
        self.0.lock().unwrap().input(bytes, tx)
    }
    fn resize(
        &self,
        size: GridSize,
        _master: Option<&(dyn MasterPty + Send)>,
        tx: &Sender<Vec<u8>>,
    ) -> Result<()> {
        self.0.lock().unwrap().resize(size, tx)
    }
    fn close(&self, preserve: bool, tx: &Sender<Vec<u8>>) -> Duration {
        self.0.lock().unwrap().close(preserve, tx);
        // Allow queued session/window and detach commands to reach the server over SSH.
        Duration::from_millis(500)
    }
    fn tmux_info(&self) -> Option<TmuxSessionInfo> {
        self.0.lock().unwrap().session_info()
    }
    fn select_tmux_window(&self, window_id: &str, tx: &Sender<Vec<u8>>) -> Result<bool> {
        self.0.lock().unwrap().select_window(window_id, tx)
    }
    fn create_tmux_window(&self, tx: &Sender<Vec<u8>>) -> Result<bool> {
        self.0.lock().unwrap().create_window(tx)
    }
    fn close_tmux_window(&self, window_id: &str, tx: &Sender<Vec<u8>>) -> Result<bool> {
        self.0.lock().unwrap().close_window(window_id, tx)
    }
    #[cfg(test)]
    fn ready(&self) -> bool {
        self.0.lock().unwrap().ready()
    }
}
