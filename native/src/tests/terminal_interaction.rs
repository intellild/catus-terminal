use super::super::GridSize;
use super::*;

fn grid() -> TerminalGrid {
    TerminalGrid::new(GridSize::new(12, 3), std::sync::mpsc::channel().0)
}
fn mods() -> MouseModifiers {
    MouseModifiers::default()
}
#[test]
fn history_scroll_and_selection_use_scrolled_points() {
    let mut grid = grid();
    grid.advance(b"zero\r\none\r\ntwo\r\nthree\r\nfour");
    let live = grid.snapshot().text();
    let before = grid.revision();
    grid.scroll(2, 0, 0, mods());
    assert_ne!(grid.snapshot().text(), live);
    assert!(grid.revision() > before);
    grid.pointer(PointerAction::Down, 0, 0, false, 1, 0, mods());
    grid.pointer(PointerAction::Move, 0, 3, true, 1, 0, mods());
    assert_eq!(grid.selected_text().as_deref(), Some("zero"));
    assert!(
        grid.snapshot()
            .cells
            .iter()
            .any(|cell| cell.background == [61, 82, 112])
    );
    grid.clear_interaction();
    assert_eq!(grid.snapshot().text(), live);
    assert!(grid.selected_text().is_none());
}
#[test]
fn semantic_line_block_and_wide_selections_use_alacritty() {
    let mut grid = grid();
    grid.advance("hello 中文\r\nsecond".as_bytes());
    grid.pointer(PointerAction::Down, 0, 2, false, 2, 0, mods());
    assert_eq!(grid.selected_text().as_deref(), Some("hello"));
    grid.pointer(PointerAction::Down, 1, 0, false, 3, 0, mods());
    assert!(grid.selected_text().unwrap().starts_with("second"));
    grid.pointer(PointerAction::Down, 0, 6, false, 1, 0, mods());
    grid.pointer(PointerAction::Up, 0, 7, true, 1, 0, mods());
    assert_eq!(grid.selected_text().as_deref(), Some("中"));
    let block = MouseModifiers {
        alt: true,
        ..mods()
    };
    grid.pointer(PointerAction::Down, 0, 0, false, 1, 0, block);
    grid.pointer(PointerAction::Up, 1, 1, true, 1, 0, block);
    assert_eq!(grid.selected_text().as_deref(), Some("he\nse"));
}
#[test]
fn sgr_mouse_and_shift_override_and_alternate_scroll() {
    let mut grid = grid();
    grid.advance(b"\x1b[?1002h\x1b[?1006hhello");
    assert_eq!(
        grid.pointer(PointerAction::Down, 1, 2, false, 1, 0, mods())
            .unwrap(),
        b"\x1b[<0;3;2M"
    );
    assert_eq!(
        grid.pointer(PointerAction::Move, 1, 3, false, 1, 0, mods())
            .unwrap(),
        b"\x1b[<32;4;2M"
    );
    assert_eq!(
        grid.pointer(PointerAction::Up, 1, 3, false, 1, 0, mods())
            .unwrap(),
        b"\x1b[<0;4;2m"
    );
    assert_eq!(grid.scroll(1, 0, 0, mods()).unwrap(), b"\x1b[<64;1;1M");
    let shift = MouseModifiers {
        shift: true,
        ..mods()
    };
    assert!(
        grid.pointer(PointerAction::Down, 0, 0, false, 2, 0, shift)
            .is_none()
    );
    assert_eq!(grid.selected_text().as_deref(), Some("hello"));
    grid.advance(b"\x1b[?1002l\x1b[?1049h");
    assert_eq!(grid.scroll(-2, 0, 0, mods()).unwrap(), b"\x1b[B\x1b[B");
}

#[test]
fn absolute_scroll_clamps_and_does_not_write_mouse_reports() {
    let mut grid = grid();
    grid.advance(b"zero\r\none\r\ntwo\r\nthree\r\nfour");
    let state = grid.scroll_state();
    assert_eq!(state.visible_rows, 3);
    assert_eq!(state.history_rows, 2);
    assert_eq!(state.offset, 0);
    let revision = grid.revision();
    grid.scroll_to(usize::MAX);
    assert_eq!(grid.scroll_state().offset, 2);
    assert!(grid.snapshot().text().starts_with("zero"));
    assert!(grid.revision() > revision);
    let revision = grid.revision();
    grid.scroll_to(2);
    assert_eq!(grid.revision(), revision);
    grid.advance(b"\x1b[?1002h\x1b[?1006h");
    grid.scroll_to(1);
    assert_eq!(grid.scroll_state().offset, 1);
    grid.scroll_to(0);
    assert_eq!(grid.scroll_state().offset, 0);
    grid.advance(b"\x1b[?1049h");
    grid.scroll_to(500);
    assert_eq!(grid.scroll_state().history_rows, 0);
    assert_eq!(grid.scroll_state().offset, 0);
}
