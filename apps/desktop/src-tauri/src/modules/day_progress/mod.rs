//! The `day-progress` module backend (docs/modules/day-progress.md): the working day as a
//! progress bar in the collapsed strip. The timeline itself is pure UI — the panel merges the
//! to-do and pomodoro snapshots it already receives — so this half owns only the settings
//! namespace and the strip form, and touches no platform API.
//!
//! The bar is on only while `show_day_in_strip` is set *and* the local time is inside the
//! working hours; it is republished when the whole percent moves and retracted at the end of
//! the day. The loop sleeps to the next boundary (capped at [`MAX_SLEEP`] so a resumed machine
//! catches up) and parks on a `Notify` while the bar is off, so an idle module costs nothing.

pub mod settings;

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use muna_core::{Activity, Clock, Glyph, Hub, Leading, Settings, Trailing, activities::priority};
use parking_lot::Mutex;
use tokio::sync::Notify;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use settings::DayProgressSettings;

pub const ID: &str = "day-progress";
/// The collapsed-strip bar of the working day.
pub const BAR_ACTIVITY_ID: &str = "day-progress:bar";

/// Seconds in a day.
pub const SECONDS_PER_DAY: u32 = 24 * 60 * 60;
/// The longest the loop sleeps before it reads the wall clock again. Boundaries are exact
/// while the machine is awake; after a sleep or a clock change the bar catches up within this.
pub const MAX_SLEEP: Duration = Duration::from_secs(60);

/// Where local midnight sits relative to UTC at an instant. Injected so tests run at a fixed
/// offset; the app reads the machine's zone (daylight saving included) at every wake.
pub trait Zone: Send + Sync {
    fn offset_seconds(&self, at: SystemTime) -> i32;
}

/// The machine's zone.
#[derive(Debug, Default, Clone, Copy)]
pub struct LocalZone;

impl Zone for LocalZone {
    fn offset_seconds(&self, at: SystemTime) -> i32 {
        chrono::DateTime::<chrono::Local>::from(at)
            .offset()
            .local_minus_utc()
    }
}

/// A zone that never changes, for tests.
#[derive(Debug, Clone, Copy)]
pub struct FixedZone(pub i32);

impl Zone for FixedZone {
    fn offset_seconds(&self, _at: SystemTime) -> i32 {
        self.0
    }
}

/// Seconds since local midnight at `at`, given the zone offset in force then.
#[must_use]
pub fn seconds_of_day(at: SystemTime, offset_seconds: i32) -> u32 {
    let unix = at
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_secs()).ok())
        .unwrap_or(0);
    let local = (unix + i64::from(offset_seconds)).rem_euclid(i64::from(SECONDS_PER_DAY));
    // `rem_euclid` by a `u32` always fits.
    u32::try_from(local).unwrap_or(0)
}

/// What the strip should show at a moment, and when that may change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Plan {
    /// The share of the working day that has passed, while the bar is on.
    pub percent: Option<u8>,
    /// How long until the strip content may change; `None` when only a settings change can
    /// (the bar is off), so the loop parks.
    pub next_change: Option<Duration>,
}

/// The bar for `settings` at `seconds_of_day`. Inside the working hours the percent is the
/// whole part, so a 9 h day moves the bar every 5 min 24 s, and `next_change` is exactly the
/// time to the next whole percent or the end of the day; outside them it is the time to the
/// next start.
#[must_use]
pub fn plan(settings: &DayProgressSettings, seconds_of_day: u32) -> Plan {
    if !settings.show_day_in_strip {
        return Plan {
            percent: None,
            next_change: None,
        };
    }
    let start = u32::from(settings.work_start_minutes) * 60;
    let end = u32::from(settings.work_end_minutes) * 60;
    let Some(span) = end.checked_sub(start).filter(|span| *span > 0) else {
        return Plan {
            percent: None,
            next_change: None,
        };
    };
    let now = seconds_of_day.min(SECONDS_PER_DAY - 1);
    if now < start {
        return Plan {
            percent: None,
            next_change: Some(Duration::from_secs(u64::from(start - now))),
        };
    }
    if now >= end {
        return Plan {
            percent: None,
            next_change: Some(Duration::from_secs(u64::from(
                SECONDS_PER_DAY - now + start,
            ))),
        };
    }
    let elapsed = now - start;
    let percent = elapsed * 100 / span;
    // The first second at which the whole percent is one more, or the end of the day.
    let boundary = ((percent + 1) * span).div_ceil(100).min(span);
    Plan {
        // `elapsed < span`, so the percent is at most 99.
        percent: Some(u8::try_from(percent).unwrap_or(99)),
        next_change: Some(Duration::from_secs(u64::from(boundary - elapsed))),
    }
}

