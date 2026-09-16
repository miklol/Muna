//! Battery and power-source notices (docs/modules/live-activities.md "Built-in notices").
//!
//! A pure state machine over successive [`BatteryState`] readings: the first reading only
//! seeds it (no notice at start-up), later readings produce notices for plugging in,
//! unplugging and crossing the 20 % and 10 % marks while discharging.

use muna_core::{Leading, Notice, StripMessage, Trailing, activities::priority};
use muna_platform::{BatteryState, PowerSource as Source};

/// Discharge levels that raise a "battery low" notice, highest first.
pub const LOW_THRESHOLDS: [u8; 2] = [20, 10];

const MODULE: &str = "live-activities";

#[derive(Debug, Default)]
pub struct PowerSource {
    last: Option<BatteryState>,
}

impl PowerSource {
    #[must_use]
    pub fn new(initial: Option<BatteryState>) -> Self {
        Self { last: initial }
    }

    /// Records a reading and returns the notices it warrants (usually none or one).
    pub fn observe(&mut self, next: BatteryState) -> Vec<Notice> {
        let previous = self.last.replace(next);
        let (Some(previous), Some(percent)) = (previous, next.percent) else {
            // First reading, or a machine without a battery: nothing to say.
            return Vec::new();
        };
        let mut notices = Vec::new();
        let plugged_in = next.source == Source::Ac && previous.source != Source::Ac;
        let started_charging = next.charging && !previous.charging;
        if plugged_in || started_charging {
            notices.push(compact("power:charging", percent, next.charging));
        } else if next.source == Source::Battery && previous.source == Source::Ac {
            notices.push(compact("power:unplugged", percent, false));
        }
        if next.source == Source::Battery && !next.charging {
            let before = previous.percent.unwrap_or(100);
            if let Some(&threshold) = LOW_THRESHOLDS
                .iter()
                .find(|&&threshold| before > threshold && percent <= threshold)
            {
                notices.push(Notice {
                    wide: Some(StripMessage::BatteryLow { percent }),
                    ..compact(&format!("power:low:{threshold}"), percent, false)
                });
            }
        }
        notices
    }
}

/// Battery glyph leading, percentage trailing, no text — the HUD-like compact form.
fn compact(id: &str, percent: u8, charging: bool) -> Notice {
    Notice {
        id: id.into(),
        module: MODULE.into(),
        priority: priority::POWER,
        leading: Some(Leading::Battery { percent, charging }),
        trailing: Some(Trailing::Percent { value: percent }),
        wide: None,
        hold_ms: 0,
    }
}
