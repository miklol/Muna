//! A scripted, deterministic platform used by every unit and integration test (docs/09).
//!
//! Tests drive it through the `push_*` / `set_*` methods; each call updates the snapshot the
//! traits return **and** publishes the matching [`PlatformEvent`], exactly as the real
//! implementation would. Commands sent to the fake are recorded so tests can assert on them.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use parking_lot::Mutex;
use tokio::sync::broadcast;

use crate::error::{PlatformError, PlatformResult};
use crate::events::PlatformEvent;
use crate::traits::{
    AppBar, AppInfo, Audio, Autostart, Bluetooth, Brightness, DragSource, FileOps, Foreground,
    Location, Media, Monitors, Notifications, Platform, Power, Processes, Secrets, SystemInfo,
    SystemOsd, SystemStats, WindowPlacement, Windowing,
};
use crate::types::{
    AppDescription, AudioDevice, AutostartMechanism, BatteryState, BluetoothDevice,
    BluetoothRadioState, BrightnessMonitor, DragOutcome, DragPayload, DropEffect, ForegroundWindow,
    GeoPosition, MediaCommand, MediaSession, MonitorInfo, Notification, NotificationAccess,
    NotificationDelivery, OsdState, PowerSource, Rect, SystemDescription, SystemSample, Thumbnail,
    TransferMode, UserNotificationState, WindowHandle,
};

const EVENT_CAPACITY: usize = 256;

/// One recorded [`DragSource::start_drag`] request: the window and the payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DragCall {
    pub window: WindowHandle,
    pub payload: DragPayload,
}

/// One recorded [`FileOps`] request, in order, for assertions in the drop-actions tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileOpsCall {
    Transfer {
        items: Vec<PathBuf>,
        destination: PathBuf,
        mode: TransferMode,
    },
    Recycle(Vec<PathBuf>),
    Open(PathBuf),
    OpenWith(PathBuf),
    Reveal(Vec<PathBuf>),
    Share(WindowHandle, Vec<PathBuf>),
    Eject(PathBuf),
    /// `pick_folder(window, title)`.
    PickFolder(WindowHandle, String),
    /// `thumbnail(item, size)`.
    Thumbnail(PathBuf, u32),
}

/// One recorded [`Bluetooth`] request, in order, for assertions in module tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BluetoothCall {
    Connect(String),
    Disconnect(String),
    SetRadio(bool),
}

/// One recorded [`Notifications`] request, in order, for assertions in module tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotificationCall {
    RequestAccess,
    List,
    Remove(u32),
    Clear,
    Watch,
    /// `app_logo(app_id)`.
    Logo(String),
    OpenApp(String),
}

/// One recorded [`Windowing`] / [`AppBar`] call, in order, for assertions in shell tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowingCall {
    MoveAsync(WindowHandle, Rect),
    AssertTopmost(WindowHandle),
    SetToolWindow(WindowHandle),
    SetClickThrough(WindowHandle, bool),
    SetCaptureExclusion(WindowHandle, bool),
    SetNoActivate(WindowHandle, bool),
    /// `reserve_top(window, monitor, height)`.
    ReserveAppBar(WindowHandle, Rect, u32),
    ReleaseAppBar(WindowHandle),
}

/// One recorded [`WindowPlacement`] request, in order, for assertions in the window-snap tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlacementCall {
    /// `place(window, target)`: the visible frame was asked to fill `target`.
    Place(WindowHandle, Rect),
    /// `maximize(window, work_area)`.
    Maximize(WindowHandle, Rect),
}

/// A scripted foreign window for [`WindowPlacement`]: its visible frame and whether it passes
/// the eligibility filter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ForeignWindow {
    frame: Rect,
    snappable: bool,
    /// Placement requests are recorded but leave the frame where it is (a window Aero Snap
    /// keeps re-maximising, or one that resizes itself after a DPI change).
    stuck: bool,
}

/// Scripted mouse state: where the cursor is and whether a button is held.
#[derive(Debug, Default, Clone, Copy)]
struct Pointer {
    position: (i32, i32),
    button_down: bool,
}

/// A scripted state bag: the flags are independent test knobs, not a state machine.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug)]
struct State {
    sessions: Vec<MediaSession>,
    /// Scripted artwork per `source_app_id`.
    thumbnails: Vec<(String, Thumbnail)>,
    media_refreshes: usize,
    audio_devices: Vec<AudioDevice>,
    volume: u8,
    muted: bool,
    /// `None` scripts a machine without a microphone.
    mic_muted: Option<bool>,
    brightness: Vec<BrightnessMonitor>,
    /// Every `set(id, percent)` the fake received, in order.
    brightness_sets: Vec<(String, u8)>,
    osd: OsdState,
    /// Scripted: the build has no flyout window, so suppression reports `Unavailable`.
    osd_unavailable: bool,
    /// Every `set_suppressed` request, in order.
    osd_requests: Vec<bool>,
    bluetooth: Vec<BluetoothDevice>,
    bluetooth_radio: BluetoothRadioState,
    /// Scripted: `connect`/`disconnect` fail with `Unsupported`, as Windows does for a device
    /// it offers no way to reach from an app.
    bluetooth_unsupported: bool,
    /// Scripted: `set_radio` fails with `AccessDenied` (a policy, or the user said no).
    bluetooth_radio_denied: bool,
    /// Every Bluetooth request the fake received, in order.
    bluetooth_calls: Vec<BluetoothCall>,
    battery: BatteryState,
    /// Scripted answer to `SystemInfo::describe`.
    system: SystemDescription,
    /// Scripted Desktop folder; `None` answers `NotFound`.
    desktop_dir: Option<PathBuf>,
    /// Scripted answer to `SystemInfo::region_format`.
    region_format: String,
    monitors: Vec<MonitorInfo>,
    foreground: Option<ForegroundWindow>,
    /// Scripted answer to `Foreground::idle_for`.
    idle_for: Duration,
    /// Scripted `AppInfo::describe` answers by executable path; an unknown path answers
    /// `NotFound`, like a file that is gone.
    app_descriptions: BTreeMap<PathBuf, AppDescription>,
    /// Every `describe(executable, icon_size)` the fake answered, in order.
    app_info_calls: Vec<(PathBuf, u32)>,
    /// Process ids `Processes::is_running` answers `true` for.
    running_pids: BTreeSet<u32>,
    /// Scripted `Processes::main_window` answers by pid.
    process_windows: BTreeMap<u32, WindowHandle>,
    /// Scripted `Processes::owner_of_local_port` answers by port.
    port_owners: BTreeMap<u16, u32>,
    /// Every `Processes::focus(window)` so far, in order.
    focus_calls: Vec<WindowHandle>,
    /// When set, `Processes::focus` fails the way `SetForegroundWindow` refuses a background
    /// process.
    focus_refused: bool,
    sent_media_commands: Vec<(String, MediaCommand)>,
    pointer: Pointer,
    quiet: UserNotificationState,
    window_rects: Vec<(WindowHandle, Rect)>,
    windowing_calls: Vec<WindowingCall>,
    /// Windows with a live `AppBar` reservation and the rect granted.
    app_bars: Vec<(WindowHandle, Rect)>,
    autostart_enabled: bool,
    /// Scripted: `set_enabled(true)` fails with `AccessDenied` (user disabled it in Settings).
    autostart_denied: bool,
    /// Scripted readings, oldest first; the last one repeats once the script runs out.
    system_samples: Vec<SystemSample>,
    /// Every `sample(top_processes)` the fake answered, in order.
    system_sample_requests: Vec<usize>,
    /// Scripted answer to `position()`: a fix, or how Windows refuses. `None` scripts a
    /// machine without a location source (`Unsupported`).
    location: Option<GeoPosition>,
    /// Scripted: `position()` fails with `AccessDenied` (location off for desktop apps).
    location_denied: bool,
    /// How many times `position()` was asked, to assert "no repeated prompts".
    location_requests: usize,
    /// The scripted Credential Manager: key → value.
    secrets: BTreeMap<String, String>,
    /// Scripted: every secrets call fails with `Os` (a locked-down or corrupt vault).
    secrets_unavailable: bool,
    /// The scripted Action Center, oldest first.
    notifications: Vec<Notification>,
    notification_access: NotificationAccess,
    /// What `watch` answers: `Push` scripts a build with package identity.
    notification_delivery: NotificationDelivery,
    /// Scripted: every listener call fails with `Unsupported` (no listener on this build).
    notifications_unavailable: bool,
    /// Every listener request the fake received, in order.
    notification_calls: Vec<NotificationCall>,
    /// Scripted sender logos by app id.
    app_logos: BTreeMap<String, Thumbnail>,
    /// Scripted focus session state; `None` scripts a Windows without the API.
    focus_active: Option<bool>,
    /// Every file operation the fake received, in order.
    file_ops_calls: Vec<FileOpsCall>,
    /// Scripted: every file operation fails with this error (a refused eject, a shell that
    /// cannot start, a cancelled copy).
    file_ops_error: Option<PlatformError>,
    /// Scripted answer to `pick_folder`; `None` scripts the user cancelling.
    picked_folder: Option<PathBuf>,
    /// Every drag out the fake was asked to start, in order.
    drag_calls: Vec<DragCall>,
    /// Scripted answer to `start_drag`.
    drag_outcome: Result<DragOutcome, PlatformError>,
    /// Every payload placed on the clipboard, in order.
    clipboard_payloads: Vec<DragPayload>,
    /// Scripted file thumbnails by path; a path without one answers `NotFound`.
    file_thumbnails: BTreeMap<PathBuf, Vec<u8>>,
    /// Other applications' windows the snap tests drag, by handle.
    foreign_windows: BTreeMap<WindowHandle, ForeignWindow>,
    /// Every placement request the fake received, in order.
    placement_calls: Vec<PlacementCall>,
    /// Scripted: every placement fails with this error (an elevated window refusing us).
    placement_error: Option<PlatformError>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            sessions: Vec::new(),
            thumbnails: Vec::new(),
            media_refreshes: 0,
            audio_devices: vec![AudioDevice {
                id: "fake-speakers".into(),
                name: "Speakers (fake)".into(),
                is_default: true,
            }],
            volume: 50,
            muted: false,
            mic_muted: Some(false),
            brightness: Vec::new(),
            brightness_sets: Vec::new(),
            osd: OsdState::Native,
            osd_unavailable: false,
            osd_requests: Vec::new(),
            bluetooth: Vec::new(),
            bluetooth_radio: BluetoothRadioState::On,
            bluetooth_unsupported: false,
            bluetooth_radio_denied: false,
            bluetooth_calls: Vec::new(),
            battery: BatteryState {
                percent: None,
                source: PowerSource::Ac,
                charging: false,
            },
            system: SystemDescription {
                os: "Fake OS 1.0".into(),
                webview2: Some("0.0.0.0".into()),
            },
            desktop_dir: None,
            region_format: "en-US".into(),
            monitors: vec![MonitorInfo {
                id: r"\\.\DISPLAY1".into(),
                bounds: Rect::new(0, 0, 2560, 1440),
                work_area: Rect::new(0, 0, 2560, 1392),
                dpi: 96,
                is_primary: true,
            }],
            foreground: None,
            idle_for: Duration::ZERO,
            app_descriptions: BTreeMap::new(),
            app_info_calls: Vec::new(),
            running_pids: BTreeSet::new(),
            process_windows: BTreeMap::new(),
            port_owners: BTreeMap::new(),
            focus_calls: Vec::new(),
            focus_refused: false,
            sent_media_commands: Vec::new(),
            pointer: Pointer::default(),
            quiet: UserNotificationState::AcceptsNotifications,
            window_rects: Vec::new(),
            windowing_calls: Vec::new(),
            app_bars: Vec::new(),
            autostart_enabled: false,
            autostart_denied: false,
            system_samples: Vec::new(),
            system_sample_requests: Vec::new(),
            location: None,
            location_denied: false,
            location_requests: 0,
            secrets: BTreeMap::new(),
            secrets_unavailable: false,
            notifications: Vec::new(),
            notification_access: NotificationAccess::Allowed,
            notification_delivery: NotificationDelivery::Push,
            notifications_unavailable: false,
            notification_calls: Vec::new(),
            app_logos: BTreeMap::new(),
            focus_active: None,
            file_ops_calls: Vec::new(),
            file_ops_error: None,
            picked_folder: None,
            drag_calls: Vec::new(),
            drag_outcome: Ok(DragOutcome::Dropped {
                effect: DropEffect::Copy,
            }),
            clipboard_payloads: Vec::new(),
            file_thumbnails: BTreeMap::new(),
            foreign_windows: BTreeMap::new(),
            placement_calls: Vec::new(),
            placement_error: None,
        }
    }
}

