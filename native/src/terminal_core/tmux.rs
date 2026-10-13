//! tmux control protocol; only decoded pane bytes enter the terminal VT parser.
use super::grid::{GridSize, TerminalGrid};
use anyhow::{Context, Result, bail, ensure};
use napi_derive::napi;
use std::{collections::VecDeque, sync::mpsc::Sender};

#[napi(object)]
#[derive(Clone)]
pub struct TmuxOptions {
    pub session: String,
    pub window: String,
    pub command: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Copy)]
enum Reply {
    Attach,
    Panes,
    Create,
    Resize,
    Saved,
    Screen,
    State,
    Pending,
    Ignore,
}
struct Block {
    guard: Vec<u8>,
    reply: Reply,
    lines: Vec<Vec<u8>>,
}

pub struct TmuxClient {
    options: TmuxOptions,
    size: GridSize,
    buffer: Vec<u8>,
    block: Option<Block>,
    replies: VecDeque<Reply>,
    pane: Option<String>,
    window: Option<String>,
    started: bool,
    protocol: bool,
    closed: bool,
    syncing: bool,
    sync_again: bool,
    live: bool,
    saved: Vec<Vec<u8>>,
    screen: Vec<Vec<u8>>,
    state: Vec<u8>,
    output: Vec<u8>,
    input: Vec<Vec<u8>>,
}

impl TmuxClient {
    pub fn new(options: TmuxOptions, size: GridSize) -> Self {
        Self {
            options,
            size,
            buffer: vec![],
            block: None,
            replies: VecDeque::from([Reply::Attach]),
            pane: None,
            window: None,
            started: false,
            protocol: false,
            closed: false,
            syncing: false,
            sync_again: false,
            live: false,
            saved: vec![],
            screen: vec![],
            state: vec![],
            output: vec![],
            input: vec![],
        }
    }

    fn command(&mut self, command: String, reply: Reply, tx: &Sender<Vec<u8>>) -> Result<()> {
        tx.send(format!("{command}\n").into_bytes())
            .context("Send tmux command")?;
        self.replies.push_back(reply);
        Ok(())
    }

    pub fn input(&mut self, bytes: Vec<u8>, tx: &Sender<Vec<u8>>) -> Result<()> {
        ensure!(!self.closed, "tmux connection is closed");
        if !self.protocol {
            // SSH authentication prompts are still ordinary PTY traffic.
            tx.send(bytes).context("Write tmux connection input")?;
        } else if self.pane.is_none() || !self.live || self.syncing {
            self.input.push(bytes);
        } else {
            self.send_keys(&bytes, tx)?;
        }
        Ok(())
    }

    fn send_keys(&mut self, bytes: &[u8], tx: &Sender<Vec<u8>>) -> Result<()> {
        let pane = self.pane.as_ref().context("Missing tmux pane")?.clone();
        // Literal hex bytes preserve Unicode, NUL, paste markers and escape keys,
        // without interpreting user text as control commands or shell syntax.
        for chunk in bytes.chunks(256) {
            let hex = chunk
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<Vec<_>>()
                .join(" ");
            self.command(format!("send-keys -t {pane} -H {hex}"), Reply::Ignore, tx)?;
        }
        Ok(())
    }

    pub fn resize(&mut self, size: GridSize, tx: &Sender<Vec<u8>>) -> Result<()> {
        self.size = size;
        if let Some(window) = &self.window {
            // Each tab owns a window. Explicit window sizing avoids one tab's
            // viewport changing every other window attached to the workspace.
            self.command(
                format!(
                    "resize-window -t {window} -x {} -y {}",
                    size.columns, size.rows
                ),
                Reply::Resize,
                tx,
            )?;
        }
        Ok(())
    }

    pub fn close(&mut self, preserve: bool, tx: &Sender<Vec<u8>>) {
        if self.closed {
            return;
        }
        self.closed = true;
        if !preserve {
            // Exact session/window names also work when closed during startup.
            let target = self
                .window
                .clone()
                .unwrap_or_else(|| format!("={}:={}", self.options.session, self.options.window));
            let _ = tx.send(format!("kill-window -t {}\n", quote(&target)).into_bytes());
        }
        let _ = tx.send(b"detach-client\n".to_vec());
    }

