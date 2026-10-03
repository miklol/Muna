//! The module's settings namespace, `settings.modules.window-snap` (docs/modules/window-snap.md
//! "Zones": which built-in layouts are offered and an optional custom grid; at most ten zones
//! in all, at least one). A missing or malformed entry yields the defaults instead of failing
//! the whole document, and unknown keys are ignored so an older build can read a newer file.

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::zones::SnapZone;

/// Most zones the strip offers (docs/modules/window-snap.md "Choose Snap Zones (10/10)").
pub const MAX_ZONES: usize = 10;
/// Bounds of the custom grid.
pub const MAX_GRID_ROWS: u8 = 4;
pub const MAX_GRID_COLS: u8 = 4;
/// Largest gutter between grid cells, in CSS pixels at 100 %.
pub const MAX_GRID_GAP: u16 = 32;

/// A custom rows × columns layout; every cell is a zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SnapGrid {
    pub rows: u8,
    pub cols: u8,
    /// Gutter around and between cells, in CSS pixels at 100 % (scaled per monitor).
    pub gap: u16,
}

impl SnapGrid {
    /// Rows and columns clamped to 1..=4 and the gap to the bound, then columns and rows
    /// trimmed until the grid fits [`MAX_ZONES`] on its own.
    #[must_use]
    pub fn normalised(self) -> Self {
        let mut rows = self.rows.clamp(1, MAX_GRID_ROWS);
        let mut cols = self.cols.clamp(1, MAX_GRID_COLS);
        while usize::from(rows) * usize::from(cols) > MAX_ZONES {
            if cols >= rows {
                cols -= 1;
            } else {
                rows -= 1;
            }
        }
        Self {
            rows,
            cols,
            gap: self.gap.min(MAX_GRID_GAP),
        }
    }

    #[must_use]
    pub fn cells(&self) -> usize {
        usize::from(self.rows) * usize::from(self.cols)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowSnapSettings {
    /// Built-in layouts offered, in strip order.
    pub zones: Vec<SnapZone>,
    /// A custom grid whose cells are offered after the built-ins.
    pub grid: Option<SnapGrid>,
}

impl Default for WindowSnapSettings {
    fn default() -> Self {
        Self {
            zones: SnapZone::DEFAULT.to_vec(),
            grid: None,
        }
    }
}

impl WindowSnapSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        serde_json::from_value::<Self>(value.clone())
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "window snap settings malformed; using defaults");
                Self::default()
            })
            .normalised()
    }

    /// Writes the namespace back into a settings document.
    pub fn write(&self, settings: &mut Settings) -> Result<(), serde_json::Error> {
        settings
            .modules
            .insert(Self::KEY.to_owned(), serde_json::to_value(self)?);
        Ok(())
    }

    /// Drops repeated zones, clamps the grid, trims built-ins so the total stays within
    /// [`MAX_ZONES`], and falls back to the defaults when nothing is left.
    #[must_use]
    pub fn normalised(self) -> Self {
        let grid = self.grid.map(SnapGrid::normalised);
        let mut zones: Vec<SnapZone> = Vec::with_capacity(self.zones.len());
        for zone in self.zones {
            if !zones.contains(&zone) {
                zones.push(zone);
            }
        }
        let room = MAX_ZONES.saturating_sub(grid.map_or(0, |g| g.cells()));
        zones.truncate(room);
        if zones.is_empty() && grid.is_none() {
            return Self::default();
        }
        Self { zones, grid }
    }

    /// Built-ins plus grid cells.
    #[must_use]
    pub fn enabled_count(&self) -> usize {
        self.zones.len() + self.grid.map_or(0, |g| g.cells())
    }
}
