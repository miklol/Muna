//! Where a notch window goes on a monitor (docs/modules/notch-shell.md, Placement). All
//! results are physical pixels; the window keeps its logical size so the `WebView` renders at the
//! monitor's own scale (per-monitor DPI v2).

use muna_core::{MonitorLayout, NotchShape, StripHeight};
use muna_platform::{MonitorInfo, Rect};

/// Logical size of the notch window, matching `tauri.conf.json`: the maximum expanded panel
/// ([`PANEL_MAX_WIDTH`] × 360) plus room on every side for its shadow and spring overshoot.
pub const WINDOW_LOGICAL: (u32, u32) = (1120, 480);

/// Minimum strip width in CSS px (docs/modules/notch-shell.md, Sizes); used for the yield
/// rules until the UI publishes the painted shape.
pub const STRIP_MIN_WIDTH: u32 = 190;
/// Island pills float below the top edge (docs/05-design-system.md, Sizes: 6–8 px).
pub const ISLAND_TOP_OFFSET: u32 = 8;
/// Panel width clamps to `min(PANEL_MAX_WIDTH, monitor CSS width − PANEL_MONITOR_MARGIN)`.
pub const PANEL_MAX_WIDTH: u32 = 1000;
pub const PANEL_MONITOR_MARGIN: u32 = 80;
/// The sliver of the strip left visible while a window peeks, in CSS px (`--size-peek-height`);
/// mirrors `PEEK_HEIGHT_PX` in `@muna/contracts`.
pub const PEEK_HEIGHT_PX: u32 = 6;

/// Baseline DPI at 100 % scale.
const BASE_DPI: f64 = 96.0;

/// Scale factor of a monitor (1.0 at 96 dpi, 1.5 at 144 dpi).
#[must_use]
pub fn scale_factor(monitor: &MonitorInfo) -> f64 {
    f64::from(monitor.dpi.max(1)) / BASE_DPI
}

/// Scale as a whole percentage (100, 125, 150, …) for the UI.
#[must_use]
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
pub fn scale_percent(monitor: &MonitorInfo) -> u32 {
    (scale_factor(monitor) * 100.0).round().max(0.0) as u32
}

/// Logical → physical pixels for a monitor.
#[must_use]
#[allow(clippy::cast_possible_truncation)]
pub fn to_physical(monitor: &MonitorInfo, logical: f64) -> i32 {
    // Screen coordinates always fit in i32; `as` saturates at the extremes.
    (logical * scale_factor(monitor)).round() as i32
}

/// Physical → logical (CSS) pixels for a monitor, rounded down.
#[must_use]
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
pub fn to_logical(monitor: &MonitorInfo, physical: u32) -> u32 {
    (f64::from(physical) / scale_factor(monitor))
        .floor()
        .max(0.0) as u32
}

/// The window's physical size on `monitor`.
#[must_use]
pub fn window_size(monitor: &MonitorInfo) -> (u32, u32) {
    (
        to_physical(monitor, f64::from(WINDOW_LOGICAL.0)).unsigned_abs(),
        to_physical(monitor, f64::from(WINDOW_LOGICAL.1)).unsigned_abs(),
    )
}

/// Placed rect with the default layout: horizontally centred, flush with the top edge.
#[must_use]
pub fn placed_rect(monitor: &MonitorInfo) -> Rect {
    placed_rect_for(monitor, &MonitorLayout::default())
}

/// Placed rect for a monitor's layout settings: centre + horizontal offset, top edge +
/// vertical offset (offsets are CSS px, docs/modules/notch-shell.md Placement).
#[must_use]
pub fn placed_rect_for(monitor: &MonitorInfo, layout: &MonitorLayout) -> Rect {
    let (width, height) = window_size(monitor);
    let slack = i64::from(monitor.bounds.width) - i64::from(width);
    let x = i64::from(monitor.bounds.x)
        + slack / 2
        + i64::from(to_physical(monitor, f64::from(layout.offset_x)));
    let y =
        i64::from(monitor.bounds.y) + i64::from(to_physical(monitor, f64::from(layout.offset_y)));
    Rect::new(
        i32::try_from(x).unwrap_or(monitor.bounds.x),
        i32::try_from(y).unwrap_or(monitor.bounds.y),
        width,
        height,
    )
}

/// Parked rect: the same size, moved fully above the monitor so the window is never hidden
/// or shown (Tauri white-flash, docs/04-tauri-windows-caveats.md).
#[must_use]
pub fn parked_rect(monitor: &MonitorInfo) -> Rect {
    parked_rect_for(monitor, &MonitorLayout::default())
}

/// Parked rect for a monitor's layout settings (see [`parked_rect`]).
#[must_use]
pub fn parked_rect_for(monitor: &MonitorInfo, layout: &MonitorLayout) -> Rect {
    let placed = placed_rect_for(monitor, layout);
    let y = i64::from(monitor.bounds.y) - i64::from(placed.height);
    Rect::new(
        placed.x,
        i32::try_from(y).unwrap_or(i32::MIN),
        placed.width,
        placed.height,
    )
}

/// Vertical CSS px from the window's top edge to the strip's top edge.
#[must_use]
pub const fn strip_top_offset(shape: NotchShape) -> u32 {
    match shape {
        NotchShape::Notch => 0,
        NotchShape::Island => ISLAND_TOP_OFFSET,
    }
}

/// Height in physical px a Reserved-strip `AppBar` claims at the top of the monitor: the
/// vertical offset plus the strip (and the Island's float gap).
#[must_use]
pub fn reserved_height(monitor: &MonitorInfo, layout: &MonitorLayout) -> u32 {
    let css = layout.offset_y.max(0).unsigned_abs()
        + strip_top_offset(layout.shape)
        + layout.strip_height.css_px();
    to_physical(monitor, f64::from(css)).unsigned_abs()
}

/// Where the collapsed strip sits before the UI publishes its painted shape: the minimum
/// strip width centred in the window, at the strip's top offset. Physical px.
#[must_use]
pub fn default_strip_rect(monitor: &MonitorInfo, layout: &MonitorLayout, window: Rect) -> Rect {
    let width = to_physical(monitor, f64::from(STRIP_MIN_WIDTH)).unsigned_abs();
    let height = to_physical(monitor, f64::from(layout.strip_height.css_px())).unsigned_abs();
    let top = to_physical(monitor, f64::from(strip_top_offset(layout.shape)));
    let slack = i64::from(window.width) - i64::from(width);
    Rect::new(
        i32::try_from(i64::from(window.x) + slack / 2).unwrap_or(window.x),
        window.y.saturating_add(top),
        width,
        height,
    )
}

/// Panel width in CSS px for a monitor: `min(1000, monitorWidth − 80)`.
#[must_use]
pub fn panel_max_width(monitor: &MonitorInfo) -> u32 {
    let css_width = to_logical(monitor, monitor.bounds.width);
    css_width
        .saturating_sub(PANEL_MONITOR_MARGIN)
        .min(PANEL_MAX_WIDTH)
}

/// Strip height in CSS px for a preset (re-exported so the shell has one place to ask).
#[must_use]
pub const fn strip_height_px(height: StripHeight) -> u32 {
    height.css_px()
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
