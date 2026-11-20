//! Shared PTY ownership: blocking portable-pty threads bridged to an async core.
mod delegate;
mod plain;
mod tmux;
use super::grid::{GridSize, TerminalGrid};
use super::session::TerminalSession;
use super::tmux::TmuxSessionInfo;
use anyhow::{Context, Result, anyhow};
pub(crate) use delegate::PtyDelegate;
pub(crate) use plain::PlainPtyDelegate;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::{
    future::Future,
    io::{Read, Write},
    sync::{
        Arc, LazyLock, OnceLock, Weak,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
pub(crate) use tmux::TmuxPtyDelegate;
use tokio::{
    runtime::Runtime,
    sync::{
        Mutex,
        mpsc::{Receiver, Sender, UnboundedReceiver, UnboundedSender, channel, unbounded_channel},
    },
    task::AbortHandle,
};

type PtyError = Arc<dyn std::error::Error + Send + Sync>;

#[cfg(test)]
pub(crate) fn test_channel() -> (WriterSender, UnboundedReceiver<WriterMessage>) {
    unbounded_channel()
}

#[cfg(test)]
pub(crate) fn test_sender() -> WriterSender {
    unbounded_channel().0
}

#[cfg(test)]
pub(crate) fn message_data(message: WriterMessage) -> Vec<u8> {
    match message {
        WriterMessage::Data(bytes) => bytes,
        WriterMessage::Close(_) => panic!("unexpected writer close"),
    }
}

/// One PTY read chunk, or the terminal condition that ends the read thread.
enum ReadEvent {
    Data(Vec<u8>),
    Eof,
    Error(PtyError),
}

/// Channels for consuming PTY output and sending parser replies.
pub(super) struct PtyOutput {
    events: Receiver<ReadEvent>,
    writer: WriterSender,
}

/// Writer-thread commands. `Close` makes the blocking writer wait out the
/// shutdown grace and exit even while the grid or parser still holds a sender.
pub(crate) enum WriterMessage {
    Data(Vec<u8>),
    /// Stop after the blocking writer has remained open for the shutdown grace
    /// period, so the shell can consume already queued commands.
    Close(Duration),
}
pub(crate) type WriterSender = UnboundedSender<WriterMessage>;

/// The runtime owns async grid parsing and shutdown reaping. The portable-pty
/// reader and writer stay on their own blocking threads and meet the async core
/// through channels: bounded reader events apply backpressure, and an unbounded
/// writer queue keeps UI input from waiting on the PTY.
static RUNTIME: LazyLock<Runtime> = LazyLock::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .thread_name("catus-pty")
        .enable_all()
        .build()
        .expect("Start PTY runtime")
});

/// Block on the internal async PTY API from UI, Node and test threads.
///
/// The same runtime also runs the parser task, so this must never be called
/// from inside that task (or any other async context).
pub(crate) fn block_on<F: Future>(future: F) -> F::Output {
    RUNTIME.block_on(future)
}

pub(crate) struct Pty {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
    input: Mutex<Option<WriterSender>>,
    exited: Arc<AtomicBool>,
    error: Arc<Mutex<Option<PtyError>>>,
    delegate: Arc<dyn PtyDelegate>,
    parser: OnceLock<AbortHandle>,
}
impl Pty {
    pub(super) fn spawn(
        mut command: CommandBuilder,
        size: GridSize,
        shell: &str,
        delegate: Arc<dyn PtyDelegate>,
    ) -> Result<(Self, TerminalGrid, PtyOutput)> {
        delegate.configure_command(&mut command);
        let pair = native_pty_system()
            .openpty(pty_size(size))
            .context("Open terminal PTY")?;
        let reader = pair
            .master
            .try_clone_reader()
            .context("Create PTY reader")?;
        let writer = pair.master.take_writer().context("Create PTY writer")?;
        let child = pair
            .slave
            .spawn_command(command)
            .with_context(|| format!("Spawn terminal process {shell}"))?;
        drop(pair.slave);
        let (write_tx, write_rx) = unbounded_channel::<WriterMessage>();
        // A backend that answers VT queries must not receive duplicate replies
        // from the local rendering grid as user input.
        let replies = if delegate.answers_queries() {
            // Keep the sender valid but discard replies: drop the receiver.
            unbounded_channel().0
        } else {
            write_tx.clone()
        };
        let grid = TerminalGrid::new(size, replies);
        let exited = Arc::new(AtomicBool::new(false));
        let error: Arc<Mutex<Option<PtyError>>> = Arc::new(Mutex::new(None));

        let write_error = error.clone();
        let write_exited = exited.clone();
        thread::Builder::new()
            .name("terminal-pty-writer".into())
            .spawn(move || write_loop(writer, write_rx, write_error, write_exited))
            .context("Start PTY writer thread")?;

        // Bound the read bridge so a fast producer applies PTY backpressure
        // instead of growing an unbounded queue in memory.
        let (read_tx, read_rx) = channel::<ReadEvent>(16);
        let read_exited = exited.clone();
        thread::Builder::new()
            .name("terminal-pty-reader".into())
            .spawn(move || read_loop(reader, read_tx, read_exited))
            .context("Start PTY reader thread")?;

        let output = PtyOutput {
            events: read_rx,
            writer: write_tx.clone(),
        };
        let pty = Self {
            master: Mutex::new(Some(pair.master)),
            child: Mutex::new(Some(child)),
            input: Mutex::new(Some(write_tx)),
            exited,
            error,
            delegate,
            parser: OnceLock::new(),
        };
        Ok((pty, grid, output))
    }

