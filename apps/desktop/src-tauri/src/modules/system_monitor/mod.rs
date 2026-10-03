//! The `system-monitor` module backend (docs/modules/system-monitor.md): CPU, memory, storage,
//! network and battery gauges plus the busiest processes. It pulls raw counters from the
//! platform's `SystemStats` and derives rates and percentages here, so `tests/system_monitor.rs`
//! drives the service with `FakePlatform` and a `FakeClock`.
//!
//! Cadence is the whole design (acceptance: "stops when the module is not visible and not in
//! the strip"): 1 Hz while any notch panel watches, every 10 s while only the strip gauge
//! wants CPU, and nothing at all otherwise — the loop parks on a `Notify` until a watcher or a
//! settings change wakes it. The process walk is the expensive part of a sample and is only
//! requested while a panel is open.

pub mod settings;

use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use muna_core::{
    Activity, Clock, Glyph, Hub, Int53, Leading, Settings, Trailing, activities::priority,
};
use muna_platform::{Platform, SystemSample};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tokio::sync::Notify;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use settings::SystemMonitorSettings;

pub const ID: &str = "system-monitor";
/// The collapsed-strip CPU gauge.
pub const CPU_ACTIVITY_ID: &str = "system-monitor:cpu";

/// Sampling period while a panel is open.
pub const VISIBLE_PERIOD: Duration = Duration::from_secs(1);
/// Sampling period while only the strip gauge needs a number.
pub const STRIP_PERIOD: Duration = Duration::from_secs(10);
/// Two samples further apart than this do not make a rate: the machine slept, or nobody was
/// looking. The next pair does.
pub const RATE_WINDOW_MAX: Duration = Duration::from_secs(30);

/// One reading for the panel. Byte counts are saturated to [`Int53`] so a JavaScript
/// `number` holds them exactly; percentages are whole numbers, as the gauges draw them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemMonitorSnapshot {
    /// Whole-machine CPU use, 0–100. `None` until two samples exist to difference.
    pub cpu_percent: Option<u8>,
    pub logical_cpus: u16,
    #[specta(type = Int53)]
    pub memory_used_bytes: u64,
    #[specta(type = Int53)]
    pub memory_total_bytes: u64,
    /// Fixed volumes summed (removable media is not the machine's storage).
    #[specta(type = Int53)]
    pub storage_used_bytes: u64,
    #[specta(type = Int53)]
    pub storage_total_bytes: u64,
    /// Free space on the system volume — the number that decides whether Windows updates fit.
    #[specta(type = Int53)]
    pub free_disk_bytes: u64,
    /// Capacity of the same volume, so a gauge can draw the free share.
    #[specta(type = Int53)]
    pub system_disk_total_bytes: u64,
    /// Bytes per second over every hardware interface, `None` until two samples exist.
    pub network_down_bytes_per_s: Option<u32>,
    pub network_up_bytes_per_s: Option<u32>,
    /// `None` on a machine without a battery.
    pub battery: Option<SystemMonitorBattery>,
    /// The busiest processes, most CPU first; empty while the panel is closed or the setting
    /// is 0.
    pub processes: Vec<SystemMonitorProcess>,
    /// Unix milliseconds of the sample, so a panel can tell a stale reading from a live one.
    #[specta(type = Int53)]
    pub sampled_at_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemMonitorBattery {
    pub percent: u8,
    pub charging: bool,
}

/// One row of the process list: every process sharing an executable name, aggregated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemMonitorProcess {
    /// Executable name without its extension; never a window title or a path.
    pub name: String,
    /// Share of the whole machine in tenths of a percent (123 is 12.3 %), so a quiet process
    /// still reads as more than zero.
    pub cpu_tenths: u16,
    #[specta(type = Int53)]
    pub memory_bytes: u64,
    /// How many processes the row aggregates.
    pub count: u16,
}

/// Where the module reports a fresh reading; the shell bridges it to a Tauri event.
pub trait SystemMonitorSink: Send + Sync {
    fn changed(&self, snapshot: &SystemMonitorSnapshot);
}

pub struct SystemMonitorService {
    platform: Arc<dyn Platform>,
    hub: Arc<Hub>,
    clock: Arc<dyn Clock>,
    settings: Mutex<SystemMonitorSettings>,
    sink: Mutex<Option<Arc<dyn SystemMonitorSink>>>,
    /// Labels of the notch windows whose panel is open.
    watchers: Mutex<HashSet<String>>,
    /// The previous raw sample and the monotonic instant it was taken, for rates.
    previous: Mutex<Option<(Instant, SystemSample)>>,
    latest: Mutex<Option<SystemMonitorSnapshot>>,
    /// The percent the strip gauge shows right now, if it is published.
    strip_showing: Mutex<Option<u8>>,
    /// Wakes the loop when the cadence may have changed.
    wake: Notify,
}