    pub fn advance(
        &mut self,
        bytes: &[u8],
        grid: &mut TerminalGrid,
        tx: &Sender<Vec<u8>>,
    ) -> Result<()> {
        self.buffer.extend_from_slice(bytes);
        if !self.protocol {
            let marker = b"\x1bP1000p";
            if let Some(start) = self
                .buffer
                .windows(marker.len())
                .position(|part| part == marker)
            {
                grid.advance(&self.buffer[..start]);
                self.buffer.drain(..start + marker.len());
                self.protocol = true;
            } else {
                // Retain only a possible fragmented DCS prefix; show authentication
                // prompts immediately, even when they have no terminating newline.
                let suffix = (1..marker.len())
                    .rev()
                    .find(|&length| self.buffer.ends_with(&marker[..length]))
                    .unwrap_or(0);
                let end = self.buffer.len() - suffix;
                grid.advance(&self.buffer[..end]);
                self.buffer.drain(..end);
                return Ok(());
            }
        }
        ensure!(
            self.buffer.len() <= 16 * 1024 * 1024,
            "tmux protocol line exceeds 16 MiB"
        );
        while let Some(end) = self.buffer.iter().position(|&b| b == b'\n') {
            let mut line: Vec<_> = self.buffer.drain(..=end).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            // -CC wraps the protocol in DCS; it may arrive fragmented across reads.
            if line.starts_with(b"\x1bP1000p") {
                line.drain(..7);
            }
            self.line(line, grid, tx)?;
        }
        Ok(())
    }

    fn line(&mut self, line: Vec<u8>, grid: &mut TerminalGrid, tx: &Sender<Vec<u8>>) -> Result<()> {
        if let Some(block) = &mut self.block {
            let end = line.strip_prefix(b"%end ");
            let error = line.strip_prefix(b"%error ");
            if end == Some(block.guard.as_slice()) || error == Some(block.guard.as_slice()) {
                let block = self.block.take().unwrap();
                if error.is_some() && !self.closed {
                    bail!(
                        "tmux command failed: {}",
                        String::from_utf8_lossy(&block.lines.join(&b'\n'))
                    );
                }
                if !self.closed {
                    self.complete(block, grid, tx)?;
                }
            } else {
                block.lines.push(line);
            }
            return Ok(());
        }
        if let Some(guard) = line.strip_prefix(b"%begin ") {
            let flags = guard.rsplit(|&b| b == b' ').next().unwrap_or_default();
            let reply = if !self.started || flags == b"1" {
                self.replies.pop_front().unwrap_or(Reply::Ignore)
            } else {
                Reply::Ignore
            };
            self.started = true;
            self.block = Some(Block {
                guard: guard.to_vec(),
                reply,
                lines: vec![],
            });
        } else if let Some(output) = line.strip_prefix(b"%output ") {
            if let Some(space) = output.iter().position(|&b| b == b' ')
                && self
                    .pane
                    .as_ref()
                    .is_some_and(|pane| pane.as_bytes() == &output[..space])
            {
                let bytes = unescape(&output[space + 1..])?;
                if self.live && !self.syncing {
                    grid.advance(&bytes);
                } else if self.live {
                    self.output.extend(bytes);
                }
            }
        } else if line.starts_with(b"%exit") {
            if !self.closed && !self.live {
                bail!("tmux connection exited before the pane was ready");
            }
        } else if !self.started {
            // Show SSH prompts and startup failures without feeding protocol text.
            grid.advance(&line);
            grid.advance(b"\r\n");
        }
        Ok(())
    }