/// Scripted platform. Cheap to clone-by-`Arc`; all methods take `&self`.
#[derive(Debug)]
pub struct FakePlatform {
    state: Mutex<State>,
    events: broadcast::Sender<PlatformEvent>,
}

impl Default for FakePlatform {
    fn default() -> Self {
        Self::new()
    }
}

impl FakePlatform {
    #[must_use]
    pub fn new() -> Self {
        let (events, _) = broadcast::channel(EVENT_CAPACITY);
        Self {
            state: Mutex::new(State::default()),
            events,
        }
    }

    fn publish(&self, event: PlatformEvent) {
        // No subscribers is fine: the app may not have mounted a listener yet.
        let _ = self.events.send(event);
    }

    // --- scripting API -----------------------------------------------------------------

    /// Replaces the media session list and notifies subscribers.
    pub fn set_media_sessions(&self, sessions: Vec<MediaSession>) {
        self.state.lock().sessions.clone_from(&sessions);
        self.publish(PlatformEvent::MediaSessionsChanged(sessions));
    }

    /// Adds (or replaces, by `source_app_id`) one media session and notifies subscribers.
    pub fn push_media_session(&self, session: MediaSession) {
        let sessions = {
            let mut state = self.state.lock();
            state
                .sessions
                .retain(|s| s.source_app_id != session.source_app_id);
            state.sessions.push(session);
            state.sessions.clone()
        };
        self.publish(PlatformEvent::MediaSessionsChanged(sessions));
    }

    /// Removes a session (the app closed) and notifies subscribers.
    pub fn remove_media_session(&self, source_app_id: &str) {
        let sessions = {
            let mut state = self.state.lock();
            state.sessions.retain(|s| s.source_app_id != source_app_id);
            state.thumbnails.retain(|(app, _)| app != source_app_id);
            state.sessions.clone()
        };
        self.publish(PlatformEvent::MediaSessionsChanged(sessions));
    }

    /// Scripts the artwork of a known session: stores the bytes, bumps the session's
    /// `art_version` and republishes, exactly as the real implementation does when a late
    /// thumbnail lands. Ignored for unknown sessions.
    pub fn set_media_thumbnail(&self, source_app_id: &str, bytes: Vec<u8>, content_type: &str) {
        let sessions = {
            let mut state = self.state.lock();
            let Some(session) = state
                .sessions
                .iter_mut()
                .find(|s| s.source_app_id == source_app_id)
            else {
                return;
            };
            session.art_version += 1;
            state.thumbnails.retain(|(app, _)| app != source_app_id);
            state.thumbnails.push((
                source_app_id.to_owned(),
                Thumbnail {
                    bytes,
                    content_type: content_type.to_owned(),
                },
            ));
            state.sessions.clone()
        };
        self.publish(PlatformEvent::MediaSessionsChanged(sessions));
    }

    /// How many times [`Media::refresh`] was called.
    #[must_use]
    pub fn media_refreshes(&self) -> usize {
        self.state.lock().media_refreshes
    }

    pub fn set_volume_state(&self, percent: u8, muted: bool) {
        let percent = percent.min(100);
        {
            let mut state = self.state.lock();
            state.volume = percent;
            state.muted = muted;
        }
        self.publish(PlatformEvent::VolumeChanged { percent, muted });
    }

    /// Scripts the default microphone's mute state; `None` removes the microphone.
    pub fn set_mic_muted_state(&self, muted: Option<bool>) {
        self.state.lock().mic_muted = muted;
        if let Some(muted) = muted {
            self.publish(PlatformEvent::MicMuteChanged { muted });
        }
    }

    /// Adds (or replaces, by id) a brightness-capable monitor without publishing anything —
    /// the probe found it at start-up.
    pub fn add_brightness_monitor(&self, monitor: BrightnessMonitor) {
        let mut state = self.state.lock();
        state.brightness.retain(|m| m.id != monitor.id);
        state.brightness.push(monitor);
    }

    /// Scripts a brightness change from outside Muna (a laptop's brightness keys) and
    /// notifies subscribers. Ignored for unknown monitors.
    pub fn set_brightness_state(&self, id: &str, percent: u8) {
        let percent = percent.min(100);
        {
            let mut state = self.state.lock();
            let Some(monitor) = state.brightness.iter_mut().find(|m| m.id == id) else {
                return;
            };
            monitor.percent = percent;
        }
        self.publish(PlatformEvent::BrightnessChanged {
            monitor_id: id.to_owned(),
            percent,
        });
    }

    /// Every [`Brightness::set`] the fake received, in order.
    #[must_use]
    pub fn brightness_sets(&self) -> Vec<(String, u8)> {
        self.state.lock().brightness_sets.clone()
    }

    /// Scripts a build without a flyout window: suppression reports `Unavailable`.
    pub fn set_osd_unavailable(&self, unavailable: bool) {
        let mut state = self.state.lock();
        state.osd_unavailable = unavailable;
        if unavailable {
            state.osd = OsdState::Unavailable;
        }
    }

    /// Every [`SystemOsd::set_suppressed`] request, in order.
    #[must_use]
    pub fn osd_requests(&self) -> Vec<bool> {
        self.state.lock().osd_requests.clone()
    }

    pub fn set_bluetooth_device(&self, device: BluetoothDevice) {
        {
            let mut state = self.state.lock();
            state.bluetooth.retain(|d| d.id != device.id);
            state.bluetooth.push(device.clone());
        }
        self.publish(PlatformEvent::BluetoothChanged(device));
    }

    /// Unpairs a device: it leaves the list, and a connected one reads as a disconnect first,
    /// as the Windows watcher reports it.
    pub fn remove_bluetooth_device(&self, id: &str) {
        let removed = {
            let mut state = self.state.lock();
            let index = state.bluetooth.iter().position(|d| d.id == id);
            index.map(|index| state.bluetooth.remove(index))
        };
        if let Some(device) = removed.filter(|device| device.connected) {
            self.publish(PlatformEvent::BluetoothChanged(BluetoothDevice {
                connected: false,
                battery_percent: None,
                ..device
            }));
        }
    }

    /// Scripts the radio's state and publishes the change, as the OS toggle would.
    pub fn set_bluetooth_radio(&self, radio: BluetoothRadioState) {
        self.state.lock().bluetooth_radio = radio;
        self.publish(PlatformEvent::BluetoothRadioChanged(radio));
    }

