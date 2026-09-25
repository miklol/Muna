//! The `bluetooth` module backend (docs/modules/bluetooth.md): the panel's view of every
//! paired device and the radio, connect and disconnect, and the low-battery notices at 20 and
//! 10 %. The connect and disconnect notices themselves stay with `live-activities`, which has
//! reported them since M1.
//!
//! The service is a reducer over the platform's Bluetooth events plus one snapshot at start-up,
//! so `tests/bluetooth.rs` drives it with `FakePlatform` alone. Connect, disconnect and the
//! radio toggle are the platform's blocking calls; the IPC layer runs them off the async
//! threads and hands back the snapshot as it stands afterwards.

pub mod settings;

use std::collections::HashMap;
use std::sync::Arc;

use muna_core::{
    Glyph, Hub, Leading, Notice, Settings, StripMessage, Tint, Trailing, activities::priority,
};
use muna_platform::{
    BluetoothDevice, BluetoothDeviceKind, BluetoothRadioState, Platform, PlatformError,
    PlatformEvent,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use settings::BluetoothSettings;

pub const ID: &str = "bluetooth";
/// Battery levels at which a connected device earns a notice, highest first
/// (docs/modules/bluetooth.md "Behaviour").
pub const LOW_THRESHOLDS: [u8; 2] = [20, 10];

/// What the panel and the settings pane show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothSnapshot {
    pub radio: BluetoothRadioState,
    /// `false` when this build cannot enumerate devices at all (the watchers failed to start,
    /// or a platform without Bluetooth); the panel then says so instead of showing an empty list.
    pub available: bool,
    /// Connected first, then by name. Hidden devices are included with `hidden: true` so the
    /// settings pane can offer them back; the panel leaves them out.
    pub devices: Vec<BluetoothDeviceView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothDeviceView {
    pub id: String,
    pub name: String,
    pub connected: bool,
    pub battery_percent: Option<u8>,
    pub kind: BluetoothDeviceKind,
    pub hidden: bool,
}

/// What the panel can ask for. Hiding a device is a setting (`hiddenDevices`), written through
/// the settings editor like any other.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BluetoothCommand {
    Connect { id: String },
    Disconnect { id: String },
    SetRadio { on: bool },
}

/// Where the module reports a changed snapshot; the shell bridges it to a Tauri event.
pub trait BluetoothSink: Send + Sync {
    fn changed(&self, snapshot: &BluetoothSnapshot);
}

#[derive(Debug)]
struct State {
    radio: BluetoothRadioState,
    available: bool,
    devices: HashMap<String, BluetoothDevice>,
    /// Per connected device, the most severe threshold already announced; cleared when the
    /// level climbs back above the highest threshold or the device disconnects.
    announced: HashMap<String, u8>,
}

impl State {
    /// `Unavailable` and empty until [`BluetoothService::seed`] asks the platform.
    fn new() -> Self {
        Self {
            radio: BluetoothRadioState::Unavailable,
            available: false,
            devices: HashMap::new(),
            announced: HashMap::new(),
        }
    }
}

pub struct BluetoothService {
    platform: Arc<dyn Platform>,
    hub: Arc<Hub>,
    settings: Mutex<BluetoothSettings>,
    sink: Mutex<Option<Arc<dyn BluetoothSink>>>,
    state: Mutex<State>,
}

impl std::fmt::Debug for BluetoothService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let state = self.state.lock();
        f.debug_struct("BluetoothService")
            .field("settings", &*self.settings.lock())
            .field("radio", &state.radio)
            .field("devices", &state.devices.len())
            .finish_non_exhaustive()
    }
}