    fn complete(
        &mut self,
        block: Block,
        grid: &mut TerminalGrid,
        tx: &Sender<Vec<u8>>,
    ) -> Result<()> {
        match block.reply {
            Reply::Attach => self.command(
                format!(
                    "list-panes -s -t {} -F '#{{window_name}} #{{pane_id}} #{{window_id}}'",
                    quote(&self.options.session)
                ),
                Reply::Panes,
                tx,
            )?,
            Reply::Panes => {
                let prefix = format!("{} ", self.options.window);
                if let Some(line) = block
                    .lines
                    .iter()
                    .find_map(|line| line.strip_prefix(prefix.as_bytes()))
                {
                    self.bind(line, tx)?;
                } else {
                    let command = if self.options.command.is_empty() {
                        String::new()
                    } else {
                        format!(" {}", quote(&self.options.command))
                    };
                    self.command(format!("new-window -d -t {} -n {} -c {} -P -F '#{{pane_id}} #{{window_id}}'{command}",
                        quote(&self.options.session), quote(&self.options.window), quote(&self.options.cwd)), Reply::Create, tx)?;
                }
            }
            Reply::Create => self.bind(
                block
                    .lines
                    .first()
                    .context("tmux did not return a pane ID")?,
                tx,
            )?,
            Reply::Resize => {
                if self.syncing {
                    self.sync_again = true;
                } else {
                    self.synchronize(tx)?;
                }
            }
            Reply::Saved => self.saved = block.lines,
            Reply::Screen => {
                self.screen = block.lines;
                // Earlier output is represented in the snapshot. Only later
                // notifications are replayed after restoring the cursor/modes.
                self.output.clear();
                self.live = true;
            }
            Reply::State => {
                self.state = block
                    .lines
                    .first()
                    .cloned()
                    .context("Missing tmux pane state")?
            }
            Reply::Pending => {
                self.restore(grid)?;
                for line in block.lines {
                    grid.advance(&unescape(&line)?);
                }
                grid.advance(&self.output);
                self.output.clear();
                self.syncing = false;
                if self.sync_again {
                    self.sync_again = false;
                    self.synchronize(tx)?;
                } else {
                    for bytes in std::mem::take(&mut self.input) {
                        self.send_keys(&bytes, tx)?;
                    }
                }
            }
            Reply::Ignore => {}
        }
        Ok(())
    }

    fn bind(&mut self, line: &[u8], tx: &Sender<Vec<u8>>) -> Result<()> {
        let text = std::str::from_utf8(line).context("Decode tmux pane IDs")?;
        let mut ids = text.split_whitespace();
        let pane = ids.next().context("Missing tmux pane ID")?;
        let window = ids.next().context("Missing tmux window ID")?;
        ensure!(
            valid_id(pane, '%') && valid_id(window, '@'),
            "Invalid tmux pane/window IDs"
        );
        self.pane = Some(pane.into());
        self.window = Some(window.into());
        self.command(
            format!("set-window-option -t {window} automatic-rename off"),
            Reply::Ignore,
            tx,
        )?;
        self.command(
            format!("set-window-option -t {window} allow-rename off"),
            Reply::Ignore,
            tx,
        )?;
        self.resize(self.size, tx)
    }

    fn synchronize(&mut self, tx: &Sender<Vec<u8>>) -> Result<()> {
        self.syncing = true;
        self.live = false;
        let pane = self.pane.as_ref().context("Missing tmux pane")?.clone();
        self.command(
            format!("capture-pane -p -a -q -e -C -J -t {pane}"),
            Reply::Saved,
            tx,
        )?;
        self.command(
            format!("capture-pane -p -e -C -J -S - -t {pane}"),
            Reply::Screen,
            tx,
        )?;
        let fields = [
            "pane_width",
            "pane_height",
            "cursor_x",
            "cursor_y",
            "alternate_on",
            "cursor_flag",
            "insert_flag",
            "keypad_cursor_flag",
            "keypad_flag",
            "wrap_flag",
            "mouse_all_flag",
            "mouse_button_flag",
            "mouse_standard_flag",
            "mouse_utf8_flag",
            "mouse_sgr_flag",
            "scroll_region_upper",
            "scroll_region_lower",
            "origin_flag",
            "pane_private_modes",
        ];
        let format = fields.map(|field| format!("#{{{field}}}")).join("|");
        self.command(
            format!("display-message -p -t {pane} '{}'", format),
            Reply::State,
            tx,
        )?;
        self.command(
            format!("capture-pane -p -P -C -t {pane}"),
            Reply::Pending,
            tx,
        )
    }

