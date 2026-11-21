//! Convert logical native input coordinates into terminal cells.
use super::terminal::ffi::NativeMouseEvent;
use crate::{
    binding::types::MouseButton,
    frame::CellGeometry,
    terminal_core::grid::{MouseModifiers, PointerAction},
    terminal_session::Session,
};
use anyhow::{Context, Result};

pub(crate) struct MouseState {
    button: u8,
    remainder: f64,
    click: Option<(std::time::Instant, usize, usize, u8, u8)>,
    position: (usize, usize),
    modifiers: MouseModifiers,
}
impl Default for MouseState {
    fn default() -> Self {
        Self {
            button: 3,
            remainder: 0.,
            click: None,
            position: (0, 0),
            modifiers: MouseModifiers::default(),
        }
    }
}
impl MouseState {
    pub(super) fn input(
        &mut self,
        session: &Session,
        geometry: Option<CellGeometry>,
        event: &NativeMouseEvent,
    ) -> Result<()> {
        if event.kind == 5 {
            // A cancel may have no coordinates or arrive after layout is gone.
            // Release the remembered press; event.buttons/Shift may have changed.
            let button = std::mem::replace(&mut self.button, 3);
            self.remainder = 0.;
            self.click = None;
            if button < 3 {
                session.pointer(
                    PointerAction::Cancel,
                    self.position.0,
                    self.position.1,
                    false,
                    1,
                    button,
                    self.modifiers,
                )?;
            }
            return Ok(());
        }
        if !event.x.is_finite() || !event.y.is_finite() || !event.wheel.is_finite() {
            return Ok(());
        }
        let CellGeometry {
            width: cw,
            height: ch,
            padding: pad,
        } = geometry.context("Waiting for terminal layout")?;
        let size = session.size();
        let row = (((event.y - pad) / ch).floor().max(0.) as usize).min(size.rows - 1);
        let column_position = ((event.x - pad) / cw).max(0.);
        let column = (column_position.floor() as usize).min(size.columns - 1);
        let right_half = column_position.fract() >= 0.5;
        let modifiers = MouseModifiers {
            shift: event.shift,
            control: event.control,
            alt: event.alt,
        };
        if event.kind == 4 {
            // Trackpad deltas are pixels; coarse wheels are line deltas.
            let delta = if event.precise {
                event.wheel / f64::from(ch)
            } else {
                event.wheel
            };
            self.remainder += delta * session.scroll_multiplier(modifiers);
            let lines = self.remainder.trunc().clamp(-256., 256.) as i32;
            self.remainder -= f64::from(lines);
            return session.scroll(lines, row, column, modifiers);
        }
        let button = match event.buttons {
            buttons if buttons.contains(MouseButton::Primary) => 0,
            buttons if buttons.contains(MouseButton::Middle) => 1,
            buttons if buttons.contains(MouseButton::Secondary) => 2,
            _ => self.button,
        };
        let mut clicks = event.clicks;
        let action = match event.kind {
            1 => {
                self.button = button;
                self.position = (row, column);
                self.modifiers = modifiers;
                if clicks == 0 {
                    let now = std::time::Instant::now();
                    clicks = self
                        .click
                        .filter(|(last, r, c, b, _)| {
                            now.duration_since(*last).as_secs_f64()
                                < objc2_app_kit::NSEvent::doubleClickInterval()
                                && *r == row
                                && *c == column
                                && *b == button
                        })
                        .map_or(1, |(_, _, _, _, count)| count % 3 + 1);
                    self.click = Some((now, row, column, button, clicks));
                }
                PointerAction::Down
            }
            2 => {
                self.button = 3;
                PointerAction::Up
            }
            3 => {
                self.position = (row, column);
                PointerAction::Move
            }
            _ => return Ok(()),
        };
        session.pointer(action, row, column, right_half, clicks, button, modifiers)
    }
}