    /// Scripts `connect`/`disconnect` to fail with `Unsupported`.
    pub fn set_bluetooth_unsupported(&self, unsupported: bool) {
        self.state.lock().bluetooth_unsupported = unsupported;
    }

    /// Scripts `set_radio` to fail with `AccessDenied`.
    pub fn set_bluetooth_radio_denied(&self, denied: bool) {
        self.state.lock().bluetooth_radio_denied = denied;
    }

    /// Every [`Bluetooth`] request so far, in order.
    #[must_use]
    pub fn bluetooth_calls(&self) -> Vec<BluetoothCall> {
        self.state.lock().bluetooth_calls.clone()
    }

    /// Scripts every [`FileOps`] call to fail with `error` (`None` restores success).
    pub fn set_file_ops_error(&self, error: Option<PlatformError>) {
        self.state.lock().file_ops_error = error;
    }

    /// Scripts what the folder picker answers; `None` (the default) is a cancel.
    pub fn set_picked_folder(&self, folder: Option<PathBuf>) {
        self.state.lock().picked_folder = folder;
    }

    /// Every [`FileOps`] request so far, in order.
    #[must_use]
    pub fn file_ops_calls(&self) -> Vec<FileOpsCall> {
        self.state.lock().file_ops_calls.clone()
    }

    /// Records a file operation, or fails it as scripted.
    fn file_op(&self, call: FileOpsCall) -> PlatformResult<()> {
        let mut state = self.state.lock();
        state.file_ops_calls.push(call);
        match &state.file_ops_error {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }

    /// Scripts how the next drags out end (the default is a drop with the copy effect).
    pub fn set_drag_outcome(&self, outcome: Result<DragOutcome, PlatformError>) {
        self.state.lock().drag_outcome = outcome;
    }

    /// Every [`DragSource::start_drag`] request so far, in order.
    #[must_use]
    pub fn drag_calls(&self) -> Vec<DragCall> {
        self.state.lock().drag_calls.clone()
    }

    /// Every payload [`DragSource::place_on_clipboard`] received so far, in order.
    #[must_use]
    pub fn clipboard_payloads(&self) -> Vec<DragPayload> {
        self.state.lock().clipboard_payloads.clone()
    }

    /// Scripts the PNG bytes [`FileOps::thumbnail`] answers for `path`.
    pub fn set_thumbnail(&self, path: PathBuf, png: Vec<u8>) {
        self.state.lock().file_thumbnails.insert(path, png);
    }

    pub fn set_battery(&self, battery: BatteryState) {
        self.state.lock().battery = battery;
        self.publish(PlatformEvent::BatteryChanged(battery));
    }

    /// Scripts what [`SystemInfo::describe`] answers.
    pub fn set_system_description(&self, system: SystemDescription) {
        self.state.lock().system = system;
    }

    /// Scripts the Desktop folder [`SystemInfo::desktop_dir`] answers; `None` answers
    /// `NotFound`.
    pub fn set_desktop_dir(&self, dir: Option<PathBuf>) {
        self.state.lock().desktop_dir = dir;
    }

    /// Scripts the regional format [`SystemInfo::region_format`] answers (`en-US` by default).
    pub fn set_region_format(&self, tag: impl Into<String>) {
        self.state.lock().region_format = tag.into();
    }

    pub fn set_monitors(&self, monitors: Vec<MonitorInfo>) {
        self.state.lock().monitors.clone_from(&monitors);
        self.publish(PlatformEvent::MonitorsChanged(monitors));
    }

    pub fn foreground_changed(&self, window: ForegroundWindow) {
        self.state.lock().foreground = Some(window.clone());
        self.publish(PlatformEvent::ForegroundChanged(window));
    }

    /// Scripts how long [`Foreground::idle_for`] says the user has been away.
    pub fn set_idle_for(&self, idle: Duration) {
        self.state.lock().idle_for = idle;
    }

    /// Scripts what [`AppInfo::describe`] answers for `executable`.
    pub fn set_app_description(&self, executable: PathBuf, description: AppDescription) {
        self.state
            .lock()
            .app_descriptions
            .insert(executable, description);
    }

    /// Every `describe(executable, icon_size)` answered so far, in order.
    pub fn app_info_calls(&self) -> Vec<(PathBuf, u32)> {
        self.state.lock().app_info_calls.clone()
    }

    /// Scripts whether [`Processes::is_running`] finds `pid` alive.
    pub fn set_process_running(&self, pid: u32, running: bool) {
        let mut state = self.state.lock();
        if running {
            state.running_pids.insert(pid);
        } else {
            state.running_pids.remove(&pid);
        }
    }

    /// Scripts the window [`Processes::main_window`] answers for `pid` (`None` clears it).
    pub fn set_process_window(&self, pid: u32, window: Option<WindowHandle>) {
        let mut state = self.state.lock();
        match window {
            Some(window) => {
                state.process_windows.insert(pid, window);
            }
            None => {
                state.process_windows.remove(&pid);
            }
        }
    }

    /// Makes [`Processes::focus`] fail, as Windows does for a process without the foreground.
    pub fn set_focus_refused(&self, refused: bool) {
        self.state.lock().focus_refused = refused;
    }

    /// Scripts which pid [`Processes::owner_of_local_port`] answers for `port` (`None`
    /// clears it).
    pub fn set_port_owner(&self, port: u16, pid: Option<u32>) {
        let mut state = self.state.lock();
        match pid {
            Some(pid) => {
                state.port_owners.insert(port, pid);
            }
            None => {
                state.port_owners.remove(&port);
            }
        }
    }

    /// Every window [`Processes::focus`] was asked to bring forward, in order.
    #[must_use]
    pub fn focus_calls(&self) -> Vec<WindowHandle> {
        self.state.lock().focus_calls.clone()
    }

    pub fn set_session_locked(&self, locked: bool) {
        self.publish(PlatformEvent::SessionLockChanged { locked });
    }

    /// `window` started (`true`) or finished (`false`) being dragged or resized.
    pub fn move_size_changed(&self, started: bool, window: WindowHandle) {
        self.publish(PlatformEvent::MoveSizeChanged { started, window });
    }

    /// Scripts another application's window for [`WindowPlacement`]: `frame` is its visible
    /// frame in physical screen pixels, `snappable` whether the eligibility filter passes it.
    pub fn set_foreign_window(&self, window: WindowHandle, frame: Rect, snappable: bool) {
        self.state.lock().foreign_windows.insert(
            window,
            ForeignWindow {
                frame,
                snappable,
                stuck: false,
            },
        );
    }

    /// Scripts a foreign window to ignore placement requests while `stuck` (they are still
    /// recorded); `false` for an unknown window.
    pub fn set_foreign_window_stuck(&self, window: WindowHandle, stuck: bool) -> bool {
        match self.state.lock().foreign_windows.get_mut(&window) {
            Some(foreign) => {
                foreign.stuck = stuck;
                true
            }
            None => false,
        }
    }

    /// Scripts every placement request to fail with `error` (`None` restores success).
    pub fn set_placement_error(&self, error: Option<PlatformError>) {
        self.state.lock().placement_error = error;
    }

    /// [`WindowPlacement`] requests received so far, in order.
    #[must_use]
    pub fn placement_calls(&self) -> Vec<PlacementCall> {
        self.state.lock().placement_calls.clone()
    }

    /// Windows with a live `AppBar` reservation and the rect each was granted.
    #[must_use]
    pub fn app_bars(&self) -> Vec<(WindowHandle, Rect)> {
        self.state.lock().app_bars.clone()
    }

    /// Scripts whether enabling autostart is refused (the user turned the startup task off in
    /// Windows settings, `StartupTaskState::DisabledByUser`).
    pub fn set_autostart_denied(&self, denied: bool) {
        self.state.lock().autostart_denied = denied;
    }

    /// Media commands received so far, in order.
    #[must_use]
    pub fn sent_media_commands(&self) -> Vec<(String, MediaCommand)> {
        self.state.lock().sent_media_commands.clone()
    }

    /// Scripts the cursor position returned by [`Windowing::cursor_position`].
    pub fn set_cursor(&self, x: i32, y: i32) {
        self.state.lock().pointer.position = (x, y);
    }

    /// Scripts [`Windowing::pointer_button_down`] (a mouse button held anywhere on screen).
    pub fn set_pointer_button_down(&self, down: bool) {
        self.state.lock().pointer.button_down = down;
    }

    /// Scripts [`Windowing::user_notification_state`].
    pub fn set_user_notification_state(&self, state: UserNotificationState) {
        self.state.lock().quiet = state;
    }

    /// [`Windowing`] calls received so far, in order.
    #[must_use]
    pub fn windowing_calls(&self) -> Vec<WindowingCall> {
        self.state.lock().windowing_calls.clone()
    }

    /// Scripts the readings [`SystemStats::sample`] hands out, oldest first. The last reading
    /// repeats once the script runs out; with no script the sampler reports `Unsupported`.
    pub fn script_system_samples(&self, samples: Vec<SystemSample>) {
        let mut state = self.state.lock();
        state.system_samples = samples;
        state.system_samples.reverse();
    }

    /// The `top_processes` argument of every sample taken so far, in order — how often the
    /// module sampled and whether it walked the processes.
    #[must_use]
    pub fn system_sample_requests(&self) -> Vec<usize> {
        self.state.lock().system_sample_requests.clone()
    }

    /// Scripts the fix [`Location::position`] returns; `None` scripts a machine without a
    /// location source (`Unsupported`).
    pub fn set_location(&self, position: Option<GeoPosition>) {
        self.state.lock().location = position;
    }

    /// Scripts Windows refusing location to desktop apps (`AccessDenied`).
    pub fn set_location_denied(&self, denied: bool) {
        self.state.lock().location_denied = denied;
    }

    /// How many times `position()` was asked so far.
    #[must_use]
    pub fn location_requests(&self) -> usize {
        self.state.lock().location_requests
    }

    /// The scripted vault's value under `key`, for assertions.
    #[must_use]
    pub fn secret(&self, key: &str) -> Option<String> {
        self.state.lock().secrets.get(key).cloned()
    }

    /// Every key in the scripted vault, sorted, for assertions that nothing leaked or lingered.
    #[must_use]
    pub fn secret_keys(&self) -> Vec<String> {
        self.state.lock().secrets.keys().cloned().collect()
    }

    /// Scripts a vault that refuses every call with `Os`.
    pub fn set_secrets_unavailable(&self, unavailable: bool) {
        self.state.lock().secrets_unavailable = unavailable;
    }

    /// A toast arrives in (or is updated in) the scripted Action Center. With `Push` delivery
    /// the change event follows, as `NotificationChanged` would.
    pub fn push_notification(&self, notification: Notification) {
        let push = {
            let mut state = self.state.lock();
            state
                .notifications
                .retain(|known| known.id != notification.id);
            state.notifications.push(notification);
            state.notification_delivery == NotificationDelivery::Push
        };
        if push {
            self.publish(PlatformEvent::NotificationsChanged);
        }
    }

    /// A toast leaves the scripted Action Center on its own (the sender withdrew it, the user
    /// dismissed it in Windows); not recorded as a request.
    pub fn expire_notification(&self, id: u32) {
        let push = {
            let mut state = self.state.lock();
            state.notifications.retain(|known| known.id != id);
            state.notification_delivery == NotificationDelivery::Push
        };
        if push {
            self.publish(PlatformEvent::NotificationsChanged);
        }
    }

    /// Scripts what `access` and `request_access` answer.
    pub fn set_notification_access(&self, access: NotificationAccess) {
        self.state.lock().notification_access = access;
    }

    /// Scripts what `watch` answers: `Polling` is a build without package identity.
    pub fn set_notification_delivery(&self, delivery: NotificationDelivery) {
        self.state.lock().notification_delivery = delivery;
    }

    /// Scripts a build with no listener at all: every call fails with `Unsupported`.
    pub fn set_notifications_unavailable(&self, unavailable: bool) {
        self.state.lock().notifications_unavailable = unavailable;
    }

    /// Scripts the logo `app_logo(app_id)` answers.
    pub fn set_app_logo(&self, app_id: &str, bytes: Vec<u8>, content_type: &str) {
        self.state.lock().app_logos.insert(
            app_id.to_owned(),
            Thumbnail {
                bytes,
                content_type: content_type.to_owned(),
            },
        );
    }

    /// Scripts the focus session state and publishes the change when Windows has the API.
    pub fn set_focus_active(&self, active: Option<bool>) {
        self.state.lock().focus_active = active;
        if let Some(active) = active {
            self.publish(PlatformEvent::FocusChanged { active });
        }
    }

    /// Every [`Notifications`] request so far, in order.
    #[must_use]
    pub fn notification_calls(&self) -> Vec<NotificationCall> {
        self.state.lock().notification_calls.clone()
    }

    /// The scripted Action Center as it stands, for assertions after `remove` / `clear`.
    #[must_use]
    pub fn notifications(&self) -> Vec<Notification> {
        self.state.lock().notifications.clone()
    }
}

impl Notifications for FakePlatform {
    fn access(&self) -> PlatformResult<NotificationAccess> {
        let state = self.state.lock();
        if state.notifications_unavailable {
            return Err(PlatformError::Unsupported("notification listener"));
        }
        Ok(state.notification_access)
    }

