//! Paired Bluetooth devices and their connection state (docs/modules/bluetooth.md,
//! docs/04-windows-platform-apis.md "Bluetooth enumerate"): two `WinRT` `DeviceWatcher`s over
//! the paired classic and LE association endpoints, merged per physical device and published as
//! [`PlatformEvent::BluetoothChanged`]. LE endpoints that expose the GATT Battery Service
//! (`0x180F`) get their level read on connect and refreshed through notifications.
//!
//! Windows reports dual-mode devices (most headsets) as two endpoints that share one
//! `System.Devices.Aep.ContainerId`, and raises `Updated` for every property change, so the
//! endpoints are merged and de-duplicated here: consumers only see transitions. Nothing is
//! published until the initial enumeration completes, so [`Watcher::devices`] seeds consumers
//! with devices that were already connected instead of announcing them at start-up.
//!
//! Watcher callbacks arrive on thread-pool threads. GATT work blocks on async operations, so it
//! is handed to one worker thread and callbacks return immediately.
//!
//! Connect and disconnect (M3-E7) work on the merged device: disconnect drops the baseband link
//! through the radio handle (`super::radio`), which also releases any GATT session held here;
//! connect asks the endpoint for its services uncached, which makes the radio page the device —
//! the only public way to bring a classic link up from an app. Whether the audio profiles follow
//! is the device's decision; the result is judged by the endpoint's `ConnectionStatus`.

use std::collections::HashMap;
use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;
use std::time::Duration;

use parking_lot::{Condvar, Mutex};
use tokio::sync::broadcast;
use tracing::{debug, warn};
use windows::Devices::Bluetooth::GenericAttributeProfile::{
    GattCharacteristic, GattCharacteristicUuids,
    GattClientCharacteristicConfigurationDescriptorValue, GattCommunicationStatus,
    GattDeviceService, GattServiceUuids, GattValueChangedEventArgs,
};
use windows::Devices::Bluetooth::{
    BluetoothCacheMode, BluetoothConnectionStatus, BluetoothDevice as ClassicDevice,
    BluetoothLEDevice,
};
use windows::Devices::Enumeration::{
    DeviceInformation, DeviceInformationKind, DeviceInformationUpdate, DeviceWatcher,
};
use windows::Foundation::{IReference, IReferenceArray, TypedEventHandler};
use windows::Storage::Streams::{DataReader, IBuffer};
use windows::core::{GUID, HSTRING, IInspectable, Interface, Ref, RuntimeType};
use windows_collections::{IIterable, IMapView};

use super::{os_error, radio};
use crate::error::{PlatformError, PlatformResult};
use crate::events::PlatformEvent;
use crate::types::{BluetoothDevice, BluetoothDeviceKind};

/// Association endpoint properties requested from the watchers (`Updated` only fires for these).
const IS_CONNECTED: &str = "System.Devices.Aep.IsConnected";
const CONTAINER_ID: &str = "System.Devices.Aep.ContainerId";
const DEVICE_ADDRESS: &str = "System.Devices.Aep.DeviceAddress";
/// What the device is (`Audio.Headphone`, `Input.Mouse`, …), a string array.
const CATEGORY: &str = "System.Devices.Aep.Category";
/// Carried by `Updated` when the user renames a device.
const DISPLAY_NAME: &str = "System.ItemNameDisplay";

/// Upper bound [`Watcher::devices`] waits for the initial enumeration. Paired devices come from
/// the local registry, so this is normally tens of milliseconds.
const ENUMERATION_TIMEOUT: Duration = Duration::from_secs(2);

/// Owns the watchers and the GATT worker; dropping it stops both.
#[derive(Debug)]
pub(super) struct Watcher {
    shared: Arc<Shared>,
    watchers: Vec<DeviceWatcher>,
    /// Detached on drop: a worker blocked in a GATT read must not delay shutdown.
    _worker: JoinHandle<()>,
}

impl Watcher {
    pub(super) fn start(events: broadcast::Sender<PlatformEvent>) -> PlatformResult<Self> {
        let (jobs, inbox) = mpsc::channel();
        let shared = Arc::new(Shared {
            registry: Mutex::new(Registry::default()),
            events,
            jobs,
            pending: Mutex::new(2),
            ready: Condvar::new(),
        });
        let worker = std::thread::Builder::new()
            .name("muna-platform-bluetooth".into())
            .spawn({
                let shared = Arc::clone(&shared);
                move || run_worker(&shared, &inbox)
            })
            .map_err(|_| PlatformError::Unsupported("bluetooth worker thread"))?;
        let classic = ClassicDevice::GetDeviceSelectorFromPairingState(true)
            .map_err(|e| os_error("BluetoothDevice.GetDeviceSelectorFromPairingState", &e))?;
        let le = BluetoothLEDevice::GetDeviceSelectorFromPairingState(true)
            .map_err(|e| os_error("BluetoothLEDevice.GetDeviceSelectorFromPairingState", &e))?;
        let watchers = vec![
            watch(&shared, Transport::Classic, &classic)?,
            watch(&shared, Transport::Le, &le)?,
        ];
        Ok(Self {
            shared,
            watchers,
            _worker: worker,
        })
    }

