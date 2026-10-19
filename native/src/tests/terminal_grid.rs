use super::*;
use crate::terminal_core::pty::{message_data, test_channel, test_sender};
fn grid(columns: usize, rows: usize) -> TerminalGrid {
    TerminalGrid::new(GridSize::new(columns, rows), test_sender())
}
#[test]
fn split_utf8_ansi_colors_wide_and_combining_cells() {
    let mut grid = grid(12, 3);
    let bytes = "\x1b[31;1mA中e\u{301}\x1b[0m".as_bytes();
    for byte in bytes {
        grid.advance(&[*byte]);
    }
    let snapshot = grid.snapshot();
    assert_eq!(snapshot.cells[0].characters, vec!['A']);
    assert!(snapshot.cells[0].bold);
    assert_eq!(snapshot.cells[0].foreground, palette(1));
    assert!(snapshot.cells[1].wide);
    assert!(snapshot.cells[2].characters.is_empty());
    assert_eq!(snapshot.cells[3].characters, vec!['e', '\u{301}']);
    assert_eq!(snapshot.cursor.unwrap().column, 4);
}
#[test]
fn carriage_return_erase_alt_screen_and_resize() {
    let mut grid = grid(8, 3);
    grid.advance(b"progress\rOK\x1b[K");
    assert_eq!(grid.snapshot().text().lines().next(), Some("OK"));
    grid.advance(b"\x1b[?1049hALT");
    assert!(grid.snapshot().text().contains("ALT"));
    grid.advance(b"\x1b[?1049l");
    assert!(grid.snapshot().text().contains("OK"));
    grid.resize(GridSize::new(12, 4));
    let snapshot = grid.snapshot();
    assert_eq!(snapshot.cells.len(), 48);
    assert!(snapshot.text().contains("OK"));
}
#[test]
fn terminal_replies_and_application_cursor_keys() {
    let (tx, mut rx) = test_channel();
    let mut grid = TerminalGrid::new(GridSize::new(80, 24), tx);
    grid.advance(b"\x1b[6n");
    assert_eq!(message_data(rx.try_recv().unwrap()), b"\x1b[1;1R");
    grid.resize(GridSize::new(100, 30));
    grid.advance(b"\x1b[18t");
    assert_eq!(message_data(rx.try_recv().unwrap()), b"\x1b[8;30;100t");
    grid.advance(b"\x1b[?1h");
    assert_eq!(grid.key("ArrowUp", false, false).unwrap(), b"\x1bOA");
    assert_eq!(grid.key("c", true, false).unwrap(), [3]);
}