    pub(super) fn start_parser(&self, session: Weak<TerminalSession>, output: PtyOutput) {
        self.parser
            .get_or_init(|| RUNTIME.spawn(output.parse(session)).abort_handle());
    }

    pub(super) async fn advance(
        &self,
        bytes: &[u8],
        grid: &mut TerminalGrid,
        writer: &WriterSender,
    ) -> Result<()> {
        self.delegate.advance(bytes, grid, writer).await
    }

    pub(super) async fn write(&self, bytes: Vec<u8>) -> Result<()> {
        if self.exited.load(Ordering::Acquire) {
            return Err(anyhow!("Shell has exited"));
        }
        let input = self.input.lock().await;
        let tx = input.as_ref().context("Terminal is closed")?;
        self.delegate.input(bytes, tx).await
    }

    pub(super) async fn resize(&self, size: GridSize) -> Result<()> {
        let input = self.input.lock().await;
        if let Some(tx) = input.as_ref() {
            if let Some(master) = self.master.lock().await.as_deref() {
                master
                    .resize(pty_size(size))
                    .context("Resize terminal PTY")?;
            }
            self.delegate.resize(size, tx).await?;
        }
        Ok(())
    }

    pub(super) async fn tmux_info(&self) -> Option<TmuxSessionInfo> {
        self.delegate.tmux_info().await
    }

    pub(super) async fn select_tmux_window(&self, window_id: &str) -> Result<bool> {
        let input = self.input.lock().await;
        let tx = input.as_ref().context("Terminal is closed")?;
        self.delegate.select_tmux_window(window_id, tx).await
    }

    pub(super) async fn create_tmux_window(&self) -> Result<bool> {
        let input = self.input.lock().await;
        let tx = input.as_ref().context("Terminal is closed")?;
        self.delegate.create_tmux_window(tx).await
    }

    pub(super) async fn close_tmux_window(&self, window_id: &str) -> Result<bool> {
        let input = self.input.lock().await;
        let tx = input.as_ref().context("Terminal is closed")?;
        self.delegate.close_tmux_window(window_id, tx).await
    }

    #[cfg(test)]
    pub(super) fn ready(&self) -> bool {
        self.delegate.ready()
    }

    #[cfg(test)]
    pub(super) fn recording(tx: WriterSender, delegate: Arc<dyn PtyDelegate>) -> Self {
        Self {
            master: Mutex::new(None),
            child: Mutex::new(None),
            input: Mutex::new(Some(tx)),
            exited: Arc::new(AtomicBool::new(false)),
            error: Arc::new(Mutex::new(None)),
            delegate,
            parser: OnceLock::new(),
        }
    }

    #[cfg(test)]
    pub(super) fn set_error(&self, error: PtyError) {
        *self.error.blocking_lock() = Some(error);
    }

    pub fn exited(&self) -> bool {
        let mut child = self.child.blocking_lock();
        if let Some(child) = child.as_mut()
            && matches!(child.try_wait(), Ok(Some(_)))
        {
            self.exited.store(true, Ordering::Release);
        }
        self.exited.load(Ordering::Acquire)
    }

    pub fn error(&self) -> Option<anyhow::Error> {
        self.error
            .blocking_lock()
            .as_ref()
            .map(|error| anyhow::Error::new(error.clone()))
    }

    pub async fn close(&self) {
        self.close_transport(false).await;
    }

    pub async fn detach(&self) {
        self.close_transport(true).await;
    }

