//! The HUD's pure logic: remembers the last known levels and turns each *change* into a strip
//! notice (docs/modules/hud.md). No platform, no Tauri; `tests/hud.rs` drives it directly
//! (the lib crate cannot host unit tests, see `Cargo.toml`).

use muna_core::{Glyph, Leading, Notice, Trailing, activities::priority};
use muna_platform::{BrightnessMonitor, OsdState};
use serde::{Deserialize, Serialize};
use specta::Type;

/// How long a HUD notice holds the strip after the last change (docs/06-motion-spec.md timing
/// table, "HUD linger after last change": 1.5 s).
pub const HUD_HOLD_MS: u32 = 1500;

pub const VOLUME_NOTICE_ID: &str = "hud:volume";
pub const MIC_NOTICE_ID: &str = "hud:mic";
pub const BRIGHTNESS_NOTICE_ID: &str = "hud:brightness";

/// The default render endpoint's level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VolumeLevel {
    pub percent: u8,
    pub muted: bool,
}

/// Everything the HUD UI renders and the settings pane reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HudState {
    /// `None` until the platform reported a level (no render device, or not yet probed).
    pub volume: Option<VolumeLevel>,
    /// `None` when there is no default microphone.
    pub mic_muted: Option<bool>,
    /// Monitors whose brightness can be read and set, in the platform's order. A monitor
    /// without DDC/CI never appears here (docs/modules/hud.md, acceptance criteria).
    pub monitors: Vec<BrightnessMonitor>,
    /// Whether the Windows flyout is currently hidden.
    pub osd: OsdState,
}

impl Default for HudState {
    fn default() -> Self {
        Self {
            volume: None,
            mic_muted: None,
            monitors: Vec::new(),
            osd: OsdState::Native,
        }
    }
}

/// Speaker glyph for a level: waves grow in thirds, mute wins (docs/modules/hud.md, "Visual").
#[must_use]
pub fn volume_glyph(percent: u8, muted: bool) -> Glyph {
    match (muted, percent) {
        (true, _) => Glyph::VolumeMuted,
        (false, 0) => Glyph::Volume,
        (false, 1..=33) => Glyph::VolumeLow,
        (false, 34..=66) => Glyph::VolumeMedium,
        (false, _) => Glyph::VolumeHigh,
    }
}

fn notice(id: &str, glyph: Glyph, trailing: Option<Trailing>) -> Notice {
    Notice {
        id: id.to_owned(),
        module: super::ID.to_owned(),
        priority: priority::HUD,
        leading: Some(Leading::Icon { glyph, tint: None }),
        trailing,
        wide: None,
        hold_ms: HUD_HOLD_MS,
    }
}

/// The monitor a brightness event named is not in the list: the caller re-reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnknownMonitor;

/// Levels seen so far. The first report of each seeds the state without a notice: the strip
/// only reacts to *changes*, never to start-up (docs/modules/hud.md, acceptance criteria).
#[derive(Debug, Default)]
pub struct HudTracker {
    state: HudState,
}

impl HudTracker {
    #[must_use]
    pub fn state(&self) -> HudState {
        self.state.clone()
    }

    /// Records the level; returns the notice to publish when it changed.
    pub fn observe_volume(&mut self, percent: u8, muted: bool) -> Option<Notice> {
        let level = VolumeLevel {
            percent: percent.min(100),
            muted,
        };
        match self.state.volume.replace(level) {
            Some(previous) if previous != level => Some(notice(
                VOLUME_NOTICE_ID,
                volume_glyph(level.percent, level.muted),
                Some(Trailing::Level {
                    percent: level.percent,
                    muted: level.muted,
                }),
            )),
            _ => None,
        }
    }

    /// The render device went away. Returns whether anything changed.
    pub fn clear_volume(&mut self) -> bool {
        self.state.volume.take().is_some()
    }

    /// Records the microphone state (`None` = no microphone); returns the notice on a change.
    pub fn observe_mic(&mut self, muted: Option<bool>) -> Option<Notice> {
        let previous = std::mem::replace(&mut self.state.mic_muted, muted);
        match (previous, muted) {
            (Some(was), Some(now)) if was != now => Some(notice(
                MIC_NOTICE_ID,
                if now { Glyph::MicMuted } else { Glyph::Mic },
                None,
            )),
            _ => None,
        }
    }

    /// Replaces the monitor list (start-up, hot-plug). Never a notice; returns whether it
    /// changed.
    pub fn set_monitors(&mut self, monitors: Vec<BrightnessMonitor>) -> bool {
        if self.state.monitors == monitors {
            return false;
        }
        self.state.monitors = monitors;
        true
    }

    /// Records one monitor's level; returns the notice on a change.
    pub fn observe_brightness(
        &mut self,
        monitor_id: &str,
        percent: u8,
    ) -> Result<Option<Notice>, UnknownMonitor> {
        let percent = percent.min(100);
        let monitor = self
            .state
            .monitors
            .iter_mut()
            .find(|m| m.id == monitor_id)
            .ok_or(UnknownMonitor)?;
        if monitor.percent == percent {
            return Ok(None);
        }
        monitor.percent = percent;
        Ok(Some(notice(
            BRIGHTNESS_NOTICE_ID,
            Glyph::Sun,
            Some(Trailing::Level {
                percent,
                muted: false,
            }),
        )))
    }

    /// Records the flyout state; returns whether it changed.
    pub fn set_osd(&mut self, osd: OsdState) -> bool {
        if self.state.osd == osd {
            return false;
        }
        self.state.osd = osd;
        true
    }
}