    /// Snapshot of every paired device, once the initial enumeration has completed.
    pub(super) fn devices(&self) -> Vec<BluetoothDevice> {
        self.shared.wait_ready();
        let registry = self.shared.registry.lock();
        let mut devices: Vec<BluetoothDevice> = registry
            .devices
            .iter()
            .map(|(id, entry)| entry.device(id))
            .collect();
        devices.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        devices
    }

    /// Brings the link to a paired device up (see the module docs). Blocking: the radio pages
    /// the device, which takes seconds when it is out of range.
    pub(super) fn connect(&self, id: &str) -> PlatformResult<()> {
        let link = self.link(id)?;
        if link.connected {
            return Ok(());
        }
        // The classic endpoint carries the audio and input profiles; LE is the fallback.
        if let Some(aep_id) = link.classic {
            return connect_classic(&HSTRING::from(aep_id));
        }
        if let Some(aep_id) = link.le {
            return connect_le(&HSTRING::from(aep_id));
        }
        Err(PlatformError::NotFound(format!("bluetooth device {id}")))
    }

    /// Drops the link to a connected device. Any GATT session held here is released first so
    /// the LE link is not held open by Muna itself.
    pub(super) fn disconnect(&self, id: &str) -> PlatformResult<()> {
        let link = self.link(id)?;
        if !link.connected {
            return Ok(());
        }
        // The worker only goes away when the watcher is dropped.
        let _ = self.shared.jobs.send(Job::Release {
            device_id: id.to_owned(),
        });
        let address = parse_address(&link.address)
            .ok_or(PlatformError::Unsupported("bluetooth disconnect"))?;
        radio::disconnect_address(address)
    }

    fn link(&self, id: &str) -> PlatformResult<Link> {
        self.shared.wait_ready();
        let registry = self.shared.registry.lock();
        let entry = registry
            .devices
            .get(id)
            .ok_or_else(|| PlatformError::NotFound(format!("bluetooth device {id}")))?;
        Ok(Link {
            address: entry.address.clone(),
            connected: entry.connected(),
            classic: entry.classic.as_ref().map(|e| e.aep_id.clone()),
            le: entry.le.as_ref().map(|e| e.aep_id.clone()),
        })
    }
}

/// What connect and disconnect need to know about a device, copied out of the registry so no
/// lock is held across a blocking call.
#[derive(Debug)]
struct Link {
    address: String,
    connected: bool,
    classic: Option<String>,
    le: Option<String>,
}

/// Pages a classic device by asking for its RFCOMM services uncached, then reads the endpoint's
/// connection status. `Unsupported` when the link did not come up: the device is off, out of
/// range, or only connects on its own terms.
fn connect_classic(aep_id: &HSTRING) -> PlatformResult<()> {
    let device = ClassicDevice::FromIdAsync(aep_id)
        .and_then(|operation| operation.join())
        .map_err(|e| os_error("BluetoothDevice.FromIdAsync", &e))?;
    let probe = device
        .GetRfcommServicesWithCacheModeAsync(BluetoothCacheMode::Uncached)
        .and_then(|operation| operation.join());
    if let Err(error) = probe {
        debug!(%error, "rfcomm service probe failed");
    }
    let status = device
        .ConnectionStatus()
        .map_err(|e| os_error("BluetoothDevice.ConnectionStatus", &e))?;
    if status == BluetoothConnectionStatus::Connected {
        Ok(())
    } else {
        Err(PlatformError::Unsupported("bluetooth connect"))
    }
}

/// Opens an LE link by asking for the device's GATT services uncached. Windows keeps an LE
/// link only while a driver or an app uses it; the watcher's battery session takes over when
/// the device has a Battery Service, otherwise the link may drop again once this returns.
fn connect_le(aep_id: &HSTRING) -> PlatformResult<()> {
    let device = BluetoothLEDevice::FromIdAsync(aep_id)
        .and_then(|operation| operation.join())
        .map_err(|e| os_error("BluetoothLEDevice.FromIdAsync", &e))?;
    let probe = device
        .GetGattServicesWithCacheModeAsync(BluetoothCacheMode::Uncached)
        .and_then(|operation| operation.join());
    if let Err(error) = probe {
        debug!(%error, "gatt service probe failed");
    }
    let status = device
        .ConnectionStatus()
        .map_err(|e| os_error("BluetoothLEDevice.ConnectionStatus", &e))?;
    if status == BluetoothConnectionStatus::Connected {
        Ok(())
    } else {
        Err(PlatformError::Unsupported("bluetooth connect"))
    }
}

