//! Display brightness (docs/modules/hud.md "Brightness", docs/04 "HUD").
//!
//! Two kinds of display, one snapshot:
//!
//! * **Internal panels** through WMI (`ROOT\WMI`): `WmiMonitorBrightness` for the level,
//!   `WmiMonitorBrightnessMethods.WmiSetBrightness` to set it and `WmiMonitorBrightnessEvent`
//!   for changes made by brightness keys or the OS. Ids are `wmi:<InstanceName>`.
//! * **External monitors** through DDC/CI (`dxva2.dll`): a monitor is offered only when
//!   `GetMonitorCapabilities` reports `MC_CAPS_BRIGHTNESS` (acceptance criterion: incapable
//!   monitors show no control). Ids are `<GDI device>#<physical index>` (`\\.\DISPLAY1#0`).
//!   DDC/CI round trips take ~50 ms and can fail on a busy bus, so they are best effort.
//!
//! Everything runs on one worker thread; reads answer from the snapshot and every `set` comes
//! back as [`PlatformEvent::BrightnessChanged`]. A helper thread forwards
//! [`PlatformEvent::MonitorsChanged`] into a refresh so hot-plugging re-probes.

use std::collections::HashMap;
use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tracing::{debug, warn};
use windows::Win32::Devices::Display::{
    DestroyPhysicalMonitor, GetMonitorBrightness, GetMonitorCapabilities,
    GetNumberOfPhysicalMonitorsFromHMONITOR, GetPhysicalMonitorsFromHMONITOR, MC_CAPS_BRIGHTNESS,
    PHYSICAL_MONITOR, SetMonitorBrightness,
};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
use wmi::{Variant, WMIConnection};

use super::monitors;
use crate::error::{PlatformError, PlatformResult};
use crate::events::PlatformEvent;
use crate::types::{BrightnessKind, BrightnessMonitor};

const WMI_NAMESPACE: &str = r"ROOT\WMI";
const WMI_ID_PREFIX: &str = "wmi:";
/// What an internal panel is called; WMI has no friendly name for it.
const INTERNAL_PANEL_NAME: &str = "Built-in display";

#[derive(Debug)]
enum Msg {
    /// Re-probe every display (start-up, hot-plug).
    Refresh,
    /// A `WmiMonitorBrightnessEvent` arrived.
    WmiChanged {
        instance: String,
        percent: u8,
    },
    Set {
        id: String,
        percent: u8,
    },
    Stop,
}

#[derive(Debug)]
struct Shared {
    monitors: Mutex<Vec<BrightnessMonitor>>,
    events: broadcast::Sender<PlatformEvent>,
    inbox: mpsc::Sender<Msg>,
}

/// Owns the worker; dropping it stops the thread at its next message.
#[derive(Debug)]
pub(super) struct Watcher {
    shared: Arc<Shared>,
    _worker: JoinHandle<()>,
}

impl Watcher {
    pub(super) fn start(events: broadcast::Sender<PlatformEvent>) -> PlatformResult<Self> {
        let (inbox, outbox) = mpsc::channel();
        let shared = Arc::new(Shared {
            monitors: Mutex::new(Vec::new()),
            events,
            inbox,
        });
        let worker = std::thread::Builder::new()
            .name("muna-platform-brightness".into())
            .spawn({
                let shared = Arc::clone(&shared);
                move || run_worker(&shared, &outbox)
            })
            .map_err(|_| PlatformError::Unsupported("brightness worker thread"))?;
        spawn_hotplug_forwarder(&shared);
        Ok(Self {
            shared,
            _worker: worker,
        })
    }

    pub(super) fn monitors(&self) -> Vec<BrightnessMonitor> {
        self.shared.monitors.lock().clone()
    }

