//! A placeholder pomodoro backend that exercises the *activity* path of the strip (a live
//! countdown with focus and wide burst) until the real module lands in M3.
//!
//! Enabled only with `MUNA_DEMO=pomodoro` so a release build never shows a timer nobody
//! started. Runs one 25-minute focus block from launch and announces when it finishes.

use std::time::Duration;

use muna_core::{Activity, Glyph, Leading, Notice, StripMessage, Trailing, activities::priority};

use super::{ModuleBackend, ModuleCtx, Surface};

pub const ID: &str = "pomodoro";
const ACTIVITY_ID: &str = "pomodoro:timer";
const FOCUS: Duration = Duration::from_mins(25);
/// Republish cadence: the UI ticks the countdown locally, so this only corrects drift.
const REPUBLISH: Duration = Duration::from_secs(60);

#[must_use]
pub fn demo_enabled() -> bool {
    std::env::var("MUNA_DEMO").is_ok_and(|value| {
        value
            .split(',')
            .any(|flag| flag.trim().eq_ignore_ascii_case("pomodoro"))
    })
}

/// The activity for a focus block with `remaining` left; the UI counts down from here.
#[must_use]
pub fn activity(remaining: Duration, total: Duration, running: bool) -> Activity {
    Activity {
        id: ACTIVITY_ID.into(),
        module: ID.into(),
        priority: priority::POMODORO,
        leading: Some(Leading::Icon {
            glyph: Glyph::Timer,
            tint: Some(muna_core::Tint::Orange),
        }),
        trailing: Some(Trailing::Timer {
            remaining_ms: clamp_ms(remaining),
            total_ms: clamp_ms(total),
            running,
        }),
        wide: Some(StripMessage::Text {
            value: "Focus".into(),
        }),
    }
}

#[must_use]
pub fn finished_notice() -> Notice {
    Notice {
        id: "pomodoro:finished".into(),
        module: ID.into(),
        priority: priority::POMODORO,
        leading: Some(Leading::Icon {
            glyph: Glyph::Timer,
            tint: Some(muna_core::Tint::Green),
        }),
        trailing: None,
        wide: Some(StripMessage::TimerFinished {
            label: "Focus".into(),
        }),
        hold_ms: 0,
    }
}

fn clamp_ms(duration: Duration) -> u32 {
    u32::try_from(duration.as_millis()).unwrap_or(u32::MAX)
}

#[derive(Debug, Default, Clone, Copy)]
pub struct PomodoroDemo;

impl ModuleBackend for PomodoroDemo {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Strip]
    }

    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()> {
        tauri::async_runtime::spawn(async move {
            let started = tokio::time::Instant::now();
            loop {
                let remaining = FOCUS.saturating_sub(started.elapsed());
                if remaining.is_zero() {
                    ctx.activities.retract_activity(ACTIVITY_ID);
                    ctx.activities.publish_notice(finished_notice());
                    break;
                }
                ctx.activities
                    .publish_activity(activity(remaining, FOCUS, true));
                tokio::time::sleep(REPUBLISH.min(remaining)).await;
            }
        });
        Ok(())
    }
}