/// `System.Devices.Aep.DeviceAddress` (`a4:c3:f0:12:34:56`, most significant octet first) as
/// the `BTH_ADDR` the radio IOCTL takes.
fn parse_address(address: &str) -> Option<u64> {
    let octets: Vec<u8> = address
        .split(':')
        .map(|octet| u8::from_str_radix(octet, 16).ok())
        .collect::<Option<_>>()?;
    if octets.len() != 6 {
        return None;
    }
    Some(
        octets
            .into_iter()
            .fold(0u64, |address, octet| (address << 8) | u64::from(octet)),
    )
}

impl Drop for Watcher {
    fn drop(&mut self) {
        for watcher in &self.watchers {
            if let Err(error) = watcher.Stop() {
                debug!(%error, "DeviceWatcher.Stop failed");
            }
        }
        // The worker may already be gone; either way there is nothing left to do.
        let _ = self.shared.jobs.send(Job::Stop);
    }
}

fn watch(
    shared: &Arc<Shared>,
    transport: Transport,
    selector: &HSTRING,
) -> PlatformResult<DeviceWatcher> {
    let properties = IIterable::<HSTRING>::from(vec![
        HSTRING::from(IS_CONNECTED),
        HSTRING::from(CONTAINER_ID),
        HSTRING::from(DEVICE_ADDRESS),
        HSTRING::from(CATEGORY),
    ]);
    let watcher = DeviceInformation::CreateWatcherWithKindAqsFilterAndAdditionalProperties(
        selector,
        &properties,
        DeviceInformationKind::AssociationEndpoint,
    )
    .map_err(|e| os_error("DeviceInformation.CreateWatcher", &e))?;

    let on_added = {
        let shared = Arc::clone(shared);
        TypedEventHandler::<DeviceWatcher, DeviceInformation>::new(move |_, info| {
            if let Err(error) = added(&shared, transport, info.ok()?) {
                warn!(%error, ?transport, "bluetooth endpoint could not be read");
            }
            Ok(())
        })
    };
    let on_updated = {
        let shared = Arc::clone(shared);
        TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(move |_, update| {
            if let Err(error) = updated(&shared, update.ok()?) {
                warn!(%error, ?transport, "bluetooth endpoint update could not be read");
            }
            Ok(())
        })
    };
    let on_removed = {
        let shared = Arc::clone(shared);
        TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(move |_, update| {
            let aep_id = update.ok()?.Id()?.to_string_lossy();
            shared.apply(Change::Removed { aep_id });
            Ok(())
        })
    };
    let on_completed = {
        let shared = Arc::clone(shared);
        TypedEventHandler::<DeviceWatcher, IInspectable>::new(move |_, _| {
            shared.enumeration_completed(transport);
            Ok(())
        })
    };
    watcher
        .Added(&on_added)
        .map_err(|e| os_error("DeviceWatcher.Added", &e))?;
    watcher
        .Updated(&on_updated)
        .map_err(|e| os_error("DeviceWatcher.Updated", &e))?;
    watcher
        .Removed(&on_removed)
        .map_err(|e| os_error("DeviceWatcher.Removed", &e))?;
    watcher
        .EnumerationCompleted(&on_completed)
        .map_err(|e| os_error("DeviceWatcher.EnumerationCompleted", &e))?;
    watcher
        .Start()
        .map_err(|e| os_error("DeviceWatcher.Start", &e))?;
    Ok(watcher)
}

fn added(
    shared: &Shared,
    transport: Transport,
    info: &DeviceInformation,
) -> windows::core::Result<()> {
    let properties = info.Properties()?;
    let aep_id = info.Id()?.to_string_lossy();
    let address = property::<HSTRING>(&properties, DEVICE_ADDRESS)
        .map(|address| address.to_string_lossy().to_lowercase());
    // The container groups the classic and LE endpoints of one physical device and survives
    // reboots; the address is the fallback for endpoints that report none.
    let device_id = property::<GUID>(&properties, CONTAINER_ID)
        .map(|container| format!("{container:?}").to_lowercase())
        .or_else(|| address.clone())
        .unwrap_or_else(|| aep_id.clone());
    let categories = property_array(&properties, CATEGORY).unwrap_or_default();
    shared.apply(Change::Added {
        transport,
        aep_id,
        device_id,
        address: address.unwrap_or_default(),
        name: info.Name()?.to_string_lossy(),
        connected: property::<bool>(&properties, IS_CONNECTED).unwrap_or(false),
        kind: BluetoothDeviceKind::from_categories(categories.iter().map(String::as_str)),
    });
    Ok(())
}

