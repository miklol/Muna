//! Core Audio endpoints (docs/modules/hud.md "Volume", docs/04 "HUD"): the default render
//! and capture devices' master volume and mute, mirrored into a snapshot and republished as
//! [`PlatformEvent::VolumeChanged`] / [`PlatformEvent::MicMuteChanged`] whenever
//! `IAudioEndpointVolume` says they changed — hardware keys, the shell's own flyout, another
//! app or Muna itself all arrive the same way.
//!
//! All COM work happens on one MTA worker thread. The two callbacks
//! (`IAudioEndpointVolumeCallback`, `IMMNotificationClient`) fire on Core Audio threads and only
//! post a message; the worker re-binds the default endpoint when
//! `IMMNotificationClient::OnDefaultDeviceChanged` fires, so unplugging headphones keeps the
//! HUD on the device that is actually playing. Setters are queued the same way; the new level
//! comes back through the callback, so consumers never see a value the device did not accept.

use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;

use parking_lot::Mutex;
use tokio::sync::broadcast;
use tracing::{debug, warn};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
};
use windows::Win32::Media::Audio::{
    AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE, DEVICE_STATE_ACTIVE, EDataFlow, ERole, IMMDevice,
    IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator,
    eCapture, eConsole, eRender,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantClear;
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
    CoUninitialize, STGM_READ,
};
use windows::Win32::System::Variant::VT_LPWSTR;
use windows::core::{GUID, PCWSTR, implement};

use super::os_error;
use crate::error::{PlatformError, PlatformResult};
use crate::events::PlatformEvent;
use crate::types::AudioDevice;

/// Marks volume changes Muna made itself in `OnNotify` (they are published like any other).
const MUNA_EVENT_CONTEXT: GUID = GUID::from_u128(0x6d75_6e61_0000_4875_6420_766f_6c75_6d65);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Flow {
    Render,
    Capture,
}

#[derive(Debug)]
enum Msg {
    /// The default device of `flow` changed (or the device list did): re-bind and republish.
    Rebind(Flow),
    /// The endpoint reported a new level.
    Notify {
        flow: Flow,
        percent: u8,
        muted: bool,
    },
    SetVolume(u8),
    SetMuted(bool),
    SetMicMuted(bool),
    Stop,
}

#[derive(Debug, Default)]
struct Snapshot {
    /// `None` until a render endpoint is bound (a machine without speakers).
    volume: Option<(u8, bool)>,
    mic_muted: Option<bool>,
    devices: Vec<AudioDevice>,
}

#[derive(Debug)]
struct Shared {
    snapshot: Mutex<Snapshot>,
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
            snapshot: Mutex::new(Snapshot::default()),
            events,
            inbox,
        });
        let worker = std::thread::Builder::new()
            .name("muna-platform-audio".into())
            .spawn({
                let shared = Arc::clone(&shared);
                move || run_worker(&shared, &outbox)
            })
            .map_err(|_| PlatformError::Unsupported("audio worker thread"))?;
        Ok(Self {
            shared,
            _worker: worker,
        })
    }

    pub(super) fn devices(&self) -> Vec<AudioDevice> {
        self.shared.snapshot.lock().devices.clone()
    }

    pub(super) fn volume(&self) -> PlatformResult<u8> {
        self.render_state().map(|(percent, _)| percent)
    }

    pub(super) fn muted(&self) -> PlatformResult<bool> {
        self.render_state().map(|(_, muted)| muted)
    }

    pub(super) fn mic_muted(&self) -> Option<bool> {
        self.shared.snapshot.lock().mic_muted
    }

    pub(super) fn set_volume(&self, percent: u8) -> PlatformResult<()> {
        self.render_state()?;
        self.send(Msg::SetVolume(percent.min(100)))
    }

    pub(super) fn set_muted(&self, muted: bool) -> PlatformResult<()> {
        self.render_state()?;
        self.send(Msg::SetMuted(muted))
    }

    pub(super) fn set_mic_muted(&self, muted: bool) -> PlatformResult<()> {
        if self.mic_muted().is_none() {
            return Err(PlatformError::NotFound("default capture device".into()));
        }
        self.send(Msg::SetMicMuted(muted))
    }

    fn render_state(&self) -> PlatformResult<(u8, bool)> {
        self.shared
            .snapshot
            .lock()
            .volume
            .ok_or_else(|| PlatformError::NotFound("default render device".into()))
    }

    fn send(&self, msg: Msg) -> PlatformResult<()> {
        self.shared
            .inbox
            .send(msg)
            .map_err(|_| PlatformError::Unsupported("audio worker stopped"))
    }
}