    fn restore(&self, grid: &mut TerminalGrid) -> Result<()> {
        let state = std::str::from_utf8(&self.state).context("Decode tmux pane state")?;
        let fields: Vec<_> = state.split('|').collect();
        ensure!(fields.len() == 19, "Incomplete tmux pane state");
        let number = |index: usize| -> Result<usize> {
            fields[index].parse().context("Invalid tmux pane state")
        };
        grid.resize(GridSize::new(number(0)?, number(1)?));
        grid.advance(b"\x1bc");
        if fields[4] == "1" {
            paint(grid, &self.saved)?;
            grid.advance(b"\x1b[?1049h");
        }
        paint(grid, &self.screen)?;
        grid.advance(b"\x1b[0m");
        grid.advance(format!("\x1b[{};{}r", number(15)? + 1, number(16)? + 1).as_bytes());
        for (index, mode) in [
            (5, 25),
            (7, 1),
            (9, 7),
            (10, 1003),
            (11, 1002),
            (12, 1000),
            (13, 1005),
            (14, 1006),
            (17, 6),
        ] {
            grid.advance(
                format!(
                    "\x1b[?{mode}{}",
                    if fields[index] == "1" { 'h' } else { 'l' }
                )
                .as_bytes(),
            );
        }
        grid.advance(if fields[6] == "1" {
            b"\x1b[4h"
        } else {
            b"\x1b[4l"
        });
        grid.advance(if fields[8] == "1" { b"\x1b=" } else { b"\x1b>" });
        // tmux 3.7+ exposes all private modes, including bracketed paste.
        for mode in fields[18].split(',').filter(|s| !s.is_empty()) {
            let mode: u16 = mode.parse().context("Invalid tmux private mode")?;
            grid.advance(format!("\x1b[?{mode}h").as_bytes());
        }
        let row = if fields[17] == "1" {
            number(3)?.saturating_sub(number(15)?)
        } else {
            number(3)?
        };
        grid.advance(format!("\x1b[{};{}H", row + 1, number(2)? + 1).as_bytes());
        Ok(())
    }
}

fn paint(grid: &mut TerminalGrid, lines: &[Vec<u8>]) -> Result<()> {
    for (index, line) in lines.iter().enumerate() {
        if index != 0 {
            grid.advance(b"\r\n");
        }
        grid.advance(&unescape_bytes(line, true).context("Decode tmux capture line")?);
    }
    Ok(())
}
fn valid_id(value: &str, prefix: char) -> bool {
    value.starts_with(prefix) && value.len() > 1 && value[1..].bytes().all(|b| b.is_ascii_digit())
}
fn quote(value: &str) -> String {
    let mut result = String::from("\"");
    for ch in value.chars() {
        match ch {
            '\\' | '"' | '$' => {
                result.push('\\');
                result.push(ch);
            }
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            _ => result.push(ch),
        }
    }
    result.push('"');
    result
}
fn unescape(bytes: &[u8]) -> Result<Vec<u8>> {
    unescape_bytes(bytes, false)
}
fn unescape_bytes(bytes: &[u8], capture: bool) -> Result<Vec<u8>> {
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\\' {
            // capture-pane -C escapes a literal backslash as \\, whereas
            // %output and capture-pane -P -C use octal \134.
            if capture && bytes.get(index + 1) == Some(&b'\\') {
                output.push(b'\\');
                index += 2;
                continue;
            }
            ensure!(index + 3 < bytes.len(), "Incomplete tmux octal escape");
            let octal = &bytes[index + 1..index + 4];
            ensure!(
                octal.iter().all(|b| (b'0'..=b'7').contains(b)),
                "Invalid tmux octal escape"
            );
            let value = ((octal[0] - b'0') as u16) * 64
                + ((octal[1] - b'0') as u16) * 8
                + (octal[2] - b'0') as u16;
            ensure!(value <= 255, "tmux octal escape exceeds a byte");
            output.push(value as u8);
            index += 4;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    Ok(output)
}

#[cfg(test)]
#[path = "../tests/tmux.rs"]
mod tests;