fn updated(shared: &Shared, update: &DeviceInformationUpdate) -> windows::core::Result<()> {
    let properties = update.Properties()?;
    shared.apply(Change::Updated {
        aep_id: update.Id()?.to_string_lossy(),
        connected: property::<bool>(&properties, IS_CONNECTED),
        name: property::<HSTRING>(&properties, DISPLAY_NAME).map(|name| name.to_string_lossy()),
    });
    Ok(())
}

/// A boxed property value, or `None` when it is absent, empty or of another type.
fn property<T: RuntimeType + 'static>(
    properties: &IMapView<HSTRING, IInspectable>,
    key: &str,
) -> Option<T> {
    let value = properties.Lookup(&HSTRING::from(key)).ok()?;
    value.cast::<IReference<T>>().ok()?.Value().ok()
}

/// A boxed string-array property, or `None` when it is absent or of another type.
fn property_array(properties: &IMapView<HSTRING, IInspectable>, key: &str) -> Option<Vec<String>> {
    let value = properties.Lookup(&HSTRING::from(key)).ok()?;
    let array = value
        .cast::<IReferenceArray<HSTRING>>()
        .ok()?
        .Value()
        .ok()?;
    Some(array.iter().map(HSTRING::to_string_lossy).collect())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Transport {
    Classic,
    Le,
}

/// What a watcher callback learnt, reduced to the fields the registry needs.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Change {
    Added {
        transport: Transport,
        aep_id: String,
        device_id: String,
        address: String,
        name: String,
        connected: bool,
        kind: BluetoothDeviceKind,
    },
    /// `Updated` carries only the properties that changed.
    Updated {
        aep_id: String,
        connected: Option<bool>,
        name: Option<String>,
    },
    Removed {
        aep_id: String,
    },
}

/// GATT work for the worker thread.
#[derive(Debug)]
enum Job {
    /// An LE endpoint connected: read the battery level and follow its notifications.
    Watch {
        device_id: String,
        aep_id: HSTRING,
    },
    /// The endpoint disconnected or was unpaired: release the GATT session.
    Release {
        device_id: String,
    },
    Stop,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Endpoint {
    aep_id: String,
    name: String,
    connected: bool,
    /// From `System.Devices.Aep.Category`; usually only the classic endpoint says.
    kind: BluetoothDeviceKind,
}

/// One physical device: up to one endpoint per transport plus the LE battery reading.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct Entry {
    address: String,
    classic: Option<Endpoint>,
    le: Option<Endpoint>,
    battery_percent: Option<u8>,
}

impl Entry {
    fn endpoint_mut(&mut self, transport: Transport) -> &mut Option<Endpoint> {
        match transport {
            Transport::Classic => &mut self.classic,
            Transport::Le => &mut self.le,
        }
    }

    fn endpoints(&self) -> impl Iterator<Item = &Endpoint> {
        self.classic.iter().chain(self.le.iter())
    }

    fn connected(&self) -> bool {
        self.endpoints().any(|endpoint| endpoint.connected)
    }

    fn is_empty(&self) -> bool {
        self.classic.is_none() && self.le.is_none()
    }

    fn device(&self, id: &str) -> BluetoothDevice {
        let name = self
            .endpoints()
            .map(|endpoint| endpoint.name.as_str())
            .find(|name| !name.is_empty())
            .unwrap_or(&self.address);
        let kind = self
            .endpoints()
            .map(|endpoint| endpoint.kind)
            .find(|kind| *kind != BluetoothDeviceKind::Other)
            .unwrap_or_else(|| BluetoothDeviceKind::from_name(name));
        BluetoothDevice {
            id: id.to_owned(),
            name: name.to_owned(),
            connected: self.connected(),
            battery_percent: self.battery_percent,
            kind,
        }
    }
}

/// The merged view of both watchers plus the follow-up a change warrants.
#[derive(Debug, Default)]
struct Outcome {
    before: Option<BluetoothDevice>,
    after: Option<BluetoothDevice>,
    job: Option<Job>,
}

#[derive(Debug, Default)]
struct Registry {
    /// Merged devices keyed by the id exposed as [`BluetoothDevice::id`].
    devices: HashMap<String, Entry>,
    /// Endpoint id → device id and transport, for `Updated`/`Removed` which carry only the former.
    endpoints: HashMap<String, (String, Transport)>,
}

impl Registry {
    fn snapshot(&self, device_id: &str) -> Option<BluetoothDevice> {
        self.devices
            .get(device_id)
            .map(|entry| entry.device(device_id))
    }