    fn request_access(&self) -> PlatformResult<NotificationAccess> {
        let mut state = self.state.lock();
        state
            .notification_calls
            .push(NotificationCall::RequestAccess);
        if state.notifications_unavailable {
            return Err(PlatformError::Unsupported("notification listener"));
        }
        Ok(state.notification_access)
    }

    fn list(&self) -> PlatformResult<Vec<Notification>> {
        let mut state = self.state.lock();
        state.notification_calls.push(NotificationCall::List);
        if state.notifications_unavailable {
            return Err(PlatformError::Unsupported("notification listener"));
        }
        if state.notification_access != NotificationAccess::Allowed {
            return Err(PlatformError::AccessDenied("notification listener"));
        }
        Ok(state.notifications.clone())
    }

    fn remove(&self, id: u32) -> PlatformResult<()> {
        let push = {
            let mut state = self.state.lock();
            state.notification_calls.push(NotificationCall::Remove(id));
            if state.notifications_unavailable {
                return Err(PlatformError::Unsupported("notification listener"));
            }
            state.notifications.retain(|known| known.id != id);
            state.notification_delivery == NotificationDelivery::Push
        };
        if push {
            self.publish(PlatformEvent::NotificationsChanged);
        }
        Ok(())
    }

    fn clear(&self) -> PlatformResult<()> {
        let push = {
            let mut state = self.state.lock();
            state.notification_calls.push(NotificationCall::Clear);
            if state.notifications_unavailable {
                return Err(PlatformError::Unsupported("notification listener"));
            }
            state.notifications.clear();
            state.notification_delivery == NotificationDelivery::Push
        };
        if push {
            self.publish(PlatformEvent::NotificationsChanged);
        }
        Ok(())
    }

    fn watch(&self) -> PlatformResult<NotificationDelivery> {
        let mut state = self.state.lock();
        state.notification_calls.push(NotificationCall::Watch);
        if state.notifications_unavailable {
            return Err(PlatformError::Unsupported("notification listener"));
        }
        Ok(state.notification_delivery)
    }

    fn app_logo(&self, app_id: &str) -> PlatformResult<Option<Thumbnail>> {
        let mut state = self.state.lock();
        state
            .notification_calls
            .push(NotificationCall::Logo(app_id.to_owned()));
        if state.notifications_unavailable {
            return Err(PlatformError::Unsupported("notification listener"));
        }
        Ok(state.app_logos.get(app_id).cloned())
    }

    fn focus_active(&self) -> Option<bool> {
        self.state.lock().focus_active
    }

    fn open_app(&self, app_id: &str) -> PlatformResult<()> {
        let mut state = self.state.lock();
        state
            .notification_calls
            .push(NotificationCall::OpenApp(app_id.to_owned()));
        if state
            .notifications
            .iter()
            .any(|notification| notification.app_id == app_id)
        {
            Ok(())
        } else {
            Err(PlatformError::NotFound(format!("app {app_id}")))
        }
    }
}

impl Secrets for FakePlatform {
    fn get(&self, key: &str) -> PlatformResult<Option<String>> {
        let state = self.state.lock();
        if state.secrets_unavailable {
            return Err(secrets_error());
        }
        Ok(state.secrets.get(key).cloned())
    }

    fn set(&self, key: &str, value: &str) -> PlatformResult<()> {
        let mut state = self.state.lock();
        if state.secrets_unavailable {
            return Err(secrets_error());
        }
        state.secrets.insert(key.to_owned(), value.to_owned());
        Ok(())
    }

    fn remove(&self, key: &str) -> PlatformResult<()> {
        let mut state = self.state.lock();
        if state.secrets_unavailable {
            return Err(secrets_error());
        }
        state.secrets.remove(key);
        Ok(())
    }
}

/// `ERROR_NOT_FOUND`-shaped failure: the code Windows gives for a vault it cannot open.
fn secrets_error() -> PlatformError {
    PlatformError::Os {
        api: "CredReadW",
        code: 0x8007_0490,
    }
}

impl Location for FakePlatform {
    fn position(&self) -> PlatformResult<GeoPosition> {
        let mut state = self.state.lock();
        state.location_requests += 1;
        if state.location_denied {
            return Err(PlatformError::AccessDenied("location"));
        }
        state.location.ok_or(PlatformError::Unsupported("location"))
    }
}

impl SystemStats for FakePlatform {
    fn sample(&self, top_processes: usize) -> PlatformResult<SystemSample> {
        let mut state = self.state.lock();
        state.system_sample_requests.push(top_processes);
        let sample = if state.system_samples.len() > 1 {
            state.system_samples.pop()
        } else {
            state.system_samples.last().cloned()
        };
        let mut sample = sample.ok_or(PlatformError::Unsupported("system stats"))?;
        sample.processes.truncate(top_processes);
        Ok(sample)
    }
}

impl Windowing for FakePlatform {
    fn extended_style(&self, _window: WindowHandle) -> PlatformResult<u32> {
        // WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, the shape the shell wants.
        Ok(0x0000_0008 | 0x0000_0080 | 0x0800_0000)
    }

    fn set_tool_window(&self, window: WindowHandle) -> PlatformResult<u32> {
        self.state
            .lock()
            .windowing_calls
            .push(WindowingCall::SetToolWindow(window));
        self.extended_style(window)
    }

    fn set_click_through(&self, window: WindowHandle, click_through: bool) -> PlatformResult<()> {
        self.state
            .lock()
            .windowing_calls
            .push(WindowingCall::SetClickThrough(window, click_through));
        Ok(())
    }

