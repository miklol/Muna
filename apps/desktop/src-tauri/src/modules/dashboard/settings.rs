//! The module's settings namespace, `settings.modules.dashboard` (docs/modules/dashboard.md).
//! A missing or malformed entry yields the default layout instead of failing the whole
//! document, and unknown keys are ignored so an older build can read a newer file
//! (docs/03-architecture.md).
//!
//! The layout is the widget grid in reading order: 2 rows × 4 slots, each widget spanning one
//! or two. Rust does not know which modules have a widget — that is the frontend registry's
//! business — so it only keeps the layout well-formed: one slot per module, spans of 1 or 2,
//! and never more than the grid holds. The UI applies the same repair (`clampDashboardSlots`)
//! and additionally leaves out modules that are disabled or have no widget.

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Slots across the grid.
pub const GRID_COLUMNS: u8 = 4;
/// Rows of the grid.
pub const GRID_ROWS: u8 = 2;
/// Every slot the layout may fill; the sum of the spans never exceeds it.
pub const GRID_CELLS: u8 = GRID_COLUMNS * GRID_ROWS;
/// The widest a widget may be, in slots.
pub const MAX_SPAN: u8 = 2;

/// One widget's place on the grid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSlot {
    /// The module whose widget fills the slot; also its settings namespace.
    pub module_id: String,
    /// How many grid slots the widget takes, 1 or 2.
    pub span: u8,
}

impl DashboardSlot {
    #[must_use]
    pub fn new(module_id: &str, span: u8) -> Self {
        Self {
            module_id: module_id.to_owned(),
            span,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct DashboardSettings {
    /// The widgets in grid order.
    pub slots: Vec<DashboardSlot>,
}

impl Default for DashboardSettings {
    /// Every P1 module with a widget, media wide: exactly one full grid.
    fn default() -> Self {
        Self {
            slots: vec![
                DashboardSlot::new("media", 2),
                DashboardSlot::new("pomodoro", 1),
                DashboardSlot::new("todo", 1),
                DashboardSlot::new("weather", 1),
                DashboardSlot::new("day-progress", 1),
                DashboardSlot::new("system-monitor", 1),
                DashboardSlot::new("bluetooth", 1),
            ],
        }
    }
}

impl DashboardSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document, repaired to a valid layout.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        serde_json::from_value::<Self>(value.clone())
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "dashboard settings malformed; using defaults");
                Self::default()
            })
            .clamped()
    }

    /// Writes the namespace back into a settings document.
    pub fn write(&self, settings: &mut Settings) -> Result<(), serde_json::Error> {
        settings
            .modules
            .insert(Self::KEY.to_owned(), serde_json::to_value(self)?);
        Ok(())
    }

    /// The slots the grid can show: the first slot of each module, spans clamped to 1..=2,
    /// and nothing past the grid's capacity (a narrower slot after a wider one that did not
    /// fit still gets in, the same way the UI fills the grid).
    #[must_use]
    pub fn clamped(self) -> Self {
        let mut used = 0u8;
        let mut kept: Vec<DashboardSlot> = Vec::with_capacity(self.slots.len());
        for slot in self.slots {
            if slot.module_id.is_empty() || kept.iter().any(|k| k.module_id == slot.module_id) {
                continue;
            }
            let span = slot.span.clamp(1, MAX_SPAN);
            if used + span > GRID_CELLS {
                continue;
            }
            used += span;
            kept.push(DashboardSlot { span, ..slot });
        }
        Self { slots: kept }
    }

    /// How many of the grid's slots the layout fills.
    #[must_use]
    pub fn used_cells(&self) -> u8 {
        self.slots.iter().map(|slot| slot.span).sum()
    }
}