impl Drop for Watcher {
    fn drop(&mut self) {
        let _ = self.shared.inbox.send(Msg::Stop);
    }
}

/// 0.0–1.0 scalar → 0–100.
fn percent_from_scalar(level: f32) -> u8 {
    // Clamped to 0–100 before the cast, so neither truncation nor sign loss can happen.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let percent = (level.clamp(0.0, 1.0) * 100.0).round() as u8;
    percent
}

fn scalar_from_percent(percent: u8) -> f32 {
    f32::from(percent.min(100)) / 100.0
}

// --- COM callbacks -----------------------------------------------------------------------

/// The `#[implement]` expansions carry their own `unsafe` vtable glue and `#[inline(always)]`
/// hints, so this module is exempt from the lints that would otherwise flag generated code.
#[allow(unsafe_code, clippy::ref_as_ptr, clippy::inline_always)]
mod callbacks {
    use super::{
        AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE, EDataFlow, ERole, Flow,
        IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl, IMMNotificationClient,
        IMMNotificationClient_Impl, Msg, PCWSTR, PROPERTYKEY, eCapture, eConsole, eRender,
        implement, mpsc, percent_from_scalar,
    };

    /// Posts endpoint-volume changes to the worker; one per bound endpoint.
    #[implement(IAudioEndpointVolumeCallback)]
    pub(super) struct VolumeCallback {
        pub(super) inbox: mpsc::Sender<Msg>,
        pub(super) flow: Flow,
    }

    impl IAudioEndpointVolumeCallback_Impl for VolumeCallback_Impl {
        fn OnNotify(&self, data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
            if data.is_null() {
                return Ok(());
            }
            // SAFETY: Core Audio passes a pointer to a notification record that stays valid
            // for the duration of this call; only the fixed-size header fields are read.
            let (level, muted) = unsafe { ((*data).fMasterVolume, (*data).bMuted.as_bool()) };
            // A closed inbox means the worker is gone; the callback is unregistered right after.
            let _ = self.inbox.send(Msg::Notify {
                flow: self.flow,
                percent: percent_from_scalar(level),
                muted,
            });
            Ok(())
        }
    }

    /// Posts default-device changes to the worker so it re-binds.
    #[implement(IMMNotificationClient)]
    pub(super) struct DeviceClient {
        pub(super) inbox: mpsc::Sender<Msg>,
    }

    impl IMMNotificationClient_Impl for DeviceClient_Impl {
        fn OnDeviceStateChanged(
            &self,
            _device_id: &PCWSTR,
            _state: DEVICE_STATE,
        ) -> windows::core::Result<()> {
            // The device list changed; the render binding refreshes it.
            let _ = self.inbox.send(Msg::Rebind(Flow::Render));
            Ok(())
        }

        fn OnDeviceAdded(&self, _device_id: &PCWSTR) -> windows::core::Result<()> {
            Ok(())
        }

        fn OnDeviceRemoved(&self, _device_id: &PCWSTR) -> windows::core::Result<()> {
            Ok(())
        }

        fn OnDefaultDeviceChanged(
            &self,
            flow: EDataFlow,
            role: ERole,
            _device_id: &PCWSTR,
        ) -> windows::core::Result<()> {
            if role == eConsole {
                let flow = if flow == eRender {
                    Flow::Render
                } else if flow == eCapture {
                    Flow::Capture
                } else {
                    return Ok(());
                };
                let _ = self.inbox.send(Msg::Rebind(flow));
            }
            Ok(())
        }

        fn OnPropertyValueChanged(
            &self,
            _device_id: &PCWSTR,
            _key: &PROPERTYKEY,
        ) -> windows::core::Result<()> {
            Ok(())
        }
    }
}

use callbacks::{DeviceClient, VolumeCallback};

// --- worker ------------------------------------------------------------------------------

/// One bound default endpoint with the callback to unregister when it goes away.
struct Bound {
    volume: IAudioEndpointVolume,
    callback: IAudioEndpointVolumeCallback,
}

impl Bound {
    fn unhook(&self) {
        // SAFETY: both interfaces are alive; unregistering a callback that was registered on
        // this very endpoint is the documented way to release it.
        #[allow(unsafe_code)]
        if let Err(error) = unsafe { self.volume.UnregisterControlChangeNotify(&self.callback) } {
            debug!(%error, "audio: UnregisterControlChangeNotify failed");
        }
    }
}