    fn move_async(&self, window: WindowHandle, rect: Rect) -> PlatformResult<()> {
        let mut state = self.state.lock();
        state.window_rects.retain(|(handle, _)| *handle != window);
        state.window_rects.push((window, rect));
        state
            .windowing_calls
            .push(WindowingCall::MoveAsync(window, rect));
        Ok(())
    }

    fn assert_topmost(&self, window: WindowHandle) -> PlatformResult<()> {
        self.state
            .lock()
            .windowing_calls
            .push(WindowingCall::AssertTopmost(window));
        Ok(())
    }

    fn set_capture_exclusion(&self, window: WindowHandle, excluded: bool) -> PlatformResult<()> {
        self.state
            .lock()
            .windowing_calls
            .push(WindowingCall::SetCaptureExclusion(window, excluded));
        Ok(())
    }

    fn set_no_activate(&self, window: WindowHandle, no_activate: bool) -> PlatformResult<()> {
        self.state
            .lock()
            .windowing_calls
            .push(WindowingCall::SetNoActivate(window, no_activate));
        Ok(())
    }

    fn window_rect(&self, window: WindowHandle) -> PlatformResult<Rect> {
        self.state
            .lock()
            .window_rects
            .iter()
            .find(|(handle, _)| *handle == window)
            .map(|(_, rect)| *rect)
            .ok_or_else(|| PlatformError::NotFound(format!("window {window}")))
    }

    fn cursor_position(&self) -> PlatformResult<(i32, i32)> {
        Ok(self.state.lock().pointer.position)
    }

    fn pointer_button_down(&self) -> PlatformResult<bool> {
        Ok(self.state.lock().pointer.button_down)
    }

    fn window_at(&self, x: i32, y: i32) -> PlatformResult<WindowHandle> {
        Ok(self
            .state
            .lock()
            .window_rects
            .iter()
            .find(|(_, rect)| rect.contains(x, y))
            .map_or(0, |(handle, _)| *handle))
    }

    fn user_notification_state(&self) -> PlatformResult<UserNotificationState> {
        Ok(self.state.lock().quiet)
    }
}

impl AppBar for FakePlatform {
    fn reserve_top(
        &self,
        window: WindowHandle,
        monitor: Rect,
        height: u32,
    ) -> PlatformResult<Rect> {
        let granted = Rect::new(monitor.x, monitor.y, monitor.width, height);
        let mut state = self.state.lock();
        state.app_bars.retain(|(handle, _)| *handle != window);
        state.app_bars.push((window, granted));
        state
            .windowing_calls
            .push(WindowingCall::ReserveAppBar(window, monitor, height));
        Ok(granted)
    }

    fn release(&self, window: WindowHandle) -> PlatformResult<()> {
        let mut state = self.state.lock();
        let before = state.app_bars.len();
        state.app_bars.retain(|(handle, _)| *handle != window);
        if state.app_bars.len() != before {
            state
                .windowing_calls
                .push(WindowingCall::ReleaseAppBar(window));
        }
        Ok(())
    }
}

impl Autostart for FakePlatform {
    fn mechanism(&self) -> AutostartMechanism {
        AutostartMechanism::None
    }

    fn is_enabled(&self) -> PlatformResult<bool> {
        Ok(self.state.lock().autostart_enabled)
    }

    fn set_enabled(&self, enabled: bool) -> PlatformResult<()> {
        let mut state = self.state.lock();
        if enabled && state.autostart_denied {
            return Err(PlatformError::AccessDenied("startup task"));
        }
        state.autostart_enabled = enabled;
        Ok(())
    }
}

impl Media for FakePlatform {
    fn sessions(&self) -> PlatformResult<Vec<MediaSession>> {
        Ok(self.state.lock().sessions.clone())
    }

    fn thumbnail(&self, source_app_id: &str) -> PlatformResult<Option<Thumbnail>> {
        let state = self.state.lock();
        if !state
            .sessions
            .iter()
            .any(|s| s.source_app_id == source_app_id)
        {
            return Err(PlatformError::NotFound(format!(
                "media session {source_app_id}"
            )));
        }
        Ok(state
            .thumbnails
            .iter()
            .find(|(app, _)| app == source_app_id)
            .map(|(_, thumbnail)| thumbnail.clone()))
    }

    fn send(&self, source_app_id: &str, command: MediaCommand) -> PlatformResult<()> {
        let mut state = self.state.lock();
        if !state
            .sessions
            .iter()
            .any(|s| s.source_app_id == source_app_id)
        {
            return Err(PlatformError::NotFound(format!(
                "media session {source_app_id}"
            )));
        }
        state
            .sent_media_commands
            .push((source_app_id.to_owned(), command));
        Ok(())
    }

    fn refresh(&self) -> PlatformResult<()> {
        self.state.lock().media_refreshes += 1;
        Ok(())
    }
}

impl Audio for FakePlatform {
    fn devices(&self) -> PlatformResult<Vec<AudioDevice>> {
        Ok(self.state.lock().audio_devices.clone())
    }

    fn volume(&self) -> PlatformResult<u8> {
        Ok(self.state.lock().volume)
    }

    fn set_volume(&self, percent: u8) -> PlatformResult<()> {
        let muted = self.state.lock().muted;
        self.set_volume_state(percent, muted);
        Ok(())
    }

    fn muted(&self) -> PlatformResult<bool> {
        Ok(self.state.lock().muted)
    }

    fn set_muted(&self, muted: bool) -> PlatformResult<()> {
        let percent = self.state.lock().volume;
        self.set_volume_state(percent, muted);
        Ok(())
    }

    fn mic_muted(&self) -> PlatformResult<Option<bool>> {
        Ok(self.state.lock().mic_muted)
    }

    fn set_mic_muted(&self, muted: bool) -> PlatformResult<()> {
        if self.state.lock().mic_muted.is_none() {
            return Err(PlatformError::NotFound("default capture device".into()));
        }
        self.set_mic_muted_state(Some(muted));
        Ok(())
    }

    fn set_default_device(&self, id: &str) -> PlatformResult<()> {
        let mut state = self.state.lock();
        if !state.audio_devices.iter().any(|d| d.id == id) {
            return Err(PlatformError::NotFound(format!("audio device {id}")));
        }
        for device in &mut state.audio_devices {
            device.is_default = device.id == id;
        }
        Ok(())
    }
}

impl Brightness for FakePlatform {
    fn monitors(&self) -> PlatformResult<Vec<BrightnessMonitor>> {
        Ok(self.state.lock().brightness.clone())
    }

    fn set(&self, id: &str, percent: u8) -> PlatformResult<()> {
        let percent = percent.min(100);
        {
            let mut state = self.state.lock();
            if !state.brightness.iter().any(|m| m.id == id) {
                return Err(PlatformError::NotFound(format!("brightness monitor {id}")));
            }
            state.brightness_sets.push((id.to_owned(), percent));
        }
        // The real implementation answers through the event once the monitor confirmed.
        self.set_brightness_state(id, percent);
        Ok(())
    }
}

impl SystemOsd for FakePlatform {
    fn set_suppressed(&self, suppressed: bool) -> PlatformResult<OsdState> {
        let mut state = self.state.lock();
        state.osd_requests.push(suppressed);
        state.osd = if state.osd_unavailable {
            OsdState::Unavailable
        } else if suppressed {
            OsdState::Suppressed
        } else {
            OsdState::Native
        };
        Ok(state.osd)
    }

    fn state(&self) -> OsdState {
        self.state.lock().osd
    }
}

impl Bluetooth for FakePlatform {
    fn devices(&self) -> PlatformResult<Vec<BluetoothDevice>> {
        Ok(self.state.lock().bluetooth.clone())
    }

    fn connect(&self, id: &str) -> PlatformResult<()> {
        self.state
            .lock()
            .bluetooth_calls
            .push(BluetoothCall::Connect(id.to_owned()));
        self.toggle_bluetooth(id, true)
    }

    fn disconnect(&self, id: &str) -> PlatformResult<()> {
        self.state
            .lock()
            .bluetooth_calls
            .push(BluetoothCall::Disconnect(id.to_owned()));
        self.toggle_bluetooth(id, false)
    }

    fn radio(&self) -> BluetoothRadioState {
        self.state.lock().bluetooth_radio
    }

    fn set_radio(&self, on: bool) -> PlatformResult<()> {
        let radio = {
            let mut state = self.state.lock();
            state.bluetooth_calls.push(BluetoothCall::SetRadio(on));
            if state.bluetooth_radio_denied {
                return Err(PlatformError::AccessDenied("bluetooth radio"));
            }
            if state.bluetooth_radio == BluetoothRadioState::Unavailable {
                return Err(PlatformError::Unsupported("bluetooth radio"));
            }
            let radio = if on {
                BluetoothRadioState::On
            } else {
                BluetoothRadioState::Off
            };
            if state.bluetooth_radio == radio {
                return Ok(());
            }
            state.bluetooth_radio = radio;
            radio
        };
        self.publish(PlatformEvent::BluetoothRadioChanged(radio));
        Ok(())
    }
}

impl FakePlatform {
    fn toggle_bluetooth(&self, id: &str, connected: bool) -> PlatformResult<()> {
        let device = {
            let mut state = self.state.lock();
            if state.bluetooth_unsupported {
                return Err(PlatformError::Unsupported(if connected {
                    "bluetooth connect"
                } else {
                    "bluetooth disconnect"
                }));
            }
            let device = state
                .bluetooth
                .iter_mut()
                .find(|d| d.id == id)
                .ok_or_else(|| PlatformError::NotFound(format!("bluetooth device {id}")))?;
            if device.connected == connected {
                return Ok(());
            }
            device.connected = connected;
            if !connected {
                device.battery_percent = None;
            }
            device.clone()
        };
        self.publish(PlatformEvent::BluetoothChanged(device));
        Ok(())
    }
}

impl Power for FakePlatform {
    fn battery(&self) -> PlatformResult<BatteryState> {
        Ok(self.state.lock().battery)
    }
}

impl Monitors for FakePlatform {
    fn all(&self) -> PlatformResult<Vec<MonitorInfo>> {
        Ok(self.state.lock().monitors.clone())
    }
}

impl Foreground for FakePlatform {
    fn current(&self) -> PlatformResult<Option<ForegroundWindow>> {
        Ok(self.state.lock().foreground.clone())
    }