    fn apply(&mut self, change: Change) -> Outcome {
        match change {
            Change::Added {
                transport,
                aep_id,
                device_id,
                address,
                name,
                connected,
                kind,
            } => self.add(
                transport,
                aep_id,
                device_id,
                address,
                Endpoint {
                    aep_id: String::new(),
                    name,
                    connected,
                    kind,
                },
            ),
            Change::Updated {
                aep_id,
                connected,
                name,
            } => self.update(&aep_id, connected, name),
            Change::Removed { aep_id } => self.remove(&aep_id),
        }
    }

    fn add(
        &mut self,
        transport: Transport,
        aep_id: String,
        device_id: String,
        address: String,
        endpoint: Endpoint,
    ) -> Outcome {
        // Re-pairing can move an endpoint to another container; drop the stale link first.
        if let Some((previous, _)) = self.endpoints.get(&aep_id).cloned()
            && previous != device_id
        {
            self.remove(&aep_id);
        }
        let before = self.snapshot(&device_id);
        let entry = self.devices.entry(device_id.clone()).or_default();
        if entry.address.is_empty() {
            entry.address = address;
        }
        let connected = endpoint.connected;
        *entry.endpoint_mut(transport) = Some(Endpoint {
            aep_id: aep_id.clone(),
            ..endpoint
        });
        self.endpoints
            .insert(aep_id.clone(), (device_id.clone(), transport));
        let after = self.snapshot(&device_id);
        let job = (transport == Transport::Le && connected).then(|| Job::Watch {
            device_id,
            aep_id: HSTRING::from(aep_id),
        });
        Outcome { before, after, job }
    }

    fn update(&mut self, aep_id: &str, connected: Option<bool>, name: Option<String>) -> Outcome {
        let Some((device_id, transport)) = self.endpoints.get(aep_id).cloned() else {
            return Outcome::default();
        };
        let before = self.snapshot(&device_id);
        let Some(entry) = self.devices.get_mut(&device_id) else {
            return Outcome::default();
        };
        let Some(endpoint) = entry.endpoint_mut(transport).as_mut() else {
            return Outcome::default();
        };
        let was_connected = endpoint.connected;
        if let Some(connected) = connected {
            endpoint.connected = connected;
        }
        if let Some(name) = name {
            endpoint.name = name;
        }
        let now_connected = endpoint.connected;
        if !entry.connected() {
            entry.battery_percent = None;
        }
        let after = self.snapshot(&device_id);
        let job = match (transport, was_connected, now_connected) {
            (Transport::Le, false, true) => Some(Job::Watch {
                device_id,
                aep_id: HSTRING::from(aep_id),
            }),
            (Transport::Le, true, false) => Some(Job::Release { device_id }),
            _ => None,
        };
        Outcome { before, after, job }
    }

    fn remove(&mut self, aep_id: &str) -> Outcome {
        let Some((device_id, transport)) = self.endpoints.remove(aep_id) else {
            return Outcome::default();
        };
        let before = self.snapshot(&device_id);
        let mut job = None;
        if let Some(entry) = self.devices.get_mut(&device_id) {
            if let Some(endpoint) = entry.endpoint_mut(transport).take()
                && transport == Transport::Le
                && endpoint.connected
            {
                job = Some(Job::Release {
                    device_id: device_id.clone(),
                });
            }
            if !entry.connected() {
                entry.battery_percent = None;
            }
            if entry.is_empty() {
                self.devices.remove(&device_id);
            }
        }
        // Unpairing a connected device reads as a disconnect to consumers.
        let after = self.snapshot(&device_id).or_else(|| {
            before
                .as_ref()
                .filter(|device| device.connected)
                .map(|device| BluetoothDevice {
                    connected: false,
                    battery_percent: None,
                    ..device.clone()
                })
        });
        Outcome { before, after, job }
    }

    /// Records a battery level for a connected device; returns the device when it changed.
    fn set_battery(&mut self, device_id: &str, percent: u8) -> Option<BluetoothDevice> {
        let entry = self.devices.get_mut(device_id)?;
        if !entry.connected() || entry.battery_percent == Some(percent) {
            return None;
        }
        entry.battery_percent = Some(percent);
        Some(entry.device(device_id))
    }
}

/// State shared by the watcher callbacks, the GATT worker and [`Watcher`].
#[derive(Debug)]
struct Shared {
    registry: Mutex<Registry>,
    events: broadcast::Sender<PlatformEvent>,
    jobs: mpsc::Sender<Job>,
    /// Watchers whose initial enumeration is still running.
    pending: Mutex<u8>,
    ready: Condvar,
}