impl std::fmt::Debug for SystemMonitorService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SystemMonitorService")
            .field("settings", &*self.settings.lock())
            .field("watchers", &self.watchers.lock().len())
            .field("strip_showing", &*self.strip_showing.lock())
            .finish_non_exhaustive()
    }
}

impl SystemMonitorService {
    #[must_use]
    pub fn new(platform: Arc<dyn Platform>, hub: Arc<Hub>, clock: Arc<dyn Clock>) -> Self {
        Self {
            platform,
            hub,
            clock,
            settings: Mutex::new(SystemMonitorSettings::default()),
            sink: Mutex::new(None),
            watchers: Mutex::new(HashSet::new()),
            previous: Mutex::new(None),
            latest: Mutex::new(None),
            strip_showing: Mutex::new(None),
            wake: Notify::new(),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn SystemMonitorSink>) {
        *self.sink.lock() = Some(sink);
    }

    #[must_use]
    pub fn settings(&self) -> SystemMonitorSettings {
        self.settings.lock().clone()
    }

    /// The most recent reading, if the module has taken one.
    #[must_use]
    pub fn snapshot(&self) -> Option<SystemMonitorSnapshot> {
        self.latest.lock().clone()
    }

    /// A panel in the notch window `label` opened (`true`) or closed (`false`). Returns the
    /// latest reading so an opening panel can draw at once; the loop takes a fresh one right
    /// away and then every second.
    pub fn watch(&self, label: &str, watching: bool) -> Option<SystemMonitorSnapshot> {
        let changed = {
            let mut watchers = self.watchers.lock();
            if watching {
                watchers.insert(label.to_owned())
            } else {
                watchers.remove(label)
            }
        };
        if changed {
            self.wake.notify_one();
        }
        self.snapshot()
    }

    /// A notch window went away without closing its panel.
    pub fn forget_window(&self, label: &str) {
        if self.watchers.lock().remove(label) {
            self.wake.notify_one();
        }
    }

    /// `true` while any panel is open.
    #[must_use]
    pub fn is_watched(&self) -> bool {
        !self.watchers.lock().is_empty()
    }

    /// How often to sample, or `None` when nothing needs a number (the loop parks).
    #[must_use]
    pub fn cadence(&self) -> Option<Duration> {
        if self.is_watched() {
            Some(VISIBLE_PERIOD)
        } else if self.settings.lock().show_cpu_in_strip {
            Some(STRIP_PERIOD)
        } else {
            None
        }
    }

    /// Applies `settings.modules["system-monitor"]` (start-up and every settings change).
    pub fn apply_settings(&self, settings: &Settings) {
        let next = SystemMonitorSettings::from_document(settings);
        {
            let mut current = self.settings.lock();
            if *current == next {
                return;
            }
            *current = next;
        }
        let cpu = self.latest.lock().as_ref().and_then(|s| s.cpu_percent);
        self.update_strip(cpu);
        self.wake.notify_one();
    }

    /// Takes one reading: pulls the raw counters, derives rates against the previous sample,
    /// tells the sink while a panel watches and refreshes the strip gauge. Blocking — the
    /// backend calls it from a blocking task.
    pub fn sample(&self) -> Option<SystemMonitorSnapshot> {
        let watched = self.is_watched();
        let settings = self.settings.lock().clone();
        let processes = if watched {
            usize::from(settings.process_count)
        } else {
            0
        };
        let raw = match self.platform.system_stats().sample(processes) {
            Ok(sample) => sample,
            Err(error) => {
                tracing::debug!(%error, "system stats unavailable");
                return None;
            }
        };
        let now = self.clock.now();
        let previous = self.previous.lock().replace((now, raw.clone()));
        let window = previous
            .as_ref()
            .map(|(at, _)| now.saturating_duration_since(*at))
            .filter(|elapsed| !elapsed.is_zero() && *elapsed <= RATE_WINDOW_MAX);
        let rate = |current: u64, earlier: u64| {
            window.map(|elapsed| bytes_per_second(current.saturating_sub(earlier), elapsed))
        };
        let (down, up) = match (&previous, window) {
            (Some((_, earlier)), Some(_)) => (
                rate(raw.network_received_bytes, earlier.network_received_bytes),
                rate(
                    raw.network_transmitted_bytes,
                    earlier.network_transmitted_bytes,
                ),
            ),
            _ => (None, None),
        };
        // A CPU figure is only "since the previous sample" if that sample was recent; after a
        // gap it averages the whole gap and would mislead the gauge.
        let cpu_percent = raw
            .cpu_percent
            .filter(|_| window.is_some())
            .map(percent_from_f32);
        let battery = self.platform.power().battery().ok().and_then(|state| {
            state.percent.map(|percent| SystemMonitorBattery {
                percent: percent.min(100),
                charging: state.charging,
            })
        });
        let fixed = raw.disks.iter().filter(|disk| !disk.removable);
        let storage_total_bytes = fixed
            .clone()
            .fold(0u64, |sum, disk| sum.saturating_add(disk.total_bytes));
        let storage_available =
            fixed.fold(0u64, |sum, disk| sum.saturating_add(disk.available_bytes));
        let system_disk = raw
            .disks
            .iter()
            .find(|disk| disk.system)
            .or_else(|| raw.disks.iter().find(|disk| !disk.removable));
        let snapshot = SystemMonitorSnapshot {
            cpu_percent,
            logical_cpus: raw.logical_cpus,
            memory_used_bytes: Int53::saturate(raw.memory_used_bytes),
            memory_total_bytes: Int53::saturate(raw.memory_total_bytes),
            storage_used_bytes: Int53::saturate(
                storage_total_bytes.saturating_sub(storage_available),
            ),
            storage_total_bytes: Int53::saturate(storage_total_bytes),
            free_disk_bytes: Int53::saturate(system_disk.map_or(0, |disk| disk.available_bytes)),
            system_disk_total_bytes: Int53::saturate(
                system_disk.map_or(0, |disk| disk.total_bytes),
            ),
            network_down_bytes_per_s: down,
            network_up_bytes_per_s: up,
            battery,
            processes: raw
                .processes
                .iter()
                .map(|process| SystemMonitorProcess {
                    name: process.name.clone(),
                    cpu_tenths: tenths_from_f32(process.cpu_percent),
                    memory_bytes: Int53::saturate(process.memory_bytes),
                    count: process.count,
                })
                .collect(),
            sampled_at_ms: unix_ms(self.clock.system_time()),
        };
        *self.latest.lock() = Some(snapshot.clone());
        if watched {
            let sink = self.sink.lock().clone();
            if let Some(sink) = sink {
                sink.changed(&snapshot);
            }
        }
        self.update_strip(cpu_percent);
        Some(snapshot)
    }

    /// Publishes the strip gauge when it is enabled and has a number, republishing only when
    /// the whole percent moved; retracts it otherwise.
    fn update_strip(&self, cpu_percent: Option<u8>) {
        let enabled = self.settings.lock().show_cpu_in_strip;
        let mut showing = self.strip_showing.lock();
        match cpu_percent.filter(|_| enabled) {
            Some(percent) => {
                if *showing != Some(percent) {
                    self.hub.publish_activity(cpu_activity(percent));
                    *showing = Some(percent);
                }
            }
            None => {
                if showing.take().is_some() {
                    self.hub.retract_activity(CPU_ACTIVITY_ID);
                }
            }
        }
    }
}

/// The strip gauge: a processor glyph and the whole-machine percent. No wide form, so a new
/// number never bursts the strip open.
#[must_use]
pub fn cpu_activity(percent: u8) -> Activity {
    Activity {
        id: CPU_ACTIVITY_ID.into(),
        module: ID.into(),
        priority: priority::SYSTEM_GAUGE,
        leading: Some(Leading::Icon {
            glyph: Glyph::Cpu,
            tint: None,
        }),
        trailing: Some(Trailing::Percent {
            value: percent.min(100),
        }),
        wide: None,
    }
}

/// `bytes` over `elapsed` as a whole rate, saturating at `u32::MAX` (34 Gbit/s).
#[must_use]
pub fn bytes_per_second(bytes: u64, elapsed: Duration) -> u32 {
    let millis = elapsed.as_millis().max(1);
    let per_second = u128::from(bytes) * 1000 / millis;
    u32::try_from(per_second).unwrap_or(u32::MAX)
}

fn percent_from_f32(percent: f32) -> u8 {
    // Clamped to 0–100 before the cast, so neither truncation nor sign loss can happen.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let whole = percent.clamp(0.0, 100.0).round() as u8;
    whole
}

fn tenths_from_f32(percent: f32) -> u16 {
    // Clamped to 0–1000 before the cast, so neither truncation nor sign loss can happen.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let tenths = (percent.clamp(0.0, 100.0) * 10.0).round() as u16;
    tenths
}

fn unix_ms(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

/// The backend: samples at the cadence the watchers and settings ask for, and parks when
/// nothing does.
#[derive(Debug, Clone)]
pub struct SystemMonitorModule(pub Arc<SystemMonitorService>);

impl ModuleBackend for SystemMonitorModule {
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
                let Some(period) = service.cadence() else {
                    service.wake.notified().await;
                    continue;
                };
                let sampler = Arc::clone(&service);
                // The process walk takes tens of milliseconds; keep it off the async threads.
                if let Err(error) =
                    tauri::async_runtime::spawn_blocking(move || sampler.sample()).await
                {
                    tracing::warn!(%error, "system monitor sample task failed");
                }
                tokio::select! {
                    () = tokio::time::sleep(period) => {}
                    () = service.wake.notified() => {}
                }
            }
        });
        Ok(())
    }
}