    pub(super) fn set(&self, id: &str, percent: u8) -> PlatformResult<()> {
        if !self.shared.monitors.lock().iter().any(|m| m.id == id) {
            return Err(PlatformError::NotFound(format!("brightness monitor {id}")));
        }
        self.shared
            .inbox
            .send(Msg::Set {
                id: id.to_owned(),
                percent: percent.min(100),
            })
            .map_err(|_| PlatformError::Unsupported("brightness worker stopped"))
    }
}

impl Drop for Watcher {
    fn drop(&mut self) {
        let _ = self.shared.inbox.send(Msg::Stop);
    }
}

/// Turns `MonitorsChanged` broadcasts into a worker refresh. Blocks on the broadcast channel,
/// so it costs nothing while idle, and ends when the platform's sender is dropped.
fn spawn_hotplug_forwarder(shared: &Arc<Shared>) {
    let mut events = shared.events.subscribe();
    let inbox = shared.inbox.clone();
    let spawned = std::thread::Builder::new()
        .name("muna-platform-brightness-hotplug".into())
        .spawn(move || {
            loop {
                match events.blocking_recv() {
                    Ok(PlatformEvent::MonitorsChanged(_)) => {
                        if inbox.send(Msg::Refresh).is_err() {
                            break;
                        }
                    }
                    Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    if spawned.is_err() {
        warn!(
            "brightness: hot-plug forwarder thread unavailable; re-probe on display change disabled"
        );
    }
}

// --- WMI shapes ----------------------------------------------------------------------------
// Struct names double as WMI class names for the `wmi` crate, hence the casing.

#[derive(Debug, Deserialize)]
#[allow(non_snake_case, non_camel_case_types)]
struct WmiMonitorBrightness {
    Active: bool,
    CurrentBrightness: u8,
    InstanceName: String,
}

#[derive(Debug, Deserialize)]
#[allow(non_snake_case, non_camel_case_types)]
struct WmiMonitorBrightnessMethods {
    InstanceName: String,
    __Path: String,
}

#[derive(Debug, Deserialize)]
#[allow(non_snake_case, non_camel_case_types)]
struct WmiMonitorBrightnessEvent {
    Active: bool,
    Brightness: u8,
    InstanceName: String,
}

#[derive(Debug, Serialize)]
#[allow(non_snake_case)]
struct WmiSetBrightnessIn {
    Timeout: u32,
    Brightness: u8,
}

fn wmi_id(instance: &str) -> String {
    format!("{WMI_ID_PREFIX}{instance}")
}

// --- worker --------------------------------------------------------------------------------

/// One DDC/CI-capable physical monitor with its open handle.
struct Ddc {
    id: String,
    handle: HANDLE,
    min: u32,
    max: u32,
}

impl Ddc {
    fn percent(&self, current: u32) -> u8 {
        let span = self.max.saturating_sub(self.min).max(1);
        let level = current.saturating_sub(self.min).min(span);
        u8::try_from(u64::from(level) * 100 / u64::from(span)).unwrap_or(100)
    }

    fn raw(&self, percent: u8) -> u32 {
        let span = u64::from(self.max.saturating_sub(self.min));
        let offset = span * u64::from(percent.min(100)) / 100;
        self.min
            .saturating_add(u32::try_from(offset).unwrap_or(u32::MAX))
    }
}

impl Drop for Ddc {
    fn drop(&mut self) {
        // SAFETY: the handle came from `GetPhysicalMonitorsFromHMONITOR` and is destroyed once.
        #[allow(unsafe_code)]
        if let Err(error) = unsafe { DestroyPhysicalMonitor(self.handle) } {
            debug!(%error, id = %self.id, "brightness: DestroyPhysicalMonitor failed");
        }
    }
}

struct Worker<'a> {
    shared: &'a Arc<Shared>,
    wmi: Option<WMIConnection>,
    /// Monitor id → `WmiMonitorBrightnessMethods` object path.
    wmi_paths: HashMap<String, String>,
    ddc: Vec<Ddc>,
}

fn run_worker(shared: &Arc<Shared>, outbox: &mpsc::Receiver<Msg>) {
    // SAFETY: initialising COM on this dedicated thread has no preconditions; the matching
    // `CoUninitialize` runs when the loop ends. `S_FALSE` (already initialised) is fine too.
    #[allow(unsafe_code)]
    if let Err(error) = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok() {
        warn!(%error, "brightness: CoInitializeEx failed; brightness disabled");
        return;
    }
    let mut worker = Worker {
        shared,
        wmi: connect_wmi(),
        wmi_paths: HashMap::new(),
        ddc: Vec::new(),
    };
    worker.refresh();
    if worker.wmi.is_some() && !worker.wmi_paths.is_empty() {
        spawn_wmi_listener(shared);
    }
    for msg in outbox {
        match msg {
            Msg::Stop => break,
            Msg::Refresh => worker.refresh(),
            Msg::WmiChanged { instance, percent } => {
                worker.publish(&wmi_id(&instance), percent);
            }
            Msg::Set { id, percent } => worker.set(&id, percent),
        }
    }
    worker.ddc.clear();
    drop(worker);
    // SAFETY: balances the successful `CoInitializeEx` above on the same thread.
    #[allow(unsafe_code)]
    unsafe {
        CoUninitialize();
    }
    debug!("brightness worker stopped");
}

fn connect_wmi() -> Option<WMIConnection> {
    match WMIConnection::with_namespace_path(WMI_NAMESPACE) {
        Ok(connection) => Some(connection),
        Err(error) => {
            debug!(%error, "brightness: WMI unavailable; internal panels disabled");
            None
        }
    }
}

/// Blocks on `WmiMonitorBrightnessEvent` for the life of the process (the enumerator has no
/// timeout) and forwards each event to the worker. Only started when a panel exists.
fn spawn_wmi_listener(shared: &Arc<Shared>) {
    let inbox = shared.inbox.clone();
    let spawned = std::thread::Builder::new()
        .name("muna-platform-brightness-wmi".into())
        .spawn(move || {
            // SAFETY: as in `run_worker`; this thread never uninitialises because it never ends.
            #[allow(unsafe_code)]
            if unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_err() {
                return;
            }
            let Some(connection) = connect_wmi() else {
                return;
            };
            let events = match connection.raw_notification::<WmiMonitorBrightnessEvent>(
                "SELECT Active, Brightness, InstanceName FROM WmiMonitorBrightnessEvent",
            ) {
                Ok(events) => events,
                Err(error) => {
                    warn!(%error, "brightness: WmiMonitorBrightnessEvent subscription failed");
                    return;
                }
            };
            for event in events {
                match event {
                    Ok(event) if event.Active => {
                        if inbox
                            .send(Msg::WmiChanged {
                                instance: event.InstanceName,
                                percent: event.Brightness.min(100),
                            })
                            .is_err()
                        {
                            break;
                        }
                    }
                    Ok(_) => {}
                    Err(error) => debug!(%error, "brightness: malformed WMI event"),
                }
            }
        });
    if spawned.is_err() {
        warn!(
            "brightness: WMI listener thread unavailable; brightness keys will not update the HUD"
        );
    }
}

impl Worker<'_> {
    /// Re-probes every display and replaces the snapshot. Nothing is published: a probe is not
    /// a change, and consumers read the snapshot when they need it.
    fn refresh(&mut self) {
        let mut monitors = self.probe_wmi();
        self.ddc.clear();
        self.ddc = probe_ddc(&mut monitors);
        debug!(count = monitors.len(), "brightness: monitors probed");
        *self.shared.monitors.lock() = monitors;
    }

    fn probe_wmi(&mut self) -> Vec<BrightnessMonitor> {
        self.wmi_paths.clear();
        let Some(connection) = &self.wmi else {
            return Vec::new();
        };
        let levels: Vec<WmiMonitorBrightness> = match connection
            .raw_query("SELECT Active, CurrentBrightness, InstanceName FROM WmiMonitorBrightness")
        {
            Ok(levels) => levels,
            Err(error) => {
                // Desktops answer "not supported" here; that is the common case, not a fault.
                debug!(%error, "brightness: no WmiMonitorBrightness instances");
                return Vec::new();
            }
        };
        let paths: Vec<WmiMonitorBrightnessMethods> = connection
            .raw_query("SELECT InstanceName, __Path FROM WmiMonitorBrightnessMethods")
            .unwrap_or_default();
        for methods in paths {
            self.wmi_paths
                .insert(wmi_id(&methods.InstanceName), methods.__Path);
        }
        levels
            .into_iter()
            .filter(|level| level.Active)
            .map(|level| BrightnessMonitor {
                id: wmi_id(&level.InstanceName),
                name: INTERNAL_PANEL_NAME.to_owned(),
                percent: level.CurrentBrightness.min(100),
                kind: BrightnessKind::Internal,
            })
            .collect()
    }

    fn set(&self, id: &str, percent: u8) {
        if id.starts_with(WMI_ID_PREFIX) {
            self.set_wmi(id, percent);
        } else {
            self.set_ddc(id, percent);
        }
    }

    fn set_wmi(&self, id: &str, percent: u8) {
        let (Some(connection), Some(path)) = (&self.wmi, self.wmi_paths.get(id)) else {
            warn!(id, "brightness: no WMI method path for monitor");
            return;
        };
        let result: Result<Option<HashMap<String, Variant>>, _> = connection
            .exec_instance_method::<WmiMonitorBrightnessMethods, _>(
            path,
            "WmiSetBrightness",
            WmiSetBrightnessIn {
                Timeout: 0,
                Brightness: percent,
            },
        );
        match result {
            // The level comes back through `WmiMonitorBrightnessEvent`.
            Ok(_) => {}
            Err(error) => warn!(%error, id, percent, "brightness: WmiSetBrightness failed"),
        }
    }

    fn set_ddc(&self, id: &str, percent: u8) {
        let Some(monitor) = self.ddc.iter().find(|m| m.id == id) else {
            warn!(id, "brightness: monitor handle missing; re-probe pending");
            return;
        };
        // SAFETY: the physical monitor handle is open (owned by `self.ddc`); the call only
        // writes the VCP brightness code and reports success as a non-zero `BOOL`.
        #[allow(unsafe_code)]
        let ok = unsafe { SetMonitorBrightness(monitor.handle, monitor.raw(percent)) } != 0;
        if ok {
            self.publish(id, percent);
        } else {
            warn!(
                id,
                percent, "brightness: SetMonitorBrightness failed (DDC/CI bus busy?)"
            );
        }
    }

    /// Updates the snapshot and publishes when the level actually changed.
    fn publish(&self, id: &str, percent: u8) {
        let changed = {
            let mut monitors = self.shared.monitors.lock();
            match monitors.iter_mut().find(|m| m.id == id) {
                Some(monitor) if monitor.percent != percent => {
                    monitor.percent = percent;
                    true
                }
                _ => false,
            }
        };
        if changed {
            // No subscribers is fine: the app may not have mounted a listener yet.
            let _ = self.shared.events.send(PlatformEvent::BrightnessChanged {
                monitor_id: id.to_owned(),
                percent,
            });
        }
    }
}

/// Opens every physical monitor, keeps the DDC/CI-capable ones and appends their snapshot
/// entries to `monitors`.
fn probe_ddc(monitors: &mut Vec<BrightnessMonitor>) -> Vec<Ddc> {
    let handles = match monitors::handles() {
        Ok(handles) => handles,
        Err(error) => {
            warn!(%error, "brightness: monitor enumeration failed");
            return Vec::new();
        }
    };
    let mut capable = Vec::new();
    for handle in handles {
        let device = monitors::device_name(handle).unwrap_or_default();
        for (index, physical) in physical_monitors(handle).into_iter().enumerate() {
            let id = format!("{device}#{index}");
            // `PHYSICAL_MONITOR` is `#[repr(packed)]`; copy the array out before borrowing it.
            let description = physical.szPhysicalMonitorDescription;
            let name = utf16_until_nul(&description);
            let Some(ddc) = open_ddc(id, physical.hPhysicalMonitor) else {
                continue;
            };
            let current = read_ddc(&ddc);
            debug!(id = %ddc.id, %name, ?current, "brightness: DDC/CI monitor");
            if let Some(percent) = current {
                monitors.push(BrightnessMonitor {
                    id: ddc.id.clone(),
                    name: if name.trim().is_empty() {
                        ddc.id.clone()
                    } else {
                        name
                    },
                    percent,
                    kind: BrightnessKind::External,
                });
                capable.push(ddc);
            }
        }
    }
    capable
}

fn physical_monitors(monitor: HMONITOR) -> Vec<PHYSICAL_MONITOR> {
    let mut count = 0_u32;
    // SAFETY: `count` is a valid out-pointer; the array is sized from it before being filled,
    // exactly as the two-call protocol requires. Results are checked.
    #[allow(unsafe_code)]
    unsafe {
        if let Err(error) = GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, &raw mut count) {
            debug!(%error, "brightness: GetNumberOfPhysicalMonitorsFromHMONITOR failed");
            return Vec::new();
        }
        let mut physical = vec![PHYSICAL_MONITOR::default(); count as usize];
        if physical.is_empty() {
            return physical;
        }
        if let Err(error) = GetPhysicalMonitorsFromHMONITOR(monitor, &mut physical) {
            debug!(%error, "brightness: GetPhysicalMonitorsFromHMONITOR failed");
            return Vec::new();
        }
        physical
    }
}

/// Wraps the handle and probes the capability; an incapable monitor is destroyed right away and
/// yields `None` (the acceptance criterion: no control for it).
fn open_ddc(id: String, handle: HANDLE) -> Option<Ddc> {
    let mut ddc = Ddc {
        id,
        handle,
        min: 0,
        max: 100,
    };
    let (mut caps, mut temps) = (0_u32, 0_u32);
    // SAFETY: valid open handle and out-pointers; a zero return means the monitor does not
    // speak DDC/CI (or the bus timed out), which is handled by returning `None`.
    #[allow(unsafe_code)]
    let ok = unsafe { GetMonitorCapabilities(handle, &raw mut caps, &raw mut temps) } != 0;
    if !ok || caps & MC_CAPS_BRIGHTNESS == 0 {
        return None;
    }
    let (mut min, mut cur, mut max) = (0_u32, 0_u32, 0_u32);
    // SAFETY: as above; all three out-pointers are valid `u32`s.
    #[allow(unsafe_code)]
    let ok = unsafe { GetMonitorBrightness(handle, &raw mut min, &raw mut cur, &raw mut max) } != 0;
    if !ok || max <= min {
        return None;
    }
    ddc.min = min;
    ddc.max = max;
    Some(ddc)
}

fn read_ddc(ddc: &Ddc) -> Option<u8> {
    let (mut min, mut cur, mut max) = (0_u32, 0_u32, 0_u32);
    // SAFETY: open handle owned by `ddc`; valid out-pointers; the result is checked.
    #[allow(unsafe_code)]
    let ok =
        unsafe { GetMonitorBrightness(ddc.handle, &raw mut min, &raw mut cur, &raw mut max) } != 0;
    ok.then(|| ddc.percent(cur))
}

fn utf16_until_nul(buffer: &[u16]) -> String {
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..len])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ddc(min: u32, max: u32) -> Ddc {
        Ddc {
            id: "test".into(),
            // Never destroyed for real: `HANDLE::default()` makes `DestroyPhysicalMonitor` fail
            // harmlessly, which `Drop` only logs.
            handle: HANDLE::default(),
            min,
            max,
        }
    }

    #[test]
    fn ddc_levels_normalise_to_percent_and_back() {
        let monitor = ddc(0, 100);
        assert_eq!(monitor.percent(0), 0);
        assert_eq!(monitor.percent(37), 37);
        assert_eq!(monitor.percent(100), 100);
        assert_eq!(monitor.percent(250), 100);
        assert_eq!(monitor.raw(37), 37);

        let odd = ddc(10, 50);
        assert_eq!(odd.percent(10), 0);
        assert_eq!(odd.percent(30), 50);
        assert_eq!(odd.percent(50), 100);
        assert_eq!(odd.percent(5), 0);
        assert_eq!(odd.raw(50), 30);
        assert_eq!(odd.raw(100), 50);
        assert_eq!(odd.raw(200), 50);

        // A degenerate range never divides by zero.
        let flat = ddc(20, 20);
        assert_eq!(flat.percent(20), 0);
        assert_eq!(flat.raw(80), 20);
    }

    #[test]
    fn wmi_ids_are_prefixed_and_names_stop_at_nul() {
        assert_eq!(
            wmi_id("DISPLAY\\LEN4000\\4&abc_0"),
            "wmi:DISPLAY\\LEN4000\\4&abc_0"
        );
        let mut buffer = [0_u16; 8];
        for (slot, ch) in buffer.iter_mut().zip("DELL".encode_utf16()) {
            *slot = ch;
        }
        assert_eq!(utf16_until_nul(&buffer), "DELL");
        assert_eq!(utf16_until_nul(&[]), "");
    }

    /// Talks to the real OS; only meaningful on the nightly lab machine. Reads every probed
    /// monitor, then nudges one (an external DDC/CI monitor when present, else the internal
    /// panel through WMI) by five points and puts it back, checking the level comes back as
    /// a `BrightnessChanged` event.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session"
    )]
    fn probes_monitors_and_round_trips_a_level() {
        use std::time::{Duration, Instant};

        let (events, mut rx) = broadcast::channel(32);
        let watcher = Watcher::start(events).unwrap();
        // The first probe runs before the worker reads its inbox; DDC/CI takes ~50 ms a call.
        std::thread::sleep(Duration::from_millis(1500));
        let monitors = watcher.monitors();
        eprintln!("brightness monitors: {monitors:#?}");
        for monitor in &monitors {
            assert!(monitor.percent <= 100);
        }
        assert!(matches!(
            watcher.set("nope", 1),
            Err(PlatformError::NotFound(_))
        ));
        let Some(subject) = monitors
            .iter()
            .find(|m| m.kind == BrightnessKind::External)
            .or_else(|| monitors.first())
        else {
            return;
        };
        let target = if subject.percent >= 50 {
            subject.percent - 5
        } else {
            subject.percent + 5
        };
        let started = Instant::now();
        watcher.set(&subject.id, target).unwrap();
        let deadline = started + Duration::from_secs(3);
        let mut seen = None;
        while Instant::now() < deadline && seen.is_none() {
            match rx.try_recv() {
                Ok(PlatformEvent::BrightnessChanged {
                    monitor_id,
                    percent,
                }) if monitor_id == subject.id && percent == target => {
                    seen = Some(started.elapsed());
                }
                Ok(_) => {}
                Err(_) => std::thread::sleep(Duration::from_millis(10)),
            }
        }
        let snapshot = watcher
            .monitors()
            .into_iter()
            .find(|m| m.id == subject.id)
            .map(|m| m.percent);
        watcher.set(&subject.id, subject.percent).unwrap();
        std::thread::sleep(Duration::from_millis(500));
        let latency = seen.expect("BrightnessChanged for the new level within 3 s");
        eprintln!(
            "brightness {:?} {} -> {target} observed after {latency:?}",
            subject.kind, subject.percent
        );
        assert_eq!(snapshot, Some(target));
    }
}