struct Worker<'a> {
    shared: &'a Arc<Shared>,
    enumerator: IMMDeviceEnumerator,
    device_client: IMMNotificationClient,
    render: Option<Bound>,
    capture: Option<Bound>,
}

fn run_worker(shared: &Arc<Shared>, outbox: &mpsc::Receiver<Msg>) {
    // SAFETY: initialising COM on this dedicated thread has no preconditions; the matching
    // `CoUninitialize` runs when the loop ends. `S_FALSE` (already initialised) is fine too.
    #[allow(unsafe_code)]
    if let Err(error) = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok() {
        warn!(%error, "audio: CoInitializeEx failed; volume disabled");
        return;
    }
    match Worker::new(shared) {
        Ok(mut worker) => {
            worker.rebind(Flow::Render);
            worker.rebind(Flow::Capture);
            for msg in outbox {
                match msg {
                    Msg::Stop => break,
                    Msg::Rebind(flow) => worker.rebind(flow),
                    Msg::Notify {
                        flow,
                        percent,
                        muted,
                    } => worker.notify(flow, percent, muted),
                    Msg::SetVolume(percent) => worker.set_volume(percent),
                    Msg::SetMuted(muted) => worker.set_muted(Flow::Render, muted),
                    Msg::SetMicMuted(muted) => worker.set_muted(Flow::Capture, muted),
                }
            }
            worker.unhook_all();
        }
        Err(error) => warn!(%error, "audio: device enumerator unavailable; volume disabled"),
    }
    // SAFETY: balances the successful `CoInitializeEx` above on the same thread.
    #[allow(unsafe_code)]
    unsafe {
        CoUninitialize();
    }
    debug!("audio worker stopped");
}