    async fn close_transport(&self, preserve: bool) {
        let mut input = self.input.lock().await;
        let Some(tx) = input.take() else { return };
        if let Some(parser) = self.parser.get() {
            parser.abort();
        }
        let child = self.child.lock().await.take();
        shutdown(&*self.delegate, tx, child, preserve).await;
        self.master.lock().await.take();
        self.exited.store(true, Ordering::Release);
    }
}

async fn shutdown(
    delegate: &dyn PtyDelegate,
    tx: WriterSender,
    child: Option<Box<dyn Child + Send + Sync>>,
    preserve: bool,
) {
    let grace = delegate.close(preserve, &tx).await;
    let _ = tx.send(WriterMessage::Close(grace));
    if let Some(mut child) = child {
        RUNTIME.spawn_blocking(move || {
            let deadline = Instant::now() + grace;
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                thread::sleep(Duration::from_millis(10));
            }
            let _ = child.kill();
            let _ = child.wait();
        });
    }
}

impl Drop for Pty {
    fn drop(&mut self) {
        let Some(tx) = self.input.get_mut().take() else {
            return;
        };
        if let Some(parser) = self.parser.get() {
            parser.abort();
        }
        let child = self.child.get_mut().take();
        let master = self.master.get_mut().take();
        let delegate = self.delegate.clone();
        let detach = async move {
            shutdown(&*delegate, tx, child, true).await;
            drop(master);
        };
        // The last session reference can be released by the async parser.
        if tokio::runtime::Handle::try_current().is_ok() {
            RUNTIME.spawn(detach);
        } else {
            block_on(detach);
        }
    }
}

fn write_loop(
    mut writer: Box<dyn Write + Send>,
    mut rx: UnboundedReceiver<WriterMessage>,
    error: Arc<Mutex<Option<PtyError>>>,
    exited: Arc<AtomicBool>,
) {
    loop {
        match rx.blocking_recv() {
            Some(WriterMessage::Data(bytes)) => {
                if let Err(err) = writer.write_all(&bytes).and_then(|()| writer.flush()) {
                    *error.blocking_lock() = Some(
                        anyhow::Error::new(err)
                            .context("Write PTY input")
                            .into_boxed_dyn_error()
                            .into(),
                    );
                    exited.store(true, Ordering::Release);
                    break;
                }
            }
            Some(WriterMessage::Close(linger)) => {
                thread::sleep(linger);
                break;
            }
            None => break,
        }
    }
}

fn read_loop(mut reader: Box<dyn Read + Send>, tx: Sender<ReadEvent>, exited: Arc<AtomicBool>) {
    let mut buffer = [0; 16384];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => {
                let _ = tx.blocking_send(ReadEvent::Eof);
                break;
            }
            Ok(count) => {
                if tx
                    .blocking_send(ReadEvent::Data(buffer[..count].to_vec()))
                    .is_err()
                {
                    break;
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(err) if crate::platform::pty_reader_closed(&err) => {
                let _ = tx.blocking_send(ReadEvent::Eof);
                break;
            }
            Err(err) => {
                let _ = tx.blocking_send(ReadEvent::Error(
                    anyhow::Error::new(err)
                        .context("Read PTY output")
                        .into_boxed_dyn_error()
                        .into(),
                ));
                break;
            }
        }
    }
    exited.store(true, Ordering::Release);
}

impl PtyOutput {
    async fn parse(mut self, session: Weak<TerminalSession>) {
        loop {
            let event = self.events.recv().await;
            let Some(session) = session.upgrade() else {
                return;
            };
            let error = match event {
                Some(ReadEvent::Data(bytes)) => {
                    match session.process_output(&bytes, &self.writer).await {
                        Ok(()) => continue,
                        Err(err) => Some(
                            err.context("Process terminal output")
                                .into_boxed_dyn_error()
                                .into(),
                        ),
                    }
                }
                Some(ReadEvent::Error(err)) => Some(err),
                Some(ReadEvent::Eof) | None => None,
            };
            if let Some(error) = error {
                *session.pty.error.lock().await = Some(error);
            }
            let _ = self.writer.send(WriterMessage::Close(Duration::ZERO));
            session.pty.exited.store(true, Ordering::Release);
            return;
        }
    }
}

fn pty_size(size: GridSize) -> PtySize {
    PtySize {
        rows: size.rows as u16,
        cols: size.columns as u16,
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[cfg(test)]
#[path = "../tests/pty.rs"]
mod tests;
