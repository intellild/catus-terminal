//! Alacritty history/selection and terminal mouse reporting; no OS/GPU APIs.
use super::TerminalGrid;
use alacritty_terminal::grid::Dimensions;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScrollState {
    pub offset: usize,
    pub history_rows: usize,
    pub visible_rows: usize,
}
use alacritty_terminal::{
    grid::Scroll,
    index::{Column, Point, Side},
    selection::{Selection, SelectionType},
    term::{TermMode, viewport_to_point},
};

#[derive(Clone, Copy, Default)]
pub struct MouseModifiers {
    pub shift: bool,
    pub control: bool,
    pub alt: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PointerAction {
    Down,
    Move,
    Up,
    Cancel,
}

impl TerminalGrid {
    pub fn paste(&self, text: &str) -> Vec<u8> {
        if self.term.mode().contains(TermMode::BRACKETED_PASTE) {
            // Match Alacritty: prevent pasted ESC/Ctrl-C from prematurely
            // ending bracketed paste, and send the complete paste as one packet.
            let text = text.replace(['\x1b', '\x03'], "");
            let mut bytes = Vec::with_capacity(text.len() + 12);
            bytes.extend_from_slice(b"\x1b[200~");
            bytes.extend_from_slice(text.as_bytes());
            bytes.extend_from_slice(b"\x1b[201~");
            bytes
        } else {
            // Without bracketed mode, line breaks behave like the Enter key.
            text.replace("\r\n", "\r").replace('\n', "\r").into_bytes()
        }
    }
    pub fn scroll_state(&self) -> ScrollState {
        ScrollState {
            offset: self.term.grid().display_offset(),
            history_rows: self.term.grid().history_size(),
            visible_rows: self.size.rows,
        }
    }
    pub fn scroll_to(&mut self, offset: usize) {
        let before = self.term.grid().display_offset();
        let target = offset.min(self.term.grid().history_size());
        self.term
            .scroll_display(Scroll::Delta(target as i32 - before as i32));
        if self.term.grid().display_offset() != before {
            self.changed();
        }
    }
    pub fn scroll_multiplier(&self, modifiers: MouseModifiers) -> f64 {
        if self.term.mode().intersects(TermMode::MOUSE_MODE) && !modifiers.shift {
            1.
        } else {
            3.
        }
    }
    pub fn selected_text(&self) -> Option<String> {
        self.term.selection_to_string()
    }

    pub fn clear_interaction(&mut self) {
        let changed =
            self.term.selection.take().is_some() || self.term.grid().display_offset() != 0;
        self.term.scroll_display(Scroll::Bottom);
        if changed {
            self.changed();
        }
    }

    pub fn scroll(
        &mut self,
        lines: i32,
        row: usize,
        column: usize,
        modifiers: MouseModifiers,
    ) -> Option<Vec<u8>> {
        if lines == 0 {
            return None;
        }
        if self.term.mode().intersects(TermMode::MOUSE_MODE) && !modifiers.shift {
            let code = if lines > 0 { 64 } else { 65 };
            let mut bytes = Vec::new();
            for _ in 0..lines.unsigned_abs().min(256) {
                bytes.extend(self.mouse_report(code, row, column, false, modifiers));
            }
            return Some(bytes);
        }
        if self
            .term
            .mode()
            .contains(TermMode::ALT_SCREEN | TermMode::ALTERNATE_SCROLL)
            && !modifiers.shift
        {
            let key = if lines > 0 { "ArrowUp" } else { "ArrowDown" };
            return self
                .key(key, false, false)
                .map(|bytes| bytes.repeat(lines.unsigned_abs().min(256) as usize));
        }
        let before = self.term.grid().display_offset();
        self.term.scroll_display(Scroll::Delta(lines));
        if self.term.grid().display_offset() != before {
            self.changed();
        }
        None
    }

    #[allow(clippy::too_many_arguments)]
    pub fn pointer(
        &mut self,
        action: PointerAction,
        row: usize,
        column: usize,
        right_half: bool,
        clicks: u8,
        button: u8,
        modifiers: MouseModifiers,
    ) -> Option<Vec<u8>> {
        let row = row.min(self.size.rows - 1);
        let column = column.min(self.size.columns - 1);
        let mode = *self.term.mode();
        if mode.intersects(TermMode::MOUSE_MODE) && !modifiers.shift {
            if action == PointerAction::Cancel && button >= 3 {
                return None;
            }
            if action == PointerAction::Move
                && !mode.contains(TermMode::MOUSE_MOTION)
                && !(mode.contains(TermMode::MOUSE_DRAG) && button < 3)
            {
                return None;
            }
            let code = button + if action == PointerAction::Move { 32 } else { 0 };
            return Some(self.mouse_report(
                code,
                row,
                column,
                matches!(action, PointerAction::Up | PointerAction::Cancel),
                modifiers,
            ));
        }
        if button != 0 {
            return None;
        }
        let point = viewport_to_point(
            self.term.grid().display_offset(),
            Point::new(row, Column(column)),
        );
        let side = if right_half { Side::Right } else { Side::Left };
        match action {
            PointerAction::Down => {
                let kind = match clicks {
                    2 => SelectionType::Semantic,
                    3.. => SelectionType::Lines,
                    _ if modifiers.alt => SelectionType::Block,
                    _ => SelectionType::Simple,
                };
                self.term.selection = Some(Selection::new(kind, point, side));
                self.changed();
            }
            PointerAction::Move | PointerAction::Up => {
                if let Some(selection) = &mut self.term.selection {
                    selection.update(point, side);
                    self.changed();
                }
            }
            PointerAction::Cancel => {}
        }
        None
    }

    fn mouse_report(
        &self,
        button: u8,
        row: usize,
        column: usize,
        released: bool,
        modifiers: MouseModifiers,
    ) -> Vec<u8> {
        let mods = (u8::from(modifiers.shift) * 4)
            | (u8::from(modifiers.alt) * 8)
            | (u8::from(modifiers.control) * 16);
        if self.term.mode().contains(TermMode::SGR_MOUSE) {
            return format!(
                "\x1b[<{};{};{}{}",
                button + mods,
                column + 1,
                row + 1,
                if released { 'm' } else { 'M' }
            )
            .into_bytes();
        }
        let utf8 = self.term.mode().contains(TermMode::UTF8_MOUSE);
        let limit = if utf8 { 2015 } else { 223 };
        if row >= limit || column >= limit {
            return Vec::new();
        }
        let mut bytes = vec![
            0x1b,
            b'[',
            b'M',
            32 + if released { 3 + mods } else { button + mods },
        ];
        for value in [column + 33, row + 33] {
            if utf8 {
                let mut encoded = [0; 4];
                bytes.extend_from_slice(
                    char::from_u32(value as u32)
                        .unwrap()
                        .encode_utf8(&mut encoded)
                        .as_bytes(),
                );
            } else {
                bytes.push(value as u8);
            }
        }
        bytes
    }
}

#[cfg(test)]
#[path = "../tests/terminal_interaction.rs"]
mod tests;
