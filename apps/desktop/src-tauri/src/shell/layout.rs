//! Where a notch window goes on a monitor (docs/modules/notch-shell.md, Placement). All
//! results are physical pixels; the window keeps its logical size so the `WebView` renders at the
//! monitor's own scale (per-monitor DPI v2).

use muna_platform::{MonitorInfo, Rect};

/// Logical size of the notch window, matching `tauri.conf.json`: the maximum expanded panel plus
/// shadow padding and spring overshoot.
pub const WINDOW_LOGICAL: (u32, u32) = (1000, 440);

/// Baseline DPI at 100 % scale.
const BASE_DPI: f64 = 96.0;

/// Scale factor of a monitor (1.0 at 96 dpi, 1.5 at 144 dpi).
#[must_use]
pub fn scale_factor(monitor: &MonitorInfo) -> f64 {
    f64::from(monitor.dpi.max(1)) / BASE_DPI
}

/// Logical → physical pixels for a monitor.
#[must_use]
#[allow(clippy::cast_possible_truncation)]
pub fn to_physical(monitor: &MonitorInfo, logical: f64) -> i32 {
    // Screen coordinates always fit in i32; `as` saturates at the extremes.
    (logical * scale_factor(monitor)).round() as i32
}

/// The window's physical size on `monitor`.
#[must_use]
pub fn window_size(monitor: &MonitorInfo) -> (u32, u32) {
    (
        to_physical(monitor, f64::from(WINDOW_LOGICAL.0)).unsigned_abs(),
        to_physical(monitor, f64::from(WINDOW_LOGICAL.1)).unsigned_abs(),
    )
}

/// Placed rect: horizontally centred on the monitor, flush with its top edge.
#[must_use]
pub fn placed_rect(monitor: &MonitorInfo) -> Rect {
    let (width, height) = window_size(monitor);
    let slack = i64::from(monitor.bounds.width) - i64::from(width);
    let x = i64::from(monitor.bounds.x) + slack / 2;
    Rect::new(
        i32::try_from(x).unwrap_or(monitor.bounds.x),
        monitor.bounds.y,
        width,
        height,
    )
}

/// Parked rect: the same size, moved fully above the monitor so the window is never hidden
/// or shown (Tauri white-flash, docs/04-tauri-windows-caveats.md).
#[must_use]
pub fn parked_rect(monitor: &MonitorInfo) -> Rect {
    let placed = placed_rect(monitor);
    let y = i64::from(monitor.bounds.y) - i64::from(placed.height);
    Rect::new(
        placed.x,
        i32::try_from(y).unwrap_or(i32::MIN),
        placed.width,
        placed.height,
    )
}

/// Converts a CSS-pixel rect (relative to the window's client area) published by the UI into a
/// physical screen rect.
#[must_use]
pub fn shape_to_physical(monitor: &MonitorInfo, window: Rect, shape: [f64; 4]) -> Rect {
    let [x, y, width, height] = shape;
    Rect::new(
        window.x.saturating_add(to_physical(monitor, x)),
        window.y.saturating_add(to_physical(monitor, y)),
        to_physical(monitor, width).unsigned_abs(),
        to_physical(monitor, height).unsigned_abs(),
    )
}