    fn idle_for(&self) -> PlatformResult<Duration> {
        Ok(self.state.lock().idle_for)
    }
}

impl AppInfo for FakePlatform {
    fn describe(&self, executable: &Path, icon_size: u32) -> PlatformResult<AppDescription> {
        let mut state = self.state.lock();
        state
            .app_info_calls
            .push((executable.to_path_buf(), icon_size));
        state
            .app_descriptions
            .get(executable)
            .cloned()
            .ok_or_else(|| PlatformError::NotFound("executable".into()))
    }
}

impl Processes for FakePlatform {
    fn is_running(&self, pid: u32) -> PlatformResult<bool> {
        Ok(self.state.lock().running_pids.contains(&pid))
    }

    fn main_window(&self, pid: u32) -> PlatformResult<Option<WindowHandle>> {
        Ok(self.state.lock().process_windows.get(&pid).copied())
    }

    fn owner_of_local_port(&self, port: u16) -> PlatformResult<Option<u32>> {
        Ok(self.state.lock().port_owners.get(&port).copied())
    }

    fn focus(&self, window: WindowHandle) -> PlatformResult<()> {
        let mut state = self.state.lock();
        state.focus_calls.push(window);
        if state.focus_refused {
            return Err(PlatformError::AccessDenied("foreground"));
        }
        Ok(())
    }
}

impl SystemInfo for FakePlatform {
    fn describe(&self) -> PlatformResult<SystemDescription> {
        Ok(self.state.lock().system.clone())
    }

    fn desktop_dir(&self) -> PlatformResult<PathBuf> {
        self.state
            .lock()
            .desktop_dir
            .clone()
            .ok_or(PlatformError::NotFound("desktop folder".into()))
    }

    fn region_format(&self) -> PlatformResult<String> {
        Ok(self.state.lock().region_format.clone())
    }
}

impl FileOps for FakePlatform {
    fn transfer(
        &self,
        items: &[PathBuf],
        destination: &Path,
        mode: TransferMode,
    ) -> PlatformResult<()> {
        self.file_op(FileOpsCall::Transfer {
            items: items.to_vec(),
            destination: destination.to_path_buf(),
            mode,
        })
    }

    fn recycle(&self, items: &[PathBuf]) -> PlatformResult<()> {
        self.file_op(FileOpsCall::Recycle(items.to_vec()))
    }

    fn open(&self, item: &Path) -> PlatformResult<()> {
        self.file_op(FileOpsCall::Open(item.to_path_buf()))
    }

    fn open_with(&self, item: &Path) -> PlatformResult<()> {
        self.file_op(FileOpsCall::OpenWith(item.to_path_buf()))
    }

    fn reveal(&self, items: &[PathBuf]) -> PlatformResult<()> {
        self.file_op(FileOpsCall::Reveal(items.to_vec()))
    }

    fn share(&self, window: WindowHandle, items: &[PathBuf]) -> PlatformResult<()> {
        self.file_op(FileOpsCall::Share(window, items.to_vec()))
    }

    fn eject(&self, item: &Path) -> PlatformResult<()> {
        self.file_op(FileOpsCall::Eject(item.to_path_buf()))
    }

    fn pick_folder(&self, window: WindowHandle, title: &str) -> PlatformResult<Option<PathBuf>> {
        self.file_op(FileOpsCall::PickFolder(window, title.to_owned()))?;
        Ok(self.state.lock().picked_folder.clone())
    }

    fn thumbnail(&self, item: &Path, size: u32) -> PlatformResult<Vec<u8>> {
        self.file_op(FileOpsCall::Thumbnail(item.to_path_buf(), size))?;
        self.state
            .lock()
            .file_thumbnails
            .get(item)
            .cloned()
            .ok_or_else(|| PlatformError::NotFound(item.display().to_string()))
    }
}

impl DragSource for FakePlatform {
    fn start_drag(
        &self,
        window: WindowHandle,
        payload: &DragPayload,
    ) -> PlatformResult<DragOutcome> {
        let mut state = self.state.lock();
        state.drag_calls.push(DragCall {
            window,
            payload: payload.clone(),
        });
        state.drag_outcome.clone()
    }

    fn place_on_clipboard(&self, payload: &DragPayload) -> PlatformResult<()> {
        let mut state = self.state.lock();
        state.clipboard_payloads.push(payload.clone());
        match &state.file_ops_error {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }
}

impl WindowPlacement for FakePlatform {
    fn is_snappable(&self, window: WindowHandle) -> PlatformResult<bool> {
        Ok(self
            .state
            .lock()
            .foreign_windows
            .get(&window)
            .is_some_and(|w| w.snappable))
    }

    fn frame_bounds(&self, window: WindowHandle) -> PlatformResult<Rect> {
        self.state
            .lock()
            .foreign_windows
            .get(&window)
            .map(|w| w.frame)
            .ok_or_else(|| PlatformError::NotFound(format!("window {window}")))
    }

    fn place(&self, window: WindowHandle, target: Rect) -> PlatformResult<()> {
        let mut state = self.state.lock();
        state
            .placement_calls
            .push(PlacementCall::Place(window, target));
        if let Some(error) = state.placement_error.clone() {
            return Err(error);
        }
        let Some(foreign) = state.foreign_windows.get_mut(&window) else {
            return Err(PlatformError::NotFound(format!("window {window}")));
        };
        if !foreign.stuck {
            foreign.frame = target;
        }
        Ok(())
    }

    fn maximize(&self, window: WindowHandle, work_area: Rect) -> PlatformResult<()> {
        let mut state = self.state.lock();
        state
            .placement_calls
            .push(PlacementCall::Maximize(window, work_area));
        if let Some(error) = state.placement_error.clone() {
            return Err(error);
        }
        let Some(foreign) = state.foreign_windows.get_mut(&window) else {
            return Err(PlatformError::NotFound(format!("window {window}")));
        };
        if !foreign.stuck {
            foreign.frame = work_area;
        }
        Ok(())
    }
}

impl Platform for FakePlatform {
    fn media(&self) -> &dyn Media {
        self
    }

    fn audio(&self) -> &dyn Audio {
        self
    }

    fn brightness(&self) -> &dyn Brightness {
        self
    }

    fn system_osd(&self) -> &dyn SystemOsd {
        self
    }

    fn bluetooth(&self) -> &dyn Bluetooth {
        self
    }

    fn power(&self) -> &dyn Power {
        self
    }

    fn system_stats(&self) -> &dyn SystemStats {
        self
    }

    fn location(&self) -> &dyn Location {
        self
    }

    fn secrets(&self) -> &dyn Secrets {
        self
    }

    fn notifications(&self) -> &dyn Notifications {
        self
    }

    fn monitors(&self) -> &dyn Monitors {
        self
    }

    fn foreground(&self) -> &dyn Foreground {
        self
    }

    fn app_info(&self) -> &dyn AppInfo {
        self
    }

    fn processes(&self) -> &dyn Processes {
        self
    }

    fn system_info(&self) -> &dyn SystemInfo {
        self
    }

    fn windowing(&self) -> &dyn Windowing {
        self
    }

    fn app_bar(&self) -> &dyn AppBar {
        self
    }

    fn autostart(&self) -> &dyn Autostart {
        self
    }

    fn file_ops(&self) -> &dyn FileOps {
        self
    }

    fn drag_source(&self) -> &dyn DragSource {
        self
    }

    fn window_placement(&self) -> &dyn WindowPlacement {
        self
    }

    fn subscribe(&self) -> broadcast::Receiver<PlatformEvent> {
        self.events.subscribe()
    }

    fn name(&self) -> &'static str {
        "fake"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::PlaybackStatus;

    #[test]
    fn file_operations_are_recorded_and_fail_as_scripted() {
        let fake = FakePlatform::new();
        let items = vec![PathBuf::from(r"C:\in\a.txt"), PathBuf::from(r"C:\in\b.txt")];
        fake.file_ops()
            .transfer(&items, Path::new(r"D:\out"), TransferMode::Move)
            .unwrap();
        assert_eq!(fake.file_ops().pick_folder(7, "Copy to").unwrap(), None);
        fake.set_picked_folder(Some(PathBuf::from(r"E:\picked")));
        assert_eq!(
            fake.file_ops().pick_folder(7, "Copy to").unwrap(),
            Some(PathBuf::from(r"E:\picked"))
        );

        fake.set_file_ops_error(Some(PlatformError::NotFound("removable volume".into())));
        assert_eq!(
            fake.file_ops().eject(Path::new(r"C:\in\a.txt")),
            Err(PlatformError::NotFound("removable volume".into()))
        );

        assert_eq!(
            fake.file_ops_calls(),
            vec![
                FileOpsCall::Transfer {
                    items: items.clone(),
                    destination: PathBuf::from(r"D:\out"),
                    mode: TransferMode::Move,
                },
                FileOpsCall::PickFolder(7, "Copy to".into()),
                FileOpsCall::PickFolder(7, "Copy to".into()),
                FileOpsCall::Eject(PathBuf::from(r"C:\in\a.txt")),
            ]
        );
    }

