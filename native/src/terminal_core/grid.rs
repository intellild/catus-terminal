//! Terminal computation only: streaming VT parser -> an owned, GPU-independent grid.
use alacritty_terminal::{
    event::{Event, EventListener, WindowSize},
    grid::Dimensions,
    term::{Config, Term, TermMode, cell::Flags, color::Colors, point_to_viewport},
    vte::ansi::{Color, CursorShape, NamedColor, Processor, Rgb},
};
use std::sync::{Arc, Mutex, mpsc::Sender};

pub const BACKGROUND: [u8; 3] = [17, 20, 25];
pub const FOREGROUND: [u8; 3] = [216, 222, 229];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GridSize {
    pub columns: usize,
    pub rows: usize,
}
impl GridSize {
    pub fn new(columns: usize, rows: usize) -> Self {
        Self {
            columns: columns.clamp(2, 512),
            rows: rows.clamp(1, 256),
        }
    }
}
impl Dimensions for GridSize {
    fn total_lines(&self) -> usize {
        self.rows
    }
    fn screen_lines(&self) -> usize {
        self.rows
    }
    fn columns(&self) -> usize {
        self.columns
    }
}

#[derive(Clone, Debug)]
pub struct DisplayCell {
    pub row: usize,
    pub column: usize,
    pub characters: Vec<char>,
    pub foreground: [u8; 3],
    pub background: [u8; 3],
    pub bold: bool,
    pub wide: bool,
    pub underline: bool,
    pub strikeout: bool,
}
#[derive(Clone, Debug)]
pub struct DisplayCursor {
    pub row: usize,
    pub column: usize,
    pub shape: CursorShape,
    pub wide: bool,
    pub color: [u8; 3],
}
#[derive(Clone, Debug)]
pub struct GridSnapshot {
    pub size: GridSize,
    pub revision: u64,
    pub cells: Vec<DisplayCell>,
    pub cursor: Option<DisplayCursor>,
    pub insertion_point: Option<(usize, usize)>,
    pub background: [u8; 3],
}
impl GridSnapshot {
    // Composition is a display overlay; it never changes the VT grid or PTY stream.
    #[cfg(any(feature = "native-view", test))]
    pub(crate) fn overlay_preedit(&mut self, text: &str) {
        use unicode_width::UnicodeWidthChar;
        if text.is_empty() {
            return;
        }
        let Some((mut row, mut column)) = self.insertion_point else {
            return;
        };
        self.cursor = None;
        let mut appended = false;
        for character in text.chars() {
            let width = character.width().unwrap_or(0);
            if width == 0 {
                if appended && let Some(cell) = self.cells.last_mut() {
                    cell.characters.push(character);
                }
                continue;
            }
            if column + width > self.size.columns {
                column = 0;
                row += 1;
            }
            if row >= self.size.rows {
                break;
            }
            self.cells.retain(|cell| {
                cell.row != row
                    || cell.column + (if cell.wide { 2 } else { 1 }) <= column
                    || cell.column >= column + width
            });
            self.cells.push(DisplayCell {
                row,
                column,
                characters: vec![character],
                foreground: FOREGROUND,
                background: self.background,
                bold: false,
                wide: width > 1,
                underline: true,
                strikeout: false,
            });
            appended = true;
            column += width;
        }
    }