/// The strip bar: an hourglass and the working day's progress. No wide form, so a new percent
/// never bursts the strip open.
#[must_use]
pub fn bar_activity(percent: u8) -> Activity {
    Activity {
        id: BAR_ACTIVITY_ID.into(),
        module: ID.into(),
        priority: priority::DAY_PROGRESS,
        leading: Some(Leading::Icon {
            glyph: Glyph::Hourglass,
            tint: None,
        }),
        trailing: Some(Trailing::Progress {
            percent: percent.min(100),
        }),
        wide: None,
    }
}

pub struct DayProgressService {
    hub: Arc<Hub>,
    clock: Arc<dyn Clock>,
    zone: Arc<dyn Zone>,
    settings: Mutex<DayProgressSettings>,
    /// The percent the strip bar shows right now, if it is published.
    showing: Mutex<Option<u8>>,
    /// Wakes the loop when the settings changed.
    wake: Notify,
}

impl std::fmt::Debug for DayProgressService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DayProgressService")
            .field("settings", &*self.settings.lock())
            .field("showing", &*self.showing.lock())
            .finish_non_exhaustive()
    }
}

impl DayProgressService {
    #[must_use]
    pub fn new(hub: Arc<Hub>, clock: Arc<dyn Clock>, zone: Arc<dyn Zone>) -> Self {
        Self {
            hub,
            clock,
            zone,
            settings: Mutex::new(DayProgressSettings::default()),
            showing: Mutex::new(None),
            wake: Notify::new(),
        }
    }

    #[must_use]
    pub fn settings(&self) -> DayProgressSettings {
        *self.settings.lock()
    }

    /// The percent the strip shows, if the bar is published.
    #[must_use]
    pub fn showing(&self) -> Option<u8> {
        *self.showing.lock()
    }

    /// Applies `settings.modules["day-progress"]` (start-up and every settings change).
    pub fn apply_settings(&self, settings: &Settings) {
        let next = DayProgressSettings::from_document(settings);
        {
            let mut current = self.settings.lock();
            if *current == next {
                return;
            }
            *current = next;
        }
        self.update();
        self.wake.notify_one();
    }

    /// Brings the strip in line with the wall clock. Returns how long until it must look
    /// again, or `None` when only a settings change can matter.
    pub fn update(&self) -> Option<Duration> {
        let settings = *self.settings.lock();
        let now = self.clock.system_time();
        let plan = plan(
            &settings,
            seconds_of_day(now, self.zone.offset_seconds(now)),
        );
        self.show(plan.percent);
        plan.next_change
    }

    /// Publishes the bar when it has a percent, republishing only when the whole percent
    /// moved; retracts it otherwise.
    fn show(&self, percent: Option<u8>) {
        let mut showing = self.showing.lock();
        match percent {
            Some(percent) => {
                if *showing != Some(percent) {
                    self.hub.publish_activity(bar_activity(percent));
                    *showing = Some(percent);
                }
            }
            None => {
                if showing.take().is_some() {
                    self.hub.retract_activity(BAR_ACTIVITY_ID);
                }
            }
        }
    }
}

/// The backend: keeps the strip bar in step with the wall clock, and parks while it is off.
#[derive(Debug, Clone)]
pub struct DayProgressModule(pub Arc<DayProgressService>);

impl ModuleBackend for DayProgressModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Strip, Surface::Panel]
    }

    fn start(&self, _ctx: ModuleCtx) -> anyhow::Result<()> {
        let service = Arc::clone(&self.0);
        tauri::async_runtime::spawn(async move {
            loop {
                let Some(wait) = service.update() else {
                    service.wake.notified().await;
                    continue;
                };
                tokio::select! {
                    () = tokio::time::sleep(wait.min(MAX_SLEEP)) => {}
                    () = service.wake.notified() => {}
                }
            }
        });
        Ok(())
    }
}