impl<'a> Worker<'a> {
    fn new(shared: &'a Arc<Shared>) -> PlatformResult<Self> {
        // SAFETY: standard COM activation of the documented `MMDeviceEnumerator` class on a
        // thread that initialised COM; the callback object is kept alive in `device_client`
        // until it is unregistered in `unhook_all`.
        #[allow(unsafe_code)]
        let (enumerator, device_client) = unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|error| os_error("CoCreateInstance(MMDeviceEnumerator)", &error))?;
            let device_client: IMMNotificationClient = DeviceClient {
                inbox: shared.inbox.clone(),
            }
            .into();
            enumerator
                .RegisterEndpointNotificationCallback(&device_client)
                .map_err(|error| os_error("RegisterEndpointNotificationCallback", &error))?;
            (enumerator, device_client)
        };
        Ok(Self {
            shared,
            enumerator,
            device_client,
            render: None,
            capture: None,
        })
    }

    fn unhook_all(&mut self) {
        if let Some(bound) = self.render.take() {
            bound.unhook();
        }
        if let Some(bound) = self.capture.take() {
            bound.unhook();
        }
        // SAFETY: the client was registered on this enumerator in `new`.
        #[allow(unsafe_code)]
        if let Err(error) = unsafe {
            self.enumerator
                .UnregisterEndpointNotificationCallback(&self.device_client)
        } {
            debug!(%error, "audio: UnregisterEndpointNotificationCallback failed");
        }
    }

    fn slot(&mut self, flow: Flow) -> &mut Option<Bound> {
        match flow {
            Flow::Render => &mut self.render,
            Flow::Capture => &mut self.capture,
        }
    }

    /// Drops the current binding of `flow`, binds the new default endpoint, reads its level and
    /// publishes it so consumers follow the device that is actually in use.
    fn rebind(&mut self, flow: Flow) {
        if let Some(previous) = self.slot(flow).take() {
            previous.unhook();
        }
        let bound = match self.bind(flow) {
            Ok(bound) => bound,
            Err(PlatformError::NotFound(what)) => {
                debug!(%what, "audio: no default endpoint");
                None
            }
            Err(error) => {
                warn!(%error, ?flow, "audio: binding the default endpoint failed");
                None
            }
        };
        let level = bound.as_ref().and_then(|bound| read_level(&bound.volume));
        *self.slot(flow) = bound;
        if flow == Flow::Render {
            let devices = self.devices();
            self.shared.snapshot.lock().devices = devices;
        }
        match (flow, level) {
            (Flow::Render, Some((percent, muted))) => self.notify(flow, percent, muted),
            (Flow::Render, None) => self.shared.snapshot.lock().volume = None,
            (Flow::Capture, Some((_, muted))) => self.notify(flow, 0, muted),
            (Flow::Capture, None) => self.shared.snapshot.lock().mic_muted = None,
        }
    }

    fn bind(&self, flow: Flow) -> PlatformResult<Option<Bound>> {
        let data_flow = match flow {
            Flow::Render => eRender,
            Flow::Capture => eCapture,
        };
        // SAFETY: documented Core Audio calls on live interfaces; the `Activate` out-pointer is
        // the typed `IAudioEndpointVolume` the generic wrapper fills in; every result is checked.
        #[allow(unsafe_code)]
        unsafe {
            let device = match self.enumerator.GetDefaultAudioEndpoint(data_flow, eConsole) {
                Ok(device) => device,
                // E_NOTFOUND: no device of that kind is present (no microphone, no speakers).
                Err(error) if error.code().0 == 0x8007_0490_u32.cast_signed() => {
                    return Err(PlatformError::NotFound(format!("{flow:?} endpoint")));
                }
                Err(error) => return Err(os_error("GetDefaultAudioEndpoint", &error)),
            };
            let volume: IAudioEndpointVolume = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|error| os_error("IMMDevice::Activate(IAudioEndpointVolume)", &error))?;
            let callback: IAudioEndpointVolumeCallback = VolumeCallback {
                inbox: self.shared.inbox.clone(),
                flow,
            }
            .into();
            volume
                .RegisterControlChangeNotify(&callback)
                .map_err(|error| os_error("RegisterControlChangeNotify", &error))?;
            Ok(Some(Bound { volume, callback }))
        }
    }

    fn notify(&self, flow: Flow, percent: u8, muted: bool) {
        let changed = {
            let mut snapshot = self.shared.snapshot.lock();
            match flow {
                Flow::Render => {
                    let changed = snapshot.volume != Some((percent, muted));
                    snapshot.volume = Some((percent, muted));
                    changed
                }
                Flow::Capture => {
                    let changed = snapshot.mic_muted != Some(muted);
                    snapshot.mic_muted = Some(muted);
                    changed
                }
            }
        };
        if !changed {
            return;
        }
        let event = match flow {
            Flow::Render => PlatformEvent::VolumeChanged { percent, muted },
            Flow::Capture => PlatformEvent::MicMuteChanged { muted },
        };
        // No subscribers is fine: the app may not have mounted a listener yet.
        let _ = self.shared.events.send(event);
    }

    fn set_volume(&self, percent: u8) {
        let Some(bound) = &self.render else {
            return;
        };
        // SAFETY: live endpoint interface; the context GUID outlives the call.
        #[allow(unsafe_code)]
        if let Err(error) = unsafe {
            bound
                .volume
                .SetMasterVolumeLevelScalar(scalar_from_percent(percent), &MUNA_EVENT_CONTEXT)
        } {
            warn!(%error, percent, "audio: SetMasterVolumeLevelScalar failed");
        }
    }

    fn set_muted(&self, flow: Flow, muted: bool) {
        let bound = match flow {
            Flow::Render => &self.render,
            Flow::Capture => &self.capture,
        };
        let Some(bound) = bound else {
            return;
        };
        // SAFETY: live endpoint interface; the context GUID outlives the call.
        #[allow(unsafe_code)]
        if let Err(error) = unsafe { bound.volume.SetMute(muted, &MUNA_EVENT_CONTEXT) } {
            warn!(%error, muted, ?flow, "audio: SetMute failed");
        }
    }

    /// Active render endpoints with the default one flagged; empty when enumeration fails.
    fn devices(&self) -> Vec<AudioDevice> {
        // SAFETY: documented enumeration on live interfaces; every result is checked and the
        // strings returned by `GetId` are freed with `CoTaskMemFree` as the API requires.
        #[allow(unsafe_code)]
        unsafe {
            let default_id = self
                .enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .ok()
                .and_then(|device| device_id(&device));
            let collection = match self
                .enumerator
                .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            {
                Ok(collection) => collection,
                Err(error) => {
                    warn!(%error, "audio: EnumAudioEndpoints failed");
                    return Vec::new();
                }
            };
            let count = collection.GetCount().unwrap_or(0);
            let mut devices = Vec::with_capacity(count as usize);
            for index in 0..count {
                let Ok(device) = collection.Item(index) else {
                    continue;
                };
                let Some(id) = device_id(&device) else {
                    continue;
                };
                let name = friendly_name(&device).unwrap_or_else(|| id.clone());
                devices.push(AudioDevice {
                    is_default: default_id.as_deref() == Some(id.as_str()),
                    id,
                    name,
                });
            }
            devices
        }
    }
}