    pub fn text(&self) -> String {
        let mut rows = vec![vec![' '; self.size.columns]; self.size.rows];
        for cell in &self.cells {
            if let Some(character) = cell.characters.first() {
                rows[cell.row][cell.column] = *character;
            }
        }
        rows.into_iter()
            .map(|row| row.into_iter().collect::<String>().trim_end().to_owned())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

struct Listener {
    replies: Sender<Vec<u8>>,
    size: Arc<Mutex<GridSize>>,
}
impl EventListener for Listener {
    fn send_event(&self, event: Event) {
        let reply = match event {
            Event::PtyWrite(text) => text,
            Event::ColorRequest(index, format) => {
                let [r, g, b] = palette(index);
                format(Rgb { r, g, b })
            }
            Event::TextAreaSizeRequest(format) => {
                let size = *self.size.lock().unwrap();
                format(WindowSize {
                    num_cols: size.columns as u16,
                    num_lines: size.rows as u16,
                    cell_width: 0,
                    cell_height: 0,
                })
            }
            _ => return,
        };
        let _ = self.replies.send(reply.into_bytes());
    }
}

pub struct TerminalGrid {
    term: Term<Listener>,
    parser: Processor,
    size: GridSize,
    revision: u64,
    reported_size: Arc<Mutex<GridSize>>,
}
impl TerminalGrid {
    pub fn new(size: GridSize, replies: Sender<Vec<u8>>) -> Self {
        let reported_size = Arc::new(Mutex::new(size));
        Self {
            term: Term::new(
                Config::default(),
                &size,
                Listener {
                    replies,
                    size: reported_size.clone(),
                },
            ),
            parser: Processor::new(),
            size,
            revision: 1,
            reported_size,
        }
    }
    pub fn advance(&mut self, bytes: &[u8]) {
        self.parser.advance(&mut self.term, bytes);
        self.revision += 1;
    }
    pub fn resize(&mut self, size: GridSize) {
        if self.size != size {
            self.term.resize(size);
            *self.reported_size.lock().unwrap() = size;
            self.size = size;
            self.revision += 1;
        }
    }
    pub fn size(&self) -> GridSize {
        self.size
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn key(&self, key: &str, control: bool, alt: bool) -> Option<Vec<u8>> {
        let application = self.term.mode().contains(TermMode::APP_CURSOR);
        let bytes = match key {
            "Enter" | "Return" => "\r".to_owned(),
            "Backspace" => "\x7f".to_owned(),
            "Tab" => "\t".to_owned(),
            "Escape" => "\x1b".to_owned(),
            "ArrowUp" | "Up" => if application { "\x1bOA" } else { "\x1b[A" }.into(),
            "ArrowDown" | "Down" => if application { "\x1bOB" } else { "\x1b[B" }.into(),
            "ArrowRight" | "Right" => if application { "\x1bOC" } else { "\x1b[C" }.into(),
            "ArrowLeft" | "Left" => if application { "\x1bOD" } else { "\x1b[D" }.into(),
            "Home" => "\x1b[H".into(),
            "End" => "\x1b[F".into(),
            "Delete" => "\x1b[3~".into(),
            "PageUp" => "\x1b[5~".into(),
            "PageDown" => "\x1b[6~".into(),
            _ if key.chars().count() == 1 => {
                if control {
                    let ch = key.as_bytes()[0].to_ascii_uppercase();
                    if (b'@'..=b'_').contains(&ch) {
                        ((ch & 0x1f) as char).to_string()
                    } else if key == " " {
                        "\0".into()
                    } else {
                        return None;
                    }
                } else {
                    key.to_owned()
                }
            }
            _ => return None,
        };
        let mut bytes = bytes.into_bytes();
        if alt {
            bytes.insert(0, 0x1b);
        }
        Some(bytes)
    }
    pub fn snapshot(&self) -> GridSnapshot {
        let content = self.term.renderable_content();
        let mut cells = Vec::with_capacity(self.size.columns * self.size.rows);
        for indexed in content.display_iter {
            let Some(point) = point_to_viewport(content.display_offset, indexed.point) else {
                continue;
            };
            if point.line >= self.size.rows || point.column.0 >= self.size.columns {
                continue;
            }
            let cell = indexed.cell;
            let mut fg = color(cell.fg, content.colors);
            let mut bg = color(cell.bg, content.colors);
            if cell.flags.contains(Flags::DIM) {
                fg = fg.map(|n| (n as f32 * 0.66) as u8);
            }
            if cell.flags.contains(Flags::INVERSE) {
                std::mem::swap(&mut fg, &mut bg);
            }
            let mut characters = vec![];
            if !cell.flags.intersects(
                Flags::WIDE_CHAR_SPACER | Flags::LEADING_WIDE_CHAR_SPACER | Flags::HIDDEN,
            ) {
                characters.push(cell.c);
                characters.extend(cell.zerowidth().unwrap_or_default());
            }
            cells.push(DisplayCell {
                row: point.line,
                column: point.column.0,
                characters,
                foreground: fg,
                background: bg,
                bold: cell.flags.contains(Flags::BOLD),
                wide: cell.flags.contains(Flags::WIDE_CHAR),
                underline: cell.flags.intersects(Flags::ALL_UNDERLINES),
                strikeout: cell.flags.contains(Flags::STRIKEOUT),
            });
        }
        let cursor = if content.cursor.shape == CursorShape::Hidden {
            None
        } else {
            point_to_viewport(content.display_offset, content.cursor.point).map(|point| {
                DisplayCursor {
                    row: point.line,
                    column: point.column.0,
                    shape: content.cursor.shape,
                    wide: self.term.grid()[content.cursor.point]
                        .flags
                        .contains(Flags::WIDE_CHAR),
                    color: color(Color::Named(NamedColor::Cursor), content.colors),
                }
            })
        };
        GridSnapshot {
            insertion_point: point_to_viewport(content.display_offset, content.cursor.point)
                .map(|point| (point.line, point.column.0)),
            size: self.size,
            revision: self.revision,
            cells,
            cursor,
            background: color(Color::Named(NamedColor::Background), content.colors),
        }
    }
}
fn color(value: Color, overrides: &Colors) -> [u8; 3] {
    let rgb = match value {
        Color::Spec(rgb) => return [rgb.r, rgb.g, rgb.b],
        Color::Indexed(index) => overrides[index as usize].unwrap_or_else(|| {
            let [r, g, b] = palette(index as usize);
            Rgb { r, g, b }
        }),
        Color::Named(index) => overrides[index].unwrap_or_else(|| {
            let [r, g, b] = palette(index as usize);
            Rgb { r, g, b }
        }),
    };
    [rgb.r, rgb.g, rgb.b]
}
fn palette(index: usize) -> [u8; 3] {
    const ANSI: [[u8; 3]; 16] = [
        [29, 32, 37],
        [205, 77, 77],
        [122, 194, 126],
        [224, 190, 102],
        [108, 158, 225],
        [184, 130, 210],
        [100, 190, 192],
        [216, 222, 229],
        [99, 110, 125],
        [245, 117, 117],
        [162, 226, 160],
        [247, 217, 135],
        [151, 189, 250],
        [219, 174, 243],
        [149, 225, 227],
        [255, 255, 255],
    ];
    match index {
        0..=15 => ANSI[index],
        16..=231 => {
            let n = index - 16;
            let level = |v| if v == 0 { 0 } else { 55 + v * 40 };
            [
                level(n / 36) as u8,
                level(n / 6 % 6) as u8,
                level(n % 6) as u8,
            ]
        }
        232..=255 => [((index - 232) * 10 + 8) as u8; 3],
        257 => BACKGROUND,
        259..=266 => ANSI[index - 259].map(|n| (n as f32 * 0.66) as u8),
        268 => FOREGROUND.map(|n| (n as f32 * 0.66) as u8),
        _ => FOREGROUND,
    }
}

#[cfg(test)]
#[path = "../tests/terminal_grid.rs"]
mod tests;
