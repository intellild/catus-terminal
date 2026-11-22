//! Shared PTY ownership: blocking portable-pty threads bridged to an async core.
mod delegate;
mod plain;
mod tmux;
use super::grid::{GridReply, GridSize, TerminalGrid};
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
        oneshot,
    },
    task::AbortHandle,
};

type PtyError = Arc<dyn std::error::Error + Send + Sync>;

enum ParserEvent {
    Data(Vec<u8>),
    Eof,
    Error(PtyError),
    Resize(PtySize, Option<oneshot::Sender<Result<()>>>),
}

/// Channels for consuming PTY output and sending parser replies.
pub(super) struct PtyOutput {
    events: Receiver<ParserEvent>,
    replies: UnboundedReceiver<GridReply>,
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

/// Block on the internal async PTY API from UI and Node threads.
///
/// The same runtime also runs the parser task, so this must never be called
/// from inside that task (or any other async context).
pub(crate) fn block_on<F: Future>(future: F) -> F::Output {
    RUNTIME.block_on(future)
}

pub(crate) struct Pty {
    events: Sender<ParserEvent>,
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
            .openpty(size.into())
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
        let (reply_tx, replies) = unbounded_channel();
        // tmux answers VT queries on the host.
        let grid = TerminalGrid::new(size, (!delegate.answers_queries()).then_some(reply_tx));
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
        let (events, read_rx) = channel(16);
        let read_tx = events.clone();
        let read_exited = exited.clone();
        thread::Builder::new()
            .name("terminal-pty-reader".into())
            .spawn(move || read_loop(reader, read_tx, read_exited))
            .context("Start PTY reader thread")?;

        let output = PtyOutput {
            events: read_rx,
            replies,
            writer: write_tx.clone(),
        };
        let pty = Self {
            events,
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

    async fn send_replies(
        &self,
        replies: &mut UnboundedReceiver<GridReply>,
        writer: &WriterSender,
    ) {
        while let Ok(reply) = replies.try_recv() {
            let text = match reply {
                GridReply::Text(text) => text,
                GridReply::TextAreaSize => {
                    let size = self
                        .master
                        .lock()
                        .await
                        .as_ref()
                        .and_then(|master| master.get_size().ok())
                        .unwrap_or_default();
                    // XTWINOPS reports the text area's pixel height before its width.
                    format!("\x1b[4;{};{}t", size.pixel_height, size.pixel_width)
                }
            };
            let _ = writer.send(WriterMessage::Data(text.into_bytes()));
        }
    }

    pub(super) async fn write(&self, bytes: Vec<u8>) -> Result<()> {
        if self.exited.load(Ordering::Acquire) {
            return Err(anyhow!("Shell has exited"));
        }
        let input = self.input.lock().await;
        let tx = input.as_ref().context("Terminal is closed")?;
        self.delegate.input(bytes, tx).await
    }

    pub(super) fn resize_and_wait(&self, window: PtySize) -> Result<()> {
        let (done, result) = oneshot::channel();
        self.events
            .blocking_send(ParserEvent::Resize(window, Some(done)))
            .map_err(|_| anyhow!("Terminal parser has stopped"))?;
        result.blocking_recv().context("Wait for terminal resize")?
    }

    #[cfg(feature = "native-view")]
    pub(crate) fn try_resize(&self, window: PtySize) -> Result<bool> {
        use tokio::sync::mpsc::error::TrySendError;
        match self.events.try_send(ParserEvent::Resize(window, None)) {
            Ok(()) => Ok(true),
            Err(TrySendError::Full(_)) => Ok(false),
            Err(TrySendError::Closed(_)) => Err(anyhow!("Terminal parser has stopped")),
        }
    }

    pub(super) async fn resize(
        &self,
        window: PtySize,
        grid_resize: Option<GridSize>,
    ) -> Result<()> {
        let input = self.input.lock().await;
        if let Some(tx) = input.as_ref() {
            if let Some(master) = self.master.lock().await.as_deref()
                && master.get_size().ok() != Some(window)
            {
                master.resize(window).context("Resize terminal PTY")?;
            }
            if let Some(size) = grid_resize {
                self.delegate.resize(size, tx).await?;
            }
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
    while let Some(message) = rx.blocking_recv() {
        let bytes = match message {
            WriterMessage::Data(bytes) => bytes,
            WriterMessage::Close(linger) => {
                thread::sleep(linger);
                break;
            }
        };
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
}

fn read_loop(mut reader: Box<dyn Read + Send>, tx: Sender<ParserEvent>, exited: Arc<AtomicBool>) {
    let mut buffer = [0; 16384];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => {
                let _ = tx.blocking_send(ParserEvent::Eof);
                break;
            }
            Ok(count) => {
                if tx
                    .blocking_send(ParserEvent::Data(buffer[..count].to_vec()))
                    .is_err()
                {
                    break;
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(err) if crate::platform::pty_reader_closed(&err) => {
                let _ = tx.blocking_send(ParserEvent::Eof);
                break;
            }
            Err(err) => {
                let _ = tx.blocking_send(ParserEvent::Error(
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
        let mut reading = true;
        while let Some(event) = self.events.recv().await {
            let Some(session) = session.upgrade() else {
                return;
            };
            let error = match event {
                ParserEvent::Resize(window, completion) => {
                    let result = session.apply_resize(window, reading).await;
                    if let Some(completion) = completion {
                        let _ = completion.send(result);
                    } else if let Err(error) = result {
                        eprintln!("Resize terminal: {error:#}");
                    }
                    continue;
                }
                _ if !reading => continue,
                ParserEvent::Data(bytes) => {
                    let result = session.process_output(&bytes, &self.writer).await;
                    session
                        .pty
                        .send_replies(&mut self.replies, &self.writer)
                        .await;
                    match result {
                        Ok(()) => continue,
                        Err(err) => Some(
                            err.context("Process terminal output")
                                .into_boxed_dyn_error()
                                .into(),
                        ),
                    }
                }
                ParserEvent::Error(err) => Some(err),
                ParserEvent::Eof => None,
            };
            if let Some(error) = error {
                *session.pty.error.lock().await = Some(error);
            }
            let _ = self.writer.send(WriterMessage::Close(Duration::ZERO));
            session.pty.exited.store(true, Ordering::Release);
            // Keep the final screen resizable until the session is closed.
            reading = false;
        }
    }
}

impl From<GridSize> for PtySize {
    fn from(size: GridSize) -> Self {
        Self {
            rows: size.rows as u16,
            cols: size.columns as u16,
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}