    #[test]
    fn drags_out_are_recorded_and_end_as_scripted() {
        let fake = FakePlatform::new();
        let files = DragPayload::Files(vec![PathBuf::from(r"C:\shelf\a.txt")]);
        assert_eq!(
            fake.drag_source().start_drag(9, &files).unwrap(),
            DragOutcome::Dropped {
                effect: DropEffect::Copy
            }
        );
        fake.set_drag_outcome(Ok(DragOutcome::Cancelled));
        let text = DragPayload::Text("hello".into());
        assert_eq!(
            fake.drag_source().start_drag(9, &text).unwrap(),
            DragOutcome::Cancelled
        );
        fake.set_drag_outcome(Err(PlatformError::Unsupported("drag")));
        assert_eq!(
            fake.drag_source().start_drag(9, &text),
            Err(PlatformError::Unsupported("drag"))
        );
        assert_eq!(
            fake.drag_calls(),
            vec![
                DragCall {
                    window: 9,
                    payload: files
                },
                DragCall {
                    window: 9,
                    payload: text.clone()
                },
                DragCall {
                    window: 9,
                    payload: text
                },
            ]
        );
    }

    #[test]
    fn clipboard_and_thumbnails_are_scripted_like_the_other_file_ops() {
        let fake = FakePlatform::new();
        let files = DragPayload::Files(vec![PathBuf::from(r"C:\shelf\a.txt")]);
        fake.drag_source().place_on_clipboard(&files).unwrap();
        assert_eq!(fake.clipboard_payloads(), vec![files]);

        let item = PathBuf::from(r"C:\shelf\a.png");
        assert_eq!(
            fake.file_ops().thumbnail(&item, 64),
            Err(PlatformError::NotFound(item.display().to_string()))
        );
        fake.set_thumbnail(item.clone(), vec![0x89, b'P', b'N', b'G']);
        assert_eq!(
            fake.file_ops().thumbnail(&item, 64).unwrap(),
            vec![0x89, b'P', b'N', b'G']
        );
        assert_eq!(
            fake.file_ops_calls(),
            vec![
                FileOpsCall::Thumbnail(item.clone(), 64),
                FileOpsCall::Thumbnail(item, 64),
            ]
        );
        fake.set_file_ops_error(Some(PlatformError::Unsupported("clipboard")));
        assert_eq!(
            fake.drag_source()
                .place_on_clipboard(&DragPayload::Text("x".into())),
            Err(PlatformError::Unsupported("clipboard"))
        );
    }

    fn session(app: &str, title: &str) -> MediaSession {
        MediaSession {
            artist: "Artist".into(),
            status: PlaybackStatus::Playing,
            position_ms: Some(0),
            duration_ms: Some(180_000),
            ..MediaSession::new(app, title)
        }
    }

    #[test]
    fn thumbnails_are_scripted_per_session_and_bump_the_art_version() {
        let fake = FakePlatform::new();
        fake.push_media_session(session("Spotify.exe", "Song"));
        assert_eq!(fake.media().thumbnail("Spotify.exe").unwrap(), None);
        assert!(matches!(
            fake.media().thumbnail("Nope.exe"),
            Err(PlatformError::NotFound(_))
        ));

        let mut rx = fake.subscribe();
        fake.set_media_thumbnail("Spotify.exe", vec![1, 2, 3], "image/png");
        let art = fake.media().thumbnail("Spotify.exe").unwrap().unwrap();
        assert_eq!(art.bytes, vec![1, 2, 3]);
        assert_eq!(art.content_type, "image/png");
        match rx.try_recv().unwrap() {
            PlatformEvent::MediaSessionsChanged(sessions) => {
                assert_eq!(sessions[0].art_version, 1);
            }
            other => panic!("unexpected event {other:?}"),
        }

        fake.remove_media_session("Spotify.exe");
        assert!(fake.media().sessions().unwrap().is_empty());
        assert_eq!(fake.media_refreshes(), 0);
        fake.media().refresh().unwrap();
        assert_eq!(fake.media_refreshes(), 1);
    }

    #[test]
    fn pushing_a_session_updates_snapshot_and_publishes_event() {
        let fake = FakePlatform::new();
        let mut rx = fake.subscribe();

        fake.push_media_session(session("Spotify.exe", "Song"));

        assert_eq!(fake.media().sessions().unwrap().len(), 1);
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::MediaSessionsChanged(vec![session("Spotify.exe", "Song")])
        );
    }