impl Shared {
    fn apply(&self, change: Change) {
        let outcome = self.registry.lock().apply(change);
        if let Some(job) = outcome.job {
            // The worker only goes away when the watcher is dropped.
            let _ = self.jobs.send(job);
        }
        if let Some(after) = outcome.after
            && outcome.before.as_ref() != Some(&after)
        {
            self.publish(after);
        }
    }

    fn set_battery(&self, device_id: &str, percent: u8) {
        if let Some(device) = self.registry.lock().set_battery(device_id, percent) {
            self.publish(device);
        }
    }

    /// Consumers seed themselves from [`Watcher::devices`]; changes found by the initial
    /// enumeration are part of that snapshot, not events.
    fn publish(&self, device: BluetoothDevice) {
        if *self.pending.lock() > 0 {
            return;
        }
        // No subscribers yet is not an error.
        let _ = self.events.send(PlatformEvent::BluetoothChanged(device));
    }

    fn enumeration_completed(&self, transport: Transport) {
        let mut pending = self.pending.lock();
        *pending = pending.saturating_sub(1);
        debug!(
            ?transport,
            remaining = *pending,
            "bluetooth enumeration completed"
        );
        if *pending == 0 {
            self.ready.notify_all();
        }
    }

    fn wait_ready(&self) {
        let mut pending = self.pending.lock();
        if *pending > 0
            && self
                .ready
                .wait_for(&mut pending, ENUMERATION_TIMEOUT)
                .timed_out()
        {
            debug!("bluetooth enumeration still running; returning a partial snapshot");
        }
    }
}

fn run_worker(shared: &Arc<Shared>, inbox: &mpsc::Receiver<Job>) {
    let mut sessions: HashMap<String, BatterySession> = HashMap::new();
    while let Ok(job) = inbox.recv() {
        match job {
            Job::Watch { device_id, aep_id } => {
                if sessions.contains_key(&device_id) {
                    continue;
                }
                match BatterySession::open(shared, &device_id, &aep_id) {
                    Ok(Some(session)) => {
                        sessions.insert(device_id, session);
                    }
                    Ok(None) => debug!(device = %device_id, "no gatt battery service"),
                    Err(error) => debug!(device = %device_id, %error, "gatt battery unavailable"),
                }
            }
            Job::Release { device_id } => {
                sessions.remove(&device_id);
            }
            Job::Stop => break,
        }
    }
}

/// An open GATT battery characteristic; the objects must stay alive for notifications to flow.
#[derive(Debug)]
struct BatterySession {
    device: BluetoothLEDevice,
    service: GattDeviceService,
    characteristic: GattCharacteristic,
    token: Option<i64>,
}

impl BatterySession {
    /// Reads the level once and subscribes to changes; `Ok(None)` when the device has no
    /// Battery Service or it cannot be reached.
    fn open(
        shared: &Arc<Shared>,
        device_id: &str,
        aep_id: &HSTRING,
    ) -> windows::core::Result<Option<Self>> {
        let device = BluetoothLEDevice::FromIdAsync(aep_id)?.join()?;
        let services = device
            .GetGattServicesForUuidWithCacheModeAsync(
                GattServiceUuids::Battery()?,
                BluetoothCacheMode::Uncached,
            )?
            .join()?;
        if services.Status()? != GattCommunicationStatus::Success
            || services.Services()?.Size()? == 0
        {
            return Ok(None);
        }
        let service = services.Services()?.GetAt(0)?;
        let characteristics = service
            .GetCharacteristicsForUuidAsync(GattCharacteristicUuids::BatteryLevel()?)?
            .join()?;
        if characteristics.Status()? != GattCommunicationStatus::Success
            || characteristics.Characteristics()?.Size()? == 0
        {
            return Ok(None);
        }
        let characteristic = characteristics.Characteristics()?.GetAt(0)?;

        let read = characteristic
            .ReadValueWithCacheModeAsync(BluetoothCacheMode::Uncached)?
            .join()?;
        if read.Status()? == GattCommunicationStatus::Success
            && let Some(percent) = percent_from(&read.Value()?)
        {
            shared.set_battery(device_id, percent);
        }

        let subscribed = characteristic
            .WriteClientCharacteristicConfigurationDescriptorAsync(
                GattClientCharacteristicConfigurationDescriptorValue::Notify,
            )?
            .join()?;
        let token = if subscribed == GattCommunicationStatus::Success {
            let shared = Arc::clone(shared);
            let device_id = device_id.to_owned();
            let handler = TypedEventHandler::<GattCharacteristic, GattValueChangedEventArgs>::new(
                move |_, args: Ref<GattValueChangedEventArgs>| {
                    if let Some(percent) = percent_from(&args.ok()?.CharacteristicValue()?) {
                        shared.set_battery(&device_id, percent);
                    }
                    Ok(())
                },
            );
            Some(characteristic.ValueChanged(&handler)?)
        } else {
            debug!(device = %device_id, ?subscribed, "battery notifications unavailable");
            None
        };
        Ok(Some(Self {
            device,
            service,
            characteristic,
            token,
        }))
    }
}