impl BluetoothService {
    #[must_use]
    pub fn new(platform: Arc<dyn Platform>, hub: Arc<Hub>) -> Self {
        Self {
            platform,
            hub,
            settings: Mutex::new(BluetoothSettings::default()),
            sink: Mutex::new(None),
            state: Mutex::new(State::new()),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn BluetoothSink>) {
        *self.sink.lock() = Some(sink);
    }

    #[must_use]
    pub fn settings(&self) -> BluetoothSettings {
        self.settings.lock().clone()
    }

    /// Reads the platform's current devices and radio. Nothing already true is announced: a
    /// device that starts out low has its thresholds marked as told (the panel shows the level).
    pub fn seed(&self) {
        let devices = self.platform.bluetooth().devices();
        let radio = self.platform.bluetooth().radio();
        {
            let mut state = self.state.lock();
            state.radio = radio;
            state.available = devices.is_ok();
            state.devices.clear();
            state.announced.clear();
            for device in devices.unwrap_or_default() {
                if let Some(threshold) = device
                    .battery_percent
                    .filter(|_| device.connected)
                    .and_then(lowest_threshold_at_or_above)
                {
                    state.announced.insert(device.id.clone(), threshold);
                }
                state.devices.insert(device.id.clone(), device);
            }
        }
        self.emit();
    }

    /// The panel's view as it stands.
    #[must_use]
    pub fn snapshot(&self) -> BluetoothSnapshot {
        let settings = self.settings.lock();
        let state = self.state.lock();
        let mut devices: Vec<BluetoothDeviceView> = state
            .devices
            .values()
            .map(|device| BluetoothDeviceView {
                id: device.id.clone(),
                name: device.name.clone(),
                connected: device.connected,
                battery_percent: device.battery_percent,
                kind: device.kind,
                hidden: settings.is_hidden(&device.id),
            })
            .collect();
        devices.sort_by(|a, b| {
            b.connected
                .cmp(&a.connected)
                .then_with(|| a.name.cmp(&b.name))
                .then_with(|| a.id.cmp(&b.id))
        });
        BluetoothSnapshot {
            radio: state.radio,
            available: state.available,
            devices,
        }
    }

    /// Applies `settings.modules.bluetooth` (start-up and every settings change). A device
    /// hidden or shown again changes the snapshot; turning notices off retracts none already
    /// showing (they hold for seconds at most).
    pub fn apply_settings(&self, settings: &Settings) {
        let next = BluetoothSettings::from_document(settings);
        {
            let mut current = self.settings.lock();
            if *current == next {
                return;
            }
            *current = next;
        }
        self.emit();
    }

    /// Folds one platform event in; other events are ignored. Returns `true` when the
    /// snapshot changed.
    pub fn observe(&self, event: &PlatformEvent) -> bool {
        match event {
            PlatformEvent::BluetoothChanged(device) => {
                let notice = {
                    let mut state = self.state.lock();
                    let notice = self.low_battery_notice(&mut state, device);
                    state.devices.insert(device.id.clone(), device.clone());
                    notice
                };
                if let Some(notice) = notice {
                    self.hub.publish_notice(notice);
                }
                self.emit();
                true
            }
            PlatformEvent::BluetoothRadioChanged(radio) => {
                let changed = {
                    let mut state = self.state.lock();
                    let changed = state.radio != *radio;
                    state.radio = *radio;
                    changed
                };
                if changed {
                    self.emit();
                }
                changed
            }
            _ => false,
        }
    }

    /// Runs one command against the platform and returns the snapshot afterwards. Connect and
    /// disconnect block while the radio works (seconds when the device is out of range), so
    /// the IPC layer calls this from a blocking task. On success the device's state is
    /// updated here at once; the platform's own event confirms it moments later.
    pub fn command(&self, command: BluetoothCommand) -> Result<BluetoothSnapshot, PlatformError> {
        match command {
            BluetoothCommand::Connect { id } => {
                self.platform.bluetooth().connect(&id)?;
                self.set_connected(&id, true);
            }
            BluetoothCommand::Disconnect { id } => {
                self.platform.bluetooth().disconnect(&id)?;
                self.set_connected(&id, false);
            }
            BluetoothCommand::SetRadio { on } => {
                self.platform.bluetooth().set_radio(on)?;
                let radio = if on {
                    BluetoothRadioState::On
                } else {
                    BluetoothRadioState::Off
                };
                self.observe(&PlatformEvent::BluetoothRadioChanged(radio));
            }
        }
        Ok(self.snapshot())
    }

    fn set_connected(&self, id: &str, connected: bool) {
        let changed = {
            let mut state = self.state.lock();
            match state.devices.get_mut(id) {
                Some(device) if device.connected != connected => {
                    device.connected = connected;
                    if !connected {
                        device.battery_percent = None;
                        state.announced.remove(id);
                    }
                    true
                }
                _ => false,
            }
        };
        if changed {
            self.emit();
        }
    }

    /// The notice a device report warrants, if any, and the bookkeeping behind it. Only a
    /// connected device with a reading can be low; a disconnect re-arms both thresholds.
    fn low_battery_notice(&self, state: &mut State, device: &BluetoothDevice) -> Option<Notice> {
        let Some(percent) = device.battery_percent.filter(|_| device.connected) else {
            state.announced.remove(&device.id);
            return None;
        };
        let Some(threshold) = lowest_threshold_at_or_above(percent) else {
            state.announced.remove(&device.id);
            return None;
        };
        let already = state.announced.get(&device.id).copied();
        if already.is_some_and(|told| told <= threshold) {
            return None;
        }
        state.announced.insert(device.id.clone(), threshold);
        self.settings
            .lock()
            .low_battery_notices
            .then(|| low_battery(device, percent, threshold))
    }

    fn emit(&self) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.changed(&self.snapshot());
        }
    }
}