/// Current level of an endpoint, or `None` when the device stopped answering.
fn read_level(volume: &IAudioEndpointVolume) -> Option<(u8, bool)> {
    // SAFETY: live endpoint interface; both getters are plain reads.
    #[allow(unsafe_code)]
    unsafe {
        let level = volume.GetMasterVolumeLevelScalar().ok()?;
        let muted = volume.GetMute().ok()?.as_bool();
        Some((percent_from_scalar(level), muted))
    }
}

/// # Safety
/// `device` must be a live `IMMDevice`.
#[allow(unsafe_code)]
unsafe fn device_id(device: &IMMDevice) -> Option<String> {
    // SAFETY: `GetId` returns a CoTaskMem string the caller owns; it is read once and freed.
    unsafe {
        let raw = device.GetId().ok()?;
        let id = raw.to_string().ok();
        CoTaskMemFree(Some(raw.0.cast_const().cast()));
        id
    }
}

/// # Safety
/// `device` must be a live `IMMDevice`.
#[allow(unsafe_code)]
unsafe fn friendly_name(device: &IMMDevice) -> Option<String> {
    // SAFETY: the property store is opened read-only on a live device; the PROPVARIANT is
    // inspected only when its type is `VT_LPWSTR` and cleared with `PropVariantClear` after.
    unsafe {
        let store = device.OpenPropertyStore(STGM_READ).ok()?;
        let mut value = store.GetValue(&PKEY_Device_FriendlyName).ok()?;
        let inner = &value.Anonymous.Anonymous;
        let name = if inner.vt == VT_LPWSTR {
            PCWSTR(inner.Anonymous.pwszVal.0).to_string().ok()
        } else {
            None
        };
        let _ = PropVariantClear(&raw mut value);
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scalar_and_percent_round_trip_with_clamping() {
        assert_eq!(percent_from_scalar(0.0), 0);
        assert_eq!(percent_from_scalar(0.505), 51);
        assert_eq!(percent_from_scalar(1.0), 100);
        assert_eq!(percent_from_scalar(1.5), 100);
        assert_eq!(percent_from_scalar(-0.2), 0);
        assert!((scalar_from_percent(30) - 0.3).abs() < f32::EPSILON);
        assert!((scalar_from_percent(200) - 1.0).abs() < f32::EPSILON);
        for percent in 0..=100_u8 {
            assert_eq!(percent_from_scalar(scalar_from_percent(percent)), percent);
        }
    }

    /// Talks to the real OS; only meaningful on the nightly lab machine.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session"
    )]
    fn watcher_reads_the_default_render_level() {
        let (events, _rx) = broadcast::channel(8);
        let watcher = Watcher::start(events).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(500));
        match watcher.volume() {
            Ok(percent) => assert!(percent <= 100),
            Err(PlatformError::NotFound(_)) => {}
            Err(other) => panic!("unexpected error: {other}"),
        }
    }

    /// Changes the real volume by ten points and puts it back; verifies the level comes back
    /// through `OnNotify` as a `VolumeChanged` event within two seconds.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session with a render device"
    )]
    fn setting_the_volume_round_trips_through_the_callback() {
        use std::time::{Duration, Instant};

        let (events, mut rx) = broadcast::channel(32);
        let watcher = Watcher::start(events).unwrap();
        std::thread::sleep(Duration::from_millis(500));
        let Ok(before) = watcher.volume() else {
            return; // no render device on this machine
        };
        let target = if before >= 50 {
            before - 10
        } else {
            before + 10
        };

        let started = Instant::now();
        watcher.set_volume(target).unwrap();
        let deadline = started + Duration::from_secs(2);
        let mut seen_at = None;
        while Instant::now() < deadline && seen_at.is_none() {
            match rx.try_recv() {
                Ok(PlatformEvent::VolumeChanged { percent, .. }) if percent == target => {
                    seen_at = Some(started.elapsed());
                }
                Ok(_) => {}
                Err(_) => std::thread::sleep(Duration::from_millis(10)),
            }
        }
        let snapshot = watcher.volume();
        watcher.set_volume(before).unwrap();
        std::thread::sleep(Duration::from_millis(200));

        let latency = seen_at.expect("VolumeChanged for the new level within 2 s");
        eprintln!("volume {before} -> {target} observed after {latency:?}");
        assert_eq!(snapshot.unwrap(), target);
        assert_eq!(watcher.volume().unwrap(), before);
    }
}