impl Drop for BatterySession {
    fn drop(&mut self) {
        if let Some(token) = self.token
            && let Err(error) = self.characteristic.RemoveValueChanged(token)
        {
            debug!(%error, "GattCharacteristic.RemoveValueChanged failed");
        }
        if let Err(error) = self.service.Close() {
            debug!(%error, "GattDeviceService.Close failed");
        }
        if let Err(error) = self.device.Close() {
            debug!(%error, "BluetoothLEDevice.Close failed");
        }
    }
}

/// Battery Level characteristic: one byte, 0–100.
fn percent_from(buffer: &IBuffer) -> Option<u8> {
    let reader = DataReader::FromBuffer(buffer).ok()?;
    if reader.UnconsumedBufferLength().ok()? == 0 {
        return None;
    }
    reader.ReadByte().ok().map(|raw| raw.min(100))
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONTAINER: &str = "3a2f9c1e-0000-4000-8000-000000000001";

    fn added(transport: Transport, aep_id: &str, name: &str, connected: bool) -> Change {
        added_as(
            transport,
            aep_id,
            name,
            connected,
            BluetoothDeviceKind::Other,
        )
    }

    fn added_as(
        transport: Transport,
        aep_id: &str,
        name: &str,
        connected: bool,
        kind: BluetoothDeviceKind,
    ) -> Change {
        Change::Added {
            transport,
            aep_id: aep_id.into(),
            device_id: CONTAINER.into(),
            address: "a4:c3:f0:12:34:56".into(),
            name: name.into(),
            connected,
            kind,
        }
    }

    fn connected(outcome: &Outcome) -> Option<bool> {
        outcome.after.as_ref().map(|device| device.connected)
    }

    fn changed(outcome: &Outcome) -> bool {
        outcome.after.is_some() && outcome.before != outcome.after
    }

    #[test]
    fn dual_mode_endpoints_merge_into_one_device() {
        let mut registry = Registry::default();
        let first = registry.apply(added(Transport::Classic, "classic#1", "Buds", true));
        assert!(changed(&first));
        assert_eq!(connected(&first), Some(true));

        // The LE endpoint of the same container adds nothing visible: still one connected device.
        let second = registry.apply(added(Transport::Le, "le#1", "Buds LE", false));
        assert!(!changed(&second));
        assert_eq!(registry.devices.len(), 1);
        let device = registry.snapshot(CONTAINER).unwrap();
        assert_eq!(device.name, "Buds");
        assert!(device.connected);
    }

    #[test]
    fn repeated_property_updates_do_not_change_the_device() {
        let mut registry = Registry::default();
        registry.apply(added(Transport::Classic, "classic#1", "Buds", true));
        let again = registry.apply(Change::Updated {
            aep_id: "classic#1".into(),
            connected: Some(true),
            name: None,
        });
        assert!(!changed(&again));
        let unknown = registry.apply(Change::Updated {
            aep_id: "never-added".into(),
            connected: Some(true),
            name: None,
        });
        assert!(unknown.after.is_none());
    }

    #[test]
    fn device_stays_connected_while_one_transport_remains() {
        let mut registry = Registry::default();
        registry.apply(added(Transport::Classic, "classic#1", "Buds", true));
        registry.apply(added(Transport::Le, "le#1", "", true));
        let le_dropped = registry.apply(Change::Updated {
            aep_id: "le#1".into(),
            connected: Some(false),
            name: None,
        });
        assert!(!changed(&le_dropped));
        assert!(matches!(le_dropped.job, Some(Job::Release { .. })));

        let classic_dropped = registry.apply(Change::Updated {
            aep_id: "classic#1".into(),
            connected: Some(false),
            name: None,
        });
        assert!(changed(&classic_dropped));
        assert_eq!(connected(&classic_dropped), Some(false));
    }

    #[test]
    fn le_connect_requests_a_battery_watch_and_battery_clears_on_disconnect() {
        let mut registry = Registry::default();
        let connect = registry.apply(added(Transport::Le, "le#1", "Mouse", true));
        assert!(matches!(connect.job, Some(Job::Watch { .. })));

        assert_eq!(
            registry
                .set_battery(CONTAINER, 57)
                .and_then(|device| device.battery_percent),
            Some(57)
        );
        assert!(
            registry.set_battery(CONTAINER, 57).is_none(),
            "same level is not a change"
        );

        let disconnect = registry.apply(Change::Updated {
            aep_id: "le#1".into(),
            connected: Some(false),
            name: None,
        });
        assert_eq!(connected(&disconnect), Some(false));
        assert_eq!(disconnect.after.unwrap().battery_percent, None);
        assert!(
            registry.set_battery(CONTAINER, 40).is_none(),
            "disconnected devices ignore readings"
        );
    }

    #[test]
    fn unpairing_a_connected_device_reads_as_a_disconnect() {
        let mut registry = Registry::default();
        registry.apply(added(Transport::Classic, "classic#1", "Buds", true));
        let removed = registry.apply(Change::Removed {
            aep_id: "classic#1".into(),
        });
        assert_eq!(connected(&removed), Some(false));
        assert!(registry.devices.is_empty());
        assert!(registry.endpoints.is_empty());

        let again = registry.apply(Change::Removed {
            aep_id: "classic#1".into(),
        });
        assert!(again.after.is_none());
    }

    #[test]
    fn unpairing_a_disconnected_device_is_silent() {
        let mut registry = Registry::default();
        registry.apply(added(Transport::Le, "le#1", "Mouse", false));
        let removed = registry.apply(Change::Removed {
            aep_id: "le#1".into(),
        });
        assert!(removed.after.is_none());
        assert!(removed.job.is_none());
    }

    #[test]
    fn name_falls_back_to_the_address_and_follows_renames() {
        let mut registry = Registry::default();
        registry.apply(added(Transport::Le, "le#1", "", true));
        assert_eq!(
            registry.snapshot(CONTAINER).unwrap().name,
            "a4:c3:f0:12:34:56"
        );
        let renamed = registry.apply(Change::Updated {
            aep_id: "le#1".into(),
            connected: None,
            name: Some("Trackpad".into()),
        });
        assert!(changed(&renamed));
        assert_eq!(renamed.after.unwrap().name, "Trackpad");
    }

    #[test]
    fn re_pairing_into_another_container_moves_the_endpoint() {
        let mut registry = Registry::default();
        registry.apply(added(Transport::Classic, "classic#1", "Buds", true));
        let moved = registry.apply(Change::Added {
            transport: Transport::Classic,
            aep_id: "classic#1".into(),
            device_id: "other-container".into(),
            address: String::new(),
            name: "Buds".into(),
            connected: true,
            kind: BluetoothDeviceKind::Other,
        });
        assert!(changed(&moved));
        assert_eq!(registry.devices.len(), 1);
        assert!(registry.snapshot("other-container").is_some());
        assert_eq!(registry.endpoints["classic#1"].0, "other-container");
    }

    #[test]
    fn the_kind_comes_from_whichever_endpoint_names_one_else_the_name() {
        let mut registry = Registry::default();
        // LE endpoints rarely carry a category; the classic one does.
        registry.apply(added(Transport::Le, "le#1", "Move SE", false));
        assert_eq!(
            registry.snapshot(CONTAINER).unwrap().kind,
            BluetoothDeviceKind::Other
        );
        registry.apply(added_as(
            Transport::Classic,
            "classic#1",
            "Move SE",
            true,
            BluetoothDeviceKind::Headphones,
        ));
        assert_eq!(
            registry.snapshot(CONTAINER).unwrap().kind,
            BluetoothDeviceKind::Headphones
        );

        let mut guessed = Registry::default();
        guessed.apply(added(Transport::Classic, "classic#2", "Galaxy Buds", true));
        assert_eq!(
            guessed.snapshot(CONTAINER).unwrap().kind,
            BluetoothDeviceKind::Headphones,
            "a name that says buds is a headset"
        );
    }

    #[test]
    fn addresses_parse_most_significant_octet_first() {
        assert_eq!(
            parse_address("a4:c3:f0:12:34:56"),
            Some(0x0000_A4C3_F012_3456)
        );
        assert_eq!(parse_address("00:00:00:00:00:01"), Some(1));
        assert_eq!(parse_address(""), None);
        assert_eq!(parse_address("a4:c3:f0:12:34"), None, "five octets");
        assert_eq!(parse_address("zz:c3:f0:12:34:56"), None);
    }

    fn buffer(bytes: &[u8]) -> IBuffer {
        let writer = windows::Storage::Streams::DataWriter::new().unwrap();
        writer.WriteBytes(bytes).unwrap();
        writer.DetachBuffer().unwrap()
    }

    #[test]
    fn battery_level_is_the_first_byte_clamped_to_100() {
        assert_eq!(percent_from(&buffer(&[57])), Some(57));
        assert_eq!(percent_from(&buffer(&[250, 1])), Some(100));
        assert_eq!(percent_from(&buffer(&[])), None);
    }
}