    #[test]
    fn pushing_same_source_replaces_instead_of_duplicating() {
        let fake = FakePlatform::new();
        fake.push_media_session(session("Spotify.exe", "One"));
        fake.push_media_session(session("Spotify.exe", "Two"));

        let sessions = fake.media().sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].title, "Two");
    }

    #[test]
    fn media_commands_are_recorded_for_known_sessions_only() {
        let fake = FakePlatform::new();
        assert_eq!(
            fake.media().send("Nope.exe", MediaCommand::Play),
            Err(PlatformError::NotFound("media session Nope.exe".into()))
        );

        fake.push_media_session(session("Spotify.exe", "Song"));
        fake.media()
            .send("Spotify.exe", MediaCommand::TogglePlayPause)
            .unwrap();
        assert_eq!(
            fake.sent_media_commands(),
            vec![("Spotify.exe".to_owned(), MediaCommand::TogglePlayPause)]
        );
    }

    #[test]
    fn volume_is_clamped_and_published() {
        let fake = FakePlatform::new();
        let mut rx = fake.subscribe();
        fake.audio().set_volume(250).unwrap();
        assert_eq!(fake.audio().volume().unwrap(), 100);
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::VolumeChanged {
                percent: 100,
                muted: false
            }
        );
    }

    #[test]
    fn mute_keeps_the_level_and_publishes_one_event() {
        let fake = FakePlatform::new();
        fake.audio().set_volume(30).unwrap();
        let mut rx = fake.subscribe();
        fake.audio().set_muted(true).unwrap();
        assert!(fake.audio().muted().unwrap());
        assert_eq!(fake.audio().volume().unwrap(), 30);
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::VolumeChanged {
                percent: 30,
                muted: true
            }
        );
    }

    #[test]
    fn microphone_mute_is_scripted_and_absent_when_there_is_no_capture_device() {
        let fake = FakePlatform::new();
        let mut rx = fake.subscribe();
        fake.audio().set_mic_muted(true).unwrap();
        assert_eq!(fake.audio().mic_muted().unwrap(), Some(true));
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::MicMuteChanged { muted: true }
        );

        fake.set_mic_muted_state(None);
        assert_eq!(fake.audio().mic_muted().unwrap(), None);
        assert!(matches!(
            fake.audio().set_mic_muted(false),
            Err(PlatformError::NotFound(_))
        ));
        assert!(rx.try_recv().is_err(), "removing the mic publishes nothing");
    }

    #[test]
    fn brightness_is_per_monitor_recorded_and_published() {
        use crate::types::BrightnessKind;
        let fake = FakePlatform::new();
        assert!(fake.brightness().monitors().unwrap().is_empty());
        assert!(matches!(
            fake.brightness().set("nope", 10),
            Err(PlatformError::NotFound(_))
        ));

        fake.add_brightness_monitor(BrightnessMonitor {
            id: r"\\.\DISPLAY1#0".into(),
            name: "DELL U2723QE".into(),
            percent: 40,
            kind: BrightnessKind::External,
        });
        let mut rx = fake.subscribe();
        fake.brightness().set(r"\\.\DISPLAY1#0", 180).unwrap();
        assert_eq!(fake.brightness().monitors().unwrap()[0].percent, 100);
        assert_eq!(
            fake.brightness_sets(),
            vec![(r"\\.\DISPLAY1#0".to_owned(), 100)]
        );
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::BrightnessChanged {
                monitor_id: r"\\.\DISPLAY1#0".into(),
                percent: 100
            }
        );

        // A change from outside Muna (brightness keys) is not a recorded set.
        fake.set_brightness_state(r"\\.\DISPLAY1#0", 55);
        assert_eq!(fake.brightness().monitors().unwrap()[0].percent, 55);
        assert_eq!(fake.brightness_sets().len(), 1);
        fake.set_brightness_state("unknown", 1);
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::BrightnessChanged {
                monitor_id: r"\\.\DISPLAY1#0".into(),
                percent: 55
            }
        );
        assert!(rx.try_recv().is_err(), "unknown monitors publish nothing");
    }

    #[test]
    fn osd_suppression_is_recorded_and_reports_unavailable_builds() {
        let fake = FakePlatform::new();
        assert_eq!(fake.system_osd().state(), OsdState::Native);
        assert_eq!(
            fake.system_osd().set_suppressed(true).unwrap(),
            OsdState::Suppressed
        );
        assert_eq!(fake.system_osd().state(), OsdState::Suppressed);
        assert_eq!(
            fake.system_osd().set_suppressed(false).unwrap(),
            OsdState::Native
        );
        assert_eq!(fake.osd_requests(), vec![true, false]);

        fake.set_osd_unavailable(true);
        assert_eq!(fake.system_osd().state(), OsdState::Unavailable);
        assert_eq!(
            fake.system_osd().set_suppressed(true).unwrap(),
            OsdState::Unavailable
        );
    }

    #[test]
    fn battery_and_foreground_scripts_round_trip() {
        let fake = FakePlatform::new();
        let battery = BatteryState {
            percent: Some(42),
            source: PowerSource::Battery,
            charging: false,
        };
        fake.set_battery(battery);
        assert_eq!(fake.power().battery().unwrap(), battery);

        let window = ForegroundWindow {
            handle: 42,
            title: "Game".into(),
            process_name: "game.exe".into(),
            process_path: r"C:\Games\game.exe".into(),
            bounds: Rect::new(0, 0, 2560, 1440),
            is_fullscreen: true,
        };
        fake.foreground_changed(window.clone());
        assert_eq!(fake.foreground().current().unwrap(), Some(window));
    }

    #[test]
    fn idle_time_and_app_descriptions_are_scripted() {
        let fake = FakePlatform::new();
        assert_eq!(fake.foreground().idle_for().unwrap(), Duration::ZERO);
        fake.set_idle_for(Duration::from_secs(300));
        assert_eq!(
            fake.foreground().idle_for().unwrap(),
            Duration::from_secs(300)
        );

        let exe = PathBuf::from(r"C:\Games\game.exe");
        assert!(matches!(
            fake.app_info().describe(&exe, 64),
            Err(PlatformError::NotFound(_))
        ));
        let description = AppDescription {
            name: Some("Game".into()),
            icon_png: Some(vec![0x89, b'P', b'N', b'G']),
        };
        fake.set_app_description(exe.clone(), description.clone());
        assert_eq!(fake.app_info().describe(&exe, 64).unwrap(), description);
        assert_eq!(fake.app_info_calls(), vec![(exe.clone(), 64), (exe, 64)]);
    }

    #[test]
    fn processes_are_scripted() {
        let fake = FakePlatform::new();
        assert!(!fake.processes().is_running(4242).unwrap());
        assert_eq!(fake.processes().main_window(4242).unwrap(), None);

        fake.set_process_running(4242, true);
        fake.set_process_window(4242, Some(0x9000));
        assert!(fake.processes().is_running(4242).unwrap());
        assert_eq!(fake.processes().main_window(4242).unwrap(), Some(0x9000));

        fake.processes().focus(0x9000).unwrap();
        fake.set_focus_refused(true);
        assert_eq!(
            fake.processes().focus(0x9000),
            Err(PlatformError::AccessDenied("foreground"))
        );
        assert_eq!(fake.focus_calls(), vec![0x9000, 0x9000]);

        fake.set_process_running(4242, false);
        fake.set_process_window(4242, None);
        assert!(!fake.processes().is_running(4242).unwrap());
        assert_eq!(fake.processes().main_window(4242).unwrap(), None);

        assert_eq!(fake.processes().owner_of_local_port(50_000).unwrap(), None);
        fake.set_port_owner(50_000, Some(4242));
        assert_eq!(
            fake.processes().owner_of_local_port(50_000).unwrap(),
            Some(4242)
        );
        fake.set_port_owner(50_000, None);
        assert_eq!(fake.processes().owner_of_local_port(50_000).unwrap(), None);
    }

    #[test]
    fn system_samples_play_in_order_then_hold_the_last_reading() {
        let fake = FakePlatform::new();
        assert!(matches!(
            fake.system_stats().sample(0),
            Err(PlatformError::Unsupported("system stats"))
        ));

        let reading = |cpu: f32| SystemSample {
            cpu_percent: Some(cpu),
            logical_cpus: 8,
            processes: vec![
                crate::types::ProcessUsage {
                    name: "muna".into(),
                    cpu_percent: 1.0,
                    memory_bytes: 1,
                    count: 1,
                },
                crate::types::ProcessUsage {
                    name: "idle".into(),
                    cpu_percent: 0.5,
                    memory_bytes: 1,
                    count: 1,
                },
            ],
            ..SystemSample::default()
        };
        fake.script_system_samples(vec![reading(10.0), reading(20.0)]);

        let first = fake.system_stats().sample(0).unwrap();
        assert_eq!(first.cpu_percent, Some(10.0));
        assert!(first.processes.is_empty(), "no process walk was asked for");
        let second = fake.system_stats().sample(1).unwrap();
        assert_eq!(second.cpu_percent, Some(20.0));
        assert_eq!(second.processes.len(), 1);
        let third = fake.system_stats().sample(5).unwrap();
        assert_eq!(third.cpu_percent, Some(20.0), "the last reading repeats");
        assert_eq!(third.processes.len(), 2);
        assert_eq!(
            fake.system_sample_requests(),
            vec![0, 0, 1, 5],
            "the unsupported attempt counts too: the module did ask"
        );
    }

    #[test]
    fn foreground_handle_never_crosses_the_ipc_boundary() {
        let window = ForegroundWindow {
            handle: 42,
            title: "Game".into(),
            process_name: "game.exe".into(),
            process_path: r"C:\Games\game.exe".into(),
            bounds: Rect::default(),
            is_fullscreen: false,
        };
        let json = serde_json::to_value(&window).unwrap();
        assert!(json.get("handle").is_none());
        assert!(
            json.get("processPath").is_none() && json.get("process_path").is_none(),
            "the executable path is content the UI never needs"
        );
    }

    #[test]
    fn app_bar_reservations_are_tracked_per_window() {
        let fake = FakePlatform::new();
        let monitor = Rect::new(0, 0, 2560, 1440);
        let granted = fake.app_bar().reserve_top(7, monitor, 32).unwrap();
        assert_eq!(granted, Rect::new(0, 0, 2560, 32));
        fake.app_bar().reserve_top(7, monitor, 26).unwrap();
        assert_eq!(fake.app_bars(), vec![(7, Rect::new(0, 0, 2560, 26))]);
        fake.app_bar().release(7).unwrap();
        fake.app_bar().release(7).unwrap();
        assert!(fake.app_bars().is_empty());
        assert_eq!(
            fake.windowing_calls(),
            vec![
                WindowingCall::ReserveAppBar(7, monitor, 32),
                WindowingCall::ReserveAppBar(7, monitor, 26),
                WindowingCall::ReleaseAppBar(7),
            ],
            "releasing an unregistered window records nothing"
        );
    }

    #[test]
    fn autostart_round_trips_and_honours_a_user_denial() {
        let fake = FakePlatform::new();
        assert_eq!(fake.autostart().mechanism(), AutostartMechanism::None);
        assert!(!fake.autostart().is_enabled().unwrap());
        fake.autostart().set_enabled(true).unwrap();
        assert!(fake.autostart().is_enabled().unwrap());
        fake.autostart().set_enabled(false).unwrap();
        fake.set_autostart_denied(true);
        assert_eq!(
            fake.autostart().set_enabled(true),
            Err(PlatformError::AccessDenied("startup task"))
        );
        assert!(!fake.autostart().is_enabled().unwrap());
    }

    #[test]
    fn move_size_and_lock_scripts_publish_events() {
        let fake = FakePlatform::new();
        let mut rx = fake.subscribe();
        fake.move_size_changed(true, 0x4242);
        fake.set_session_locked(true);
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::MoveSizeChanged {
                started: true,
                window: 0x4242
            }
        );
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::SessionLockChanged { locked: true }
        );
    }

    #[test]
    fn events_before_subscribe_are_not_replayed() {
        let fake = FakePlatform::new();
        fake.set_session_locked(true);
        let mut rx = fake.subscribe();
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn windowing_records_calls_and_answers_hit_tests_from_moved_rects() {
        let fake = FakePlatform::new();
        let windowing = fake.windowing();
        windowing
            .move_async(7, Rect::new(100, 0, 1000, 440))
            .unwrap();
        windowing.assert_topmost(7).unwrap();

        assert_eq!(
            windowing.window_rect(7).unwrap(),
            Rect::new(100, 0, 1000, 440)
        );
        assert_eq!(windowing.window_at(500, 10).unwrap(), 7);
        assert_eq!(windowing.window_at(5, 10).unwrap(), 0);
        assert_eq!(
            fake.windowing_calls(),
            vec![
                WindowingCall::MoveAsync(7, Rect::new(100, 0, 1000, 440)),
                WindowingCall::AssertTopmost(7),
            ]
        );

        fake.set_user_notification_state(UserNotificationState::Busy);
        assert!(
            windowing
                .user_notification_state()
                .unwrap()
                .suppresses_overlay()
        );
    }

    #[test]
    fn location_is_scripted_and_counts_requests() {
        let platform = FakePlatform::new();
        assert!(matches!(
            platform.location().position(),
            Err(PlatformError::Unsupported("location"))
        ));
        platform.set_location(Some(GeoPosition {
            latitude: 52.5200,
            longitude: 13.4050,
            accuracy_m: Some(650.0),
        }));
        let fix = platform.location().position().unwrap();
        assert_eq!((fix.latitude, fix.longitude), (52.52, 13.405));
        platform.set_location_denied(true);
        assert!(matches!(
            platform.location().position(),
            Err(PlatformError::AccessDenied("location"))
        ));
        assert_eq!(platform.location_requests(), 3);
    }

    #[test]
    fn default_platform_is_available_everywhere() {
        let platform = crate::default_platform();
        let expected = if cfg!(windows) { "windows" } else { "fake" };
        assert_eq!(platform.name(), expected);
        // Every service is reachable even where it is not implemented yet.
        let _ = platform.monitors().all();
    }
}
