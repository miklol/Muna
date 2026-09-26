//! Zone geometry (docs/modules/window-snap.md "Zones"): from a layout and a monitor's work
//! area to the rectangle the dragged window's *visible frame* should fill, in physical pixels.
//! Pure integer arithmetic so mixed-DPI layouts are a table test.
//!
//! Halves, thirds and quarters split the work area with integer division and give the last
//! part the remainder, so adjacent zones tile exactly: Left Half + Right Half is the whole work
//! area, never a one-pixel seam or overlap.

use muna_platform::Rect;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::settings::SnapGrid;

/// A built-in layout, in the strip's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SnapZone {
    TopLeft,
    BottomLeft,
    LeftHalf,
    Maximize,
    RightHalf,
    TopRight,
    BottomRight,
    LeftThird,
    CenterThird,
    RightThird,
}

impl SnapZone {
    /// Every built-in, in strip order; also the default setting.
    pub const DEFAULT: [Self; 10] = [
        Self::TopLeft,
        Self::BottomLeft,
        Self::LeftHalf,
        Self::Maximize,
        Self::RightHalf,
        Self::TopRight,
        Self::BottomRight,
        Self::LeftThird,
        Self::CenterThird,
        Self::RightThird,
    ];
}

/// What the UI names at release: a built-in layout or one cell of the custom grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SnapZoneRef {
    BuiltIn(SnapZone),
    Cell { row: u8, col: u8 },
}

/// Where a window goes for a zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placement {
    /// The visible frame fills this rectangle.
    Frame(Rect),
    /// The window is maximised on the monitor (the OS handles the frame).
    Maximize,
}

/// The placement for a built-in zone on a monitor whose work area is `work_area`.
#[must_use]
pub fn zone_placement(zone: SnapZone, work_area: Rect) -> Placement {
    let halves_x = split(work_area.x, work_area.width, 2);
    let halves_y = split(work_area.y, work_area.height, 2);
    let thirds_x = split(work_area.x, work_area.width, 3);
    let frame = match zone {
        SnapZone::Maximize => return Placement::Maximize,
        SnapZone::TopLeft => cell(halves_x[0], halves_y[0]),
        SnapZone::BottomLeft => cell(halves_x[0], halves_y[1]),
        SnapZone::LeftHalf => cell(halves_x[0], (work_area.y, work_area.height)),
        SnapZone::RightHalf => cell(halves_x[1], (work_area.y, work_area.height)),
        SnapZone::TopRight => cell(halves_x[1], halves_y[0]),
        SnapZone::BottomRight => cell(halves_x[1], halves_y[1]),
        SnapZone::LeftThird => cell(thirds_x[0], (work_area.y, work_area.height)),
        SnapZone::CenterThird => cell(thirds_x[1], (work_area.y, work_area.height)),
        SnapZone::RightThird => cell(thirds_x[2], (work_area.y, work_area.height)),
    };
    Placement::Frame(frame)
}

/// The rectangle of one cell of `grid` on a monitor, `gap` scaled from CSS pixels at 100 % to
/// the monitor's physical pixels. `None` for a cell outside the grid or a work area too small
/// to hold the gutters.
#[must_use]
pub fn cell_frame(grid: SnapGrid, row: u8, col: u8, work_area: Rect, dpi: u32) -> Option<Rect> {
    if row >= grid.rows || col >= grid.cols {
        return None;
    }
    let gap = physical_gap(grid.gap, dpi);
    let gutters_x = gap.checked_mul(u32::from(grid.cols) + 1)?;
    let gutters_y = gap.checked_mul(u32::from(grid.rows) + 1)?;
    let inner_width = work_area.width.checked_sub(gutters_x)?;
    let inner_height = work_area.height.checked_sub(gutters_y)?;
    if inner_width == 0 || inner_height == 0 {
        return None;
    }
    let cols_x = split(work_area.x, inner_width, u32::from(grid.cols));
    let rows_y = split(work_area.y, inner_height, u32::from(grid.rows));
    let (x, width) = cols_x.get(usize::from(col)).copied()?;
    let (y, height) = rows_y.get(usize::from(row)).copied()?;
    // Shift each cell right/down by the gutters before it (one leading gutter plus one per
    // preceding cell).
    let shift_x = gap.checked_mul(u32::from(col) + 1)?;
    let shift_y = gap.checked_mul(u32::from(row) + 1)?;
    Some(Rect::new(
        x.checked_add_unsigned(shift_x)?,
        y.checked_add_unsigned(shift_y)?,
        width,
        height,
    ))
}

/// A CSS gap at 100 % in the monitor's physical pixels, rounded to the nearest pixel.
#[must_use]
pub fn physical_gap(gap: u16, dpi: u32) -> u32 {
    (u32::from(gap) * dpi.max(1) + 48) / 96
}

/// Splits `length` starting at `origin` into `parts` runs: `(start, length)` per part, the
/// last part taking the remainder so the runs tile exactly.
fn split(origin: i32, length: u32, parts: u32) -> Vec<(i32, u32)> {
    let parts = parts.max(1);
    let each = length / parts;
    (0..parts)
        .map(|index| {
            let start = origin.saturating_add_unsigned(each * index);
            let run = if index + 1 == parts {
                length - each * index
            } else {
                each
            };
            (start, run)
        })
        .collect()
}

fn cell(x: (i32, u32), y: (i32, u32)) -> Rect {
    Rect::new(x.0, y.0, x.1, y.1)
}