/// The most severe threshold `percent` sits at or under: 10 for 0–10, 20 for 11–20, none above.
fn lowest_threshold_at_or_above(percent: u8) -> Option<u8> {
    LOW_THRESHOLDS
        .iter()
        .rev()
        .copied()
        .find(|threshold| percent <= *threshold)
}

/// The glyph for a device kind; headphones keep their own, everything else is the Bluetooth
/// rune (the strip has no room for a whole icon set).
#[must_use]
pub fn glyph_for(kind: BluetoothDeviceKind) -> Glyph {
    match kind {
        BluetoothDeviceKind::Headphones => Glyph::Headphones,
        _ => Glyph::Bluetooth,
    }
}

/// The low-battery notice: the device's glyph tinted like a low battery (orange at 20, red at
/// 10), the level on the right, "<name> battery low" wide.
#[must_use]
pub fn low_battery(device: &BluetoothDevice, percent: u8, threshold: u8) -> Notice {
    Notice {
        id: format!("bluetooth:low:{}", device.id),
        module: ID.into(),
        priority: priority::BLUETOOTH,
        leading: Some(Leading::Icon {
            glyph: glyph_for(device.kind),
            tint: Some(if threshold <= 10 {
                Tint::Red
            } else {
                Tint::Orange
            }),
        }),
        trailing: Some(Trailing::Battery {
            percent,
            charging: false,
        }),
        wide: Some(StripMessage::DeviceBatteryLow {
            name: device.name.clone(),
            percent,
        }),
        hold_ms: 0,
    }
}

/// The backend: seeds from the platform, then follows its events.
#[derive(Debug, Clone)]
pub struct BluetoothModule(pub Arc<BluetoothService>);

impl ModuleBackend for BluetoothModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Strip, Surface::Panel]
    }

    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()> {
        let service = Arc::clone(&self.0);
        let mut events = ctx.platform.subscribe();
        // `devices()` waits for the platform's first enumeration (bounded); keep that off the
        // start-up path.
        tauri::async_runtime::spawn(async move {
            let seeder = Arc::clone(&service);
            if let Err(error) = tauri::async_runtime::spawn_blocking(move || seeder.seed()).await {
                tracing::warn!(%error, "bluetooth seed task failed");
            }
            loop {
                match events.recv().await {
                    Ok(event) => {
                        service.observe(&event);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "bluetooth events lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        Ok(())
    }
}
