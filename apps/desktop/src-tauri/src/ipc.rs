//! The typed IPC surface. Commands and events declared here are exported to
//! `packages/contracts/src/bindings.ts` by tauri-specta; the UI never writes `invoke('…')`
//! strings by hand. Changes must be additive or versioned (docs/03-architecture.md).

// Tauri extracts command arguments (`AppHandle`, `State`, payloads) by value.
#![allow(clippy::needless_pass_by_value)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use muna_core::{ActivityState, Artwork, Settings, SettingsError, StoreError, StripContent, Tint};
use muna_platform::{
    DragOutcome, DragPayload, DropEffect, MediaCommand, MonitorInfo, PlatformError,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use specta_typescript::Typescript;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_specta::{Builder, Event, collect_commands, collect_events};

use crate::modules::bluetooth::{BluetoothCommand, BluetoothSink, BluetoothSnapshot};
use crate::modules::calendar::{
    AddSourceError, CalendarCommand, CalendarSettings, CalendarSink, CalendarSnapshot,
    SourceSetting, UrlError,
};
use crate::modules::code_hosting::{
    CodeHostError, CodeHostingCommand, CodeHostingSink, CodeHostingSnapshot, ConnectError,
    NEW_TOKEN_URL, TokenError,
};
use crate::modules::drop_actions::{
    DropAction, DropActionsSnapshot, DropError, DropJob, DropSink, WindowThread,
};
use crate::modules::hud::{HudSink, HudState};
use crate::modules::keyboard_shortcuts::{
    HotkeyBinding, HotkeyError, HotkeyRegistrar, HotkeyService, HotkeySink,
    KeyboardShortcutsSettings, RegisterError, actions as hotkey_actions,
};
use crate::modules::media::{self, MediaSink, MediaSnapshot, MediaState};
use crate::modules::notifications::{
    NotificationsCommand, NotificationsSink, NotificationsSnapshot,
};
use crate::modules::pomodoro::{PomodoroCommand, PomodoroSink, PomodoroState};
use crate::modules::shelf::{ShelfCommand, ShelfError, ShelfSink, ShelfSnapshot};
use crate::modules::system_monitor::{SystemMonitorSink, SystemMonitorSnapshot};
use crate::modules::todo::{TodoCommand, TodoError, TodoSink, TodoSnapshot};
use crate::modules::weather::{
    FetchError, Place, SearchError, WeatherCommand, WeatherSink, WeatherSnapshot,
};
use crate::modules::window_snap::{SnapError, SnapZoneRef};
use crate::shell::manager::ShellManager;
use crate::shell::model::ShellLayout;
use crate::shell::yield_rules::YieldState;
use crate::state::AppState;

/// Error shape every command returns. Messages are safe to show and to log (no user data).
#[derive(Debug, Clone, Serialize, Deserialize, Type, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{code}: {message}")]
pub struct IpcError {
    /// Stable machine-readable code (`settings.io`, `store.sqlite`, `platform.unsupported`).
    pub code: String,
    pub message: String,
}

impl IpcError {
    fn new(code: &str, message: impl std::fmt::Display) -> Self {
        Self {
            code: code.into(),
            message: message.to_string(),
        }
    }
}

impl From<SettingsError> for IpcError {
    fn from(error: SettingsError) -> Self {
        let code = match &error {
            SettingsError::Io(_) => "settings.io",
            SettingsError::Json(_) | SettingsError::MissingVersion => "settings.invalid",
            SettingsError::Newer { .. } => "settings.newer",
        };
        Self::new(code, error)
    }
}

impl From<StoreError> for IpcError {
    fn from(error: StoreError) -> Self {
        Self::new("store.sqlite", error)
    }
}

impl From<TodoError> for IpcError {
    fn from(error: TodoError) -> Self {
        match error {
            TodoError::Store(error) => error.into(),
            TodoError::EmptyTitle => Self::new("todo.emptyTitle", error),
            TodoError::EmptyName => Self::new("todo.emptyName", error),
        }
    }
}

impl From<PlatformError> for IpcError {
    fn from(error: PlatformError) -> Self {
        let code = match &error {
            PlatformError::Unsupported(_) => "platform.unsupported",
            PlatformError::Os { .. } => "platform.os",
            PlatformError::NotFound(_) => "platform.notFound",
            PlatformError::AccessDenied(_) => "platform.accessDenied",
            PlatformError::Cancelled(_) => "platform.cancelled",
        };
        Self::new(code, error)
    }
}

impl From<SearchError> for IpcError {
    fn from(error: SearchError) -> Self {
        let code = match &error {
            SearchError::Disabled => "weather.disabled",
            SearchError::Fetch(FetchError::Offline) => "weather.offline",
            SearchError::Fetch(FetchError::Provider) => "weather.provider",
        };
        Self::new(code, error)
    }
}

impl From<AddSourceError> for IpcError {
    fn from(error: AddSourceError) -> Self {
        let code = match &error {
            AddSourceError::Url(UrlError::Malformed) => "calendar.url.malformed",
            AddSourceError::Url(UrlError::Scheme) => "calendar.url.scheme",
            AddSourceError::Url(UrlError::Credentials) => "calendar.url.credentials",
            AddSourceError::Vault => "calendar.vault",
        };
        Self::new(code, error)
    }
}

impl From<ConnectError> for IpcError {
    fn from(error: ConnectError) -> Self {
        let code = match &error {
            ConnectError::Disabled => "codeHosting.disabled",
            ConnectError::Token(TokenError::Empty) => "codeHosting.token.empty",
            ConnectError::Token(TokenError::Malformed) => "codeHosting.token.malformed",
            ConnectError::Fetch(CodeHostError::Offline) => "codeHosting.offline",
            ConnectError::Fetch(CodeHostError::Unauthorized) => "codeHosting.unauthorized",
            ConnectError::Fetch(CodeHostError::RateLimited) => "codeHosting.rateLimited",
            ConnectError::Fetch(CodeHostError::Provider) => "codeHosting.provider",
            ConnectError::Vault => "codeHosting.vault",
        };
        Self::new(code, error)
    }
}

impl From<HotkeyError> for IpcError {
    fn from(error: HotkeyError) -> Self {
        let code = match &error {
            HotkeyError::Invalid => "hotkey.invalid",
            HotkeyError::InUse => "hotkey.inUse",
            HotkeyError::Taken { .. } => "hotkey.taken",
        };
        Self::new(code, error)
    }
}

/// Static facts about the running build, for the settings "About" section and diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    /// `"windows"` or `"fake"`.
    pub platform: String,
    pub profile_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct SettingsChanged {
    pub settings: Settings,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct StripContentChanged {
    pub content: StripContent,
}

/// Which UI the notch window should render.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ShellMode {
    /// The product shell.
    Normal,
    /// The M0-E2 window spike (`MUNA_SPIKE=window`, docs/spikes/m0-window.md).
    SpikeWindow,
}

/// A painted shape in whole CSS pixels relative to the window's client area (the UI rounds
/// `DOMRect`s). Rust converts it to physical screen pixels for hit-testing
/// (docs/modules/notch-shell.md).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShapeRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Frame statistics the UI measured during one strip ↔ panel morph. Integers only: specta
/// exports floats as `number | null`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MorphReport {
    pub expanded: bool,
    pub frames: u32,
    pub duration_us: u32,
    pub max_frame_us: u32,
    /// Frames whose delta exceeded 1.5 × 16.7 ms.
    pub dropped_frames: u32,
}

/// Asks every notch window to morph (spike shortcut `Ctrl+Alt+M` or scripted run).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct MorphRequested {
    pub expanded: bool,
}

/// S2 spike only (`MUNA_SPIKE=drag`, docs/spikes/m4-drag.md): the files the UI arms a drag-out
/// of from the strip. The product shell answers `null`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DragSpike {
    pub paths: Vec<String>,
}

/// What a drag out of the notch carries (docs/modules/shelf.md "Drag out").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum DragOutRequest {
    /// Files or folders by path (the S2 spike; the product UI never holds paths).
    Files { paths: Vec<String> },
    /// A text snippet.
    Text { text: String },
    /// Shelf items by id; Rust resolves them to their files or text.
    Shelf { ids: Vec<String> },
}

impl DragOutRequest {
    /// The OLE payload; Shelf ids are resolved through the module.
    fn into_payload(self, state: &AppState) -> Result<DragPayload, IpcError> {
        match self {
            Self::Files { paths } => Ok(DragPayload::Files(
                paths.into_iter().map(PathBuf::from).collect(),
            )),
            Self::Text { text } => Ok(DragPayload::Text(text)),
            Self::Shelf { ids } => Ok(state.modules.shelf.payload(&ids)?),
        }
    }
}

/// A notch window's layout changed (attached, monitor or settings changed). Emitted to every
/// window; the payload names the window it is about.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ShellLayoutChanged {
    pub layout: ShellLayout,
}

/// The yield rules changed their mind about one notch window (docs/modules/notch-shell.md).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ShellYieldChanged {
    pub label: String,
    pub state: YieldState,
}

/// A global hotkey was pressed. `action` is the id the chord is bound to (`shell.togglePanel`,
/// `todo.quickAdd`, …; the UI resolves it against the shell's actions and the module registry)
/// and `label` the notch on the monitor under the cursor, which is the one to act. Replaces
/// `ShellToggleRequested` (M1), whose only action is now `shell.togglePanel`.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyPressed {
    pub action: String,
    pub label: String,
}

/// Bridges the keyboard-shortcuts service to the shell: presses become [`HotkeyPressed`] for
/// the notch under the cursor, `shell.snooze` parks that display right here, and the *only
/// while hovering* scope is checked against the shell's last cursor sample.
pub struct HotkeyEventSink {
    app: AppHandle,
    shell: Option<Arc<ShellManager>>,
}

impl std::fmt::Debug for HotkeyEventSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HotkeyEventSink").finish_non_exhaustive()
    }
}

impl HotkeyEventSink {
    #[must_use]
    pub fn new(app: AppHandle, shell: Option<Arc<ShellManager>>) -> Self {
        Self { app, shell }
    }
}

impl HotkeySink for HotkeyEventSink {
    fn pressed(&self, action: &str, settings: &KeyboardShortcutsSettings) {
        if settings.only_while_hovering && !self.shell.as_ref().is_some_and(|s| s.hovering()) {
            return;
        }
        if action == hotkey_actions::SNOOZE {
            if let Some(shell) = &self.shell {
                let minutes = u64::from(settings.snooze_minutes);
                shell.snooze_under_cursor(&self.app, std::time::Duration::from_secs(minutes * 60));
            }
            return;
        }
        let label = self
            .shell
            .as_ref()
            .and_then(|shell| shell.hotkey_label())
            .unwrap_or_else(|| crate::shell::model::PRIMARY_LABEL.to_owned());
        if let Some(shell) = &self.shell {
            shell.wake_webviews(&self.app);
        }
        let event = HotkeyPressed {
            action: action.to_owned(),
            label,
        };
        if let Err(error) = event.emit(&self.app) {
            tracing::warn!(%error, "emit HotkeyPressed failed");
        }
    }
}

/// `tauri-plugin-global-shortcut` behind the service's registrar trait. The plugin flattens
/// its errors to strings, so the chord is parsed here first (syntax → *invalid*) and any
/// registration failure after that means the OS refused it (→ *in use*).
pub struct PluginRegistrar {
    app: AppHandle,
    service: std::sync::Weak<HotkeyService>,
}

impl std::fmt::Debug for PluginRegistrar {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PluginRegistrar").finish_non_exhaustive()
    }
}

impl PluginRegistrar {
    #[must_use]
    pub fn new(app: AppHandle, service: &Arc<HotkeyService>) -> Self {
        Self {
            app,
            service: Arc::downgrade(service),
        }
    }
}

impl HotkeyRegistrar for PluginRegistrar {
    fn register(&self, chord: &str) -> Result<(), RegisterError> {
        let shortcut: Shortcut = chord.parse().map_err(|_| RegisterError::Invalid)?;
        let service = self.service.clone();
        let chord_owned = chord.to_owned();
        self.app
            .global_shortcut()
            .on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                if let Some(service) = service.upgrade() {
                    let action = service.pressed(&chord_owned);
                    tracing::debug!(chord = chord_owned, action = ?action, "hotkey pressed");
                }
            })
            .map_err(|error| {
                tracing::warn!(%error, chord, "hotkey registration refused");
                RegisterError::InUse
            })
    }

    fn unregister(&self, chord: &str) {
        let Ok(shortcut) = chord.parse::<Shortcut>() else {
            return;
        };
        if let Err(error) = self.app.global_shortcut().unregister(shortcut) {
            tracing::warn!(%error, chord, "hotkey unregister failed");
        }
    }
}

/// A mouse button went down while the cursor was outside every shape the notch `label`
/// published. The window is click-through there, so the UI cannot observe that press itself;
/// the cursor poll reports it and the UI closes an unpinned panel (S4 in docs/09-testing-qa.md).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ShellPointerDownOutside {
    pub label: String,
}

/// One dragged item as the UI may know it (docs/modules/drop-actions.md): its name and kind,
/// never its path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DropItem {
    pub name: String,
    /// Lower-case extension without the dot, when there is one.
    pub extension: Option<String>,
    pub is_directory: bool,
}

/// A point in whole CSS pixels relative to the notch window's client area (the units the UI
/// lays its tiles out in).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DropPoint {
    pub x: i32,
    pub y: i32,
}

/// Files entered the notch window `label` in an OLE drag: the UI morphs into the tile row.
/// `session` names the drag until [`Dropped`] or [`DropLeft`].
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct DropEntered {
    pub label: String,
    pub session: u32,
    pub items: Vec<DropItem>,
    pub position: DropPoint,
}

/// The drag moved over the window; at most one per frame.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct DropMoved {
    pub label: String,
    pub session: u32,
    pub position: DropPoint,
}

/// The drag left the window without dropping; the session is gone.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct DropLeft {
    pub label: String,
    pub session: u32,
}

/// The items were released over the window at `position`. The UI resolves the tile under it
/// and calls `drop_run`, or `drop_cancel` when nothing was hit.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct Dropped {
    pub label: String,
    pub session: u32,
    pub position: DropPoint,
}

/// The drop-actions row or a job changed (docs/modules/drop-actions.md).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct DropActionsChanged {
    pub snapshot: DropActionsSnapshot,
}

/// Bridges the drop-actions service to [`DropActionsChanged`].
pub struct DropEventSink {
    app: AppHandle,
}

impl std::fmt::Debug for DropEventSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DropEventSink").finish_non_exhaustive()
    }
}

impl DropEventSink {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl DropSink for DropEventSink {
    fn changed(&self, snapshot: &DropActionsSnapshot) {
        if let Err(error) = (DropActionsChanged {
            snapshot: snapshot.clone(),
        })
        .emit(&self.app)
        {
            tracing::warn!(%error, "failed to emit DropActionsChanged");
        }
    }
}

/// Runs the share sheet on the main thread, which owns every notch window.
pub struct MainThreadWindows {
    app: AppHandle,
}

impl std::fmt::Debug for MainThreadWindows {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MainThreadWindows").finish_non_exhaustive()
    }
}

impl MainThreadWindows {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl WindowThread for MainThreadWindows {
    fn run(&self, label: &str, job: Box<dyn FnOnce(muna_platform::WindowHandle) + Send>) {
        let app = self.app.clone();
        let label = label.to_owned();
        let queued = self.app.run_on_main_thread(move || {
            let handle = app
                .get_webview_window(&label)
                .and_then(|window| crate::shell::manager::window_handle(&window))
                .unwrap_or(0);
            job(handle);
        });
        if let Err(error) = queued {
            tracing::warn!(%error, "run_on_main_thread failed; the job is dropped");
        }
    }
}

/// The media module's state changed: sessions, the active one, the pin or which artwork
/// applies (docs/modules/media.md). Pixels travel separately in [`MediaArtChanged`].
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct MediaStateChanged {
    pub state: MediaState,
}

/// The artwork for the active media session arrived or no longer applies.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct MediaArtChanged {
    pub art: Option<Artwork>,
}

/// Bridges the media service to the two events above.
pub struct MediaEventSink {
    app: AppHandle,
}

impl std::fmt::Debug for MediaEventSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MediaEventSink").finish_non_exhaustive()
    }
}

impl MediaEventSink {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl MediaSink for MediaEventSink {
    fn state_changed(&self, state: &MediaState) {
        if let Err(error) = (MediaStateChanged {
            state: state.clone(),
        })
        .emit(&self.app)
        {
            tracing::warn!(%error, "failed to emit MediaStateChanged");
        }
    }

    fn art_changed(&self, art: Option<&Artwork>) {
        if let Err(error) = (MediaArtChanged { art: art.cloned() }).emit(&self.app) {
            tracing::warn!(%error, "failed to emit MediaArtChanged");
        }
    }
}

/// The HUD module's state changed: a level, the microphone, the monitor list or whether the
/// Windows flyout is hidden (docs/modules/hud.md). The notice itself travels through
/// [`StripContentChanged`].
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct HudStateChanged {
    pub state: HudState,
}

/// Bridges the HUD service to [`HudStateChanged`].
pub struct HudEventSink {
    app: AppHandle,
}

impl std::fmt::Debug for HudEventSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HudEventSink").finish_non_exhaustive()
    }
}

impl HudEventSink {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl HudSink for HudEventSink {
    fn state_changed(&self, state: &HudState) {
        if let Err(error) = (HudStateChanged {
            state: state.clone(),
        })
        .emit(&self.app)
        {
            tracing::warn!(%error, "failed to emit HudStateChanged");
        }
    }
}

/// The pomodoro timer changed: started, paused, ran out, or a settings change resized an idle
/// phase (docs/modules/pomodoro.md). The strip content travels through
/// [`StripContentChanged`].
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroStateChanged {
    pub state: PomodoroState,
}

/// Bridges the pomodoro service to [`PomodoroStateChanged`].
pub struct PomodoroEventSink {
    app: AppHandle,
}

impl std::fmt::Debug for PomodoroEventSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PomodoroEventSink").finish_non_exhaustive()
    }
}

impl PomodoroEventSink {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl PomodoroSink for PomodoroEventSink {
    fn state_changed(&self, state: &PomodoroState) {
        if let Err(error) = (PomodoroStateChanged {
            state: state.clone(),
        })
        .emit(&self.app)
        {
            tracing::warn!(%error, "failed to emit PomodoroStateChanged");
        }
    }
}

/// The task list changed: a command ran, the trash was purged or a settings change moved the
/// retention (docs/modules/todo.md). Carries the whole snapshot; a personal list is small.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct TodoChanged {
    pub snapshot: TodoSnapshot,
}

/// Bridges the todo service to [`TodoChanged`].
pub struct TodoEventSink {
    app: AppHandle,
}

impl std::fmt::Debug for TodoEventSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TodoEventSink").finish_non_exhaustive()
    }
}

impl TodoEventSink {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl TodoSink for TodoEventSink {
    fn changed(&self, snapshot: &TodoSnapshot) {
        if let Err(error) = (TodoChanged {
            snapshot: snapshot.clone(),
        })
        .emit(&self.app)
        {
            tracing::warn!(%error, "failed to emit TodoChanged");
        }
    }
}

/// A fresh system reading (docs/modules/system-monitor.md), once a second while a panel
/// watches. Nothing is emitted while no panel is open.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct SystemMonitorChanged {
    pub snapshot: SystemMonitorSnapshot,
}

/// Bridges the system monitor service to [`SystemMonitorChanged`].
pub struct SystemMonitorEventSink {
    app: AppHandle,
}

impl std::fmt::Debug for SystemMonitorEventSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SystemMonitorEventSink")
            .finish_non_exhaustive()
    }
}

impl SystemMonitorEventSink {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl SystemMonitorSink for SystemMonitorEventSink {
    fn changed(&self, snapshot: &SystemMonitorSnapshot) {
        if let Err(error) = (SystemMonitorChanged {
            snapshot: snapshot.clone(),
        })
        .emit(&self.app)
        {
            tracing::warn!(%error, "failed to emit SystemMonitorChanged");
        }
    }
}

/// The paired devices and the radio as the module now sees them (docs/modules/bluetooth.md):
/// after a platform report, a command, or a settings change that hides or shows a device.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothChanged {
    pub snapshot: BluetoothSnapshot,
}

/// Bridges the Bluetooth service to [`BluetoothChanged`].
pub struct BluetoothEventSink {
    app: AppHandle,
}

impl std::fmt::Debug for BluetoothEventSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BluetoothEventSink").finish_non_exhaustive()
    }
}

impl BluetoothEventSink {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl BluetoothSink for BluetoothEventSink {
    fn changed(&self, snapshot: &BluetoothSnapshot) {
        if let Err(error) = (BluetoothChanged {
            snapshot: snapshot.clone(),
        })
        .emit(&self.app)
        {
            tracing::warn!(%error, "failed to emit BluetoothChanged");
        }
    }
}

/// The Action Center as the module now sees it (docs/modules/notifications.md): after a
/// listener change, a poll that found a difference, a command, a focus change or a settings
/// change that mutes or unmutes a sender.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct NotificationsChanged {
    pub snapshot: NotificationsSnapshot,
}

/// Bridges the notifications service to [`NotificationsChanged`].
pub struct NotificationsEventSink {
    app: AppHandle,
}

impl std::fmt::Debug for NotificationsEventSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NotificationsEventSink")
            .finish_non_exhaustive()
    }
}

impl NotificationsEventSink {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl NotificationsSink for NotificationsEventSink {
    fn changed(&self, snapshot: &NotificationsSnapshot) {
        if let Err(error) = (NotificationsChanged {
            snapshot: snapshot.clone(),
        })
        .emit(&self.app)
        {
            tracing::warn!(%error, "failed to emit NotificationsChanged");
        }
    }
}

/// The forecast, its place and the refresh state as the module now sees them
/// (docs/modules/weather.md): after a fetch, a position fix, a command or a settings change.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct WeatherChanged {
    pub snapshot: WeatherSnapshot,
}

/// Bridges the weather service to [`WeatherChanged`].
pub struct WeatherEventSink {
    app: AppHandle,
}

impl std::fmt::Debug for WeatherEventSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WeatherEventSink").finish_non_exhaustive()
    }
}

impl WeatherEventSink {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl WeatherSink for WeatherEventSink {
    fn changed(&self, snapshot: &WeatherSnapshot) {
        if let Err(error) = (WeatherChanged {
            snapshot: snapshot.clone(),
        })
        .emit(&self.app)
        {
            tracing::warn!(%error, "failed to emit WeatherChanged");
        }
    }
}

/// The subscribed calendars, their events and their refresh state as the module now sees
/// them (docs/modules/calendar.md): after a fetch, a command or a settings change.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct CalendarChanged {
    pub snapshot: CalendarSnapshot,
}

/// Bridges the calendar service to [`CalendarChanged`].
pub struct CalendarEventSink {
    app: AppHandle,
}

impl std::fmt::Debug for CalendarEventSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CalendarEventSink").finish_non_exhaustive()
    }
}

impl CalendarEventSink {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl CalendarSink for CalendarEventSink {
    fn changed(&self, snapshot: &CalendarSnapshot) {
        if let Err(error) = (CalendarChanged {
            snapshot: snapshot.clone(),
        })
        .emit(&self.app)
        {
            tracing::warn!(%error, "failed to emit CalendarChanged");
        }
    }
}

/// The connected account, its review queue and the poll state as the module now sees them
/// (docs/modules/code-hosting.md): after a poll, a command, a connect or a settings change.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct CodeHostingChanged {
    pub snapshot: CodeHostingSnapshot,
}

/// Bridges the code hosting service to [`CodeHostingChanged`].
pub struct CodeHostingEventSink {
    app: AppHandle,
}

impl std::fmt::Debug for CodeHostingEventSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CodeHostingEventSink")
            .finish_non_exhaustive()
    }
}

impl CodeHostingEventSink {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl CodeHostingSink for CodeHostingEventSink {
    fn changed(&self, snapshot: &CodeHostingSnapshot) {
        if let Err(error) = (CodeHostingChanged {
            snapshot: snapshot.clone(),
        })
        .emit(&self.app)
        {
            tracing::warn!(%error, "failed to emit CodeHostingChanged");
        }
    }
}

type Shared = Arc<AppState>;

// Commands take the concrete `AppHandle` (= `AppHandle<Wry>`): tauri-specta's collectors
// cannot carry a runtime generic, and Muna only ever runs on Wry.
#[tauri::command]
#[specta::specta]
fn app_info(app: AppHandle, state: State<'_, Shared>) -> AppInfo {
    AppInfo {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
        platform: state.platform.name().into(),
        profile_dir: state
            .settings_store
            .path()
            .parent()
            .map(Path::display)
            .map_or_else(String::new, |p| p.to_string()),
    }
}

#[tauri::command]
#[specta::specta]
fn get_settings(state: State<'_, Shared>) -> Settings {
    state.settings.lock().clone()
}

/// Persists the whole settings document and broadcasts `SettingsChanged`.
#[tauri::command]
#[specta::specta]
fn update_settings(
    app: AppHandle,
    state: State<'_, Shared>,
    settings: Settings,
) -> Result<Settings, IpcError> {
    if settings.version != muna_core::settings::CURRENT_VERSION {
        return Err(IpcError::new(
            "settings.invalid",
            format!(
                "settings version {} does not match {}",
                settings.version,
                muna_core::settings::CURRENT_VERSION
            ),
        ));
    }
    commit_settings(&app, &state, settings)
}

/// Saves, publishes and applies a validated document; shared by update and import.
fn commit_settings(
    app: &AppHandle,
    state: &Shared,
    settings: Settings,
) -> Result<Settings, IpcError> {
    state.settings_store.save(&settings)?;
    *state.settings.lock() = settings.clone();
    if let Err(error) = (SettingsChanged {
        settings: settings.clone(),
    })
    .emit(app)
    {
        tracing::warn!(%error, "failed to emit SettingsChanged");
    }
    state.settings_changed(app, &settings);
    Ok(settings)
}

/// Monitors as the platform sees them, for the "Multiple screens" pane. Ids match the keys of
/// `ShellSettings.monitors`.
#[tauri::command]
#[specta::specta]
fn list_monitors(state: State<'_, Shared>) -> Result<Vec<MonitorInfo>, IpcError> {
    Ok(state.platform.monitors().all()?)
}

/// Saves the current settings document where the user chooses (native dialog). Returns the
/// path, or `None` when the dialog was dismissed. Async so the blocking dialog runs off the
/// main thread.
#[tauri::command]
#[specta::specta]
async fn export_settings(
    app: AppHandle,
    state: State<'_, Shared>,
) -> Result<Option<String>, IpcError> {
    let Some(target) = app
        .dialog()
        .file()
        .set_file_name("muna-settings.json")
        .add_filter("Muna settings", &["json"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = target
        .into_path()
        .map_err(|error| IpcError::new("settings.io", error))?;
    let json = state.settings.lock().to_json()?;
    std::fs::write(&path, json).map_err(|error| IpcError::new("settings.io", error))?;
    Ok(Some(path.display().to_string()))
}

/// Replaces the settings with a file the user picks (native dialog). The file goes through the
/// same versioned parser as start-up, so older exports migrate and newer ones are refused.
/// Returns `None` when the dialog was dismissed.
#[tauri::command]
#[specta::specta]
async fn import_settings(
    app: AppHandle,
    state: State<'_, Shared>,
) -> Result<Option<Settings>, IpcError> {
    let Some(source) = app
        .dialog()
        .file()
        .add_filter("Muna settings", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = source
        .into_path()
        .map_err(|error| IpcError::new("settings.io", error))?;
    let text =
        std::fs::read_to_string(path).map_err(|error| IpcError::new("settings.io", error))?;
    let settings = Settings::from_json(&text)?;
    commit_settings(&app, &state, settings).map(Some)
}

/// Opens the profile's `logs` folder in Explorer (Diagnostics pane).
#[tauri::command]
#[specta::specta]
fn open_logs_folder(app: AppHandle, state: State<'_, Shared>) -> Result<(), IpcError> {
    let logs = state
        .settings_store
        .path()
        .parent()
        .map(|profile| profile.join("logs"))
        .ok_or_else(|| IpcError::new("settings.io", "profile directory is unknown"))?;
    std::fs::create_dir_all(&logs).map_err(|error| IpcError::new("settings.io", error))?;
    app.opener()
        .open_path(logs.display().to_string(), None::<&str>)
        .map_err(|error| IpcError::new("platform.os", error))
}

#[tauri::command]
#[specta::specta]
fn get_strip_content(state: State<'_, Shared>) -> StripContent {
    state.activities.current()
}

/// The notch window's panel is showing (or has just collapsed): while suspended, notices
/// queue instead of interrupting the panel (docs/modules/live-activities.md "Interaction with
/// the panel"). Keyed by window so a second notch window cannot un-suspend the first.
#[tauri::command]
#[specta::specta]
fn set_strip_suspended(window: WebviewWindow, state: State<'_, Shared>, suspended: bool) {
    state.activities.set_suspended(window.label(), suspended);
}

/// Every live activity, highest priority first, for the settings and debugging surfaces.
#[tauri::command]
#[specta::specta]
fn list_activities(state: State<'_, Shared>) -> Vec<ActivityState> {
    state.activities.activities()
}

#[tauri::command]
#[specta::specta]
fn get_shell_mode(state: State<'_, Shared>) -> ShellMode {
    if state.spike.is_some() {
        ShellMode::SpikeWindow
    } else {
        ShellMode::Normal
    }
}

fn shell(state: &Shared) -> Result<&Arc<ShellManager>, IpcError> {
    state
        .shell
        .as_ref()
        .ok_or_else(|| IpcError::new("shell.unavailable", "the notch shell is not running"))
}

/// The UI has painted its first frame; the shell may move the window into place.
#[tauri::command]
#[specta::specta]
fn shell_ready(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Shared>,
) -> Result<(), IpcError> {
    if let Some(spike) = &state.spike {
        spike.window_ready(window.label());
        return Ok(());
    }
    shell(&state)?.window_ready(&app, window.label());
    Ok(())
}

/// See [`DragSpike`]; queried by the notch window once it is up.
#[tauri::command]
#[specta::specta]
fn get_drag_spike(window: WebviewWindow) -> Option<DragSpike> {
    let paths = crate::shell::spike::drag_files()?;
    tracing::info!(
        label = window.label(),
        files = paths.len(),
        "drag spike armed"
    );
    Some(DragSpike { paths })
}

/// Starts an OLE drag of `request` out of the notch window and returns once the user has
/// dropped or cancelled (docs/modules/shelf.md "Drag out"). Call it while the primary button
/// is down and the pointer has moved past the drag threshold; the drag itself runs on the main
/// thread, which owns the window, so other commands wait until it ends. The shell ignores the
/// inbound drag events the same drag raises over the notch meanwhile. Paths never reach the
/// log.
#[tauri::command]
#[specta::specta]
async fn drag_out(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Shared>,
    request: DragOutRequest,
) -> Result<DragOutcome, IpcError> {
    let payload = request.into_payload(&state)?;
    let items = match &payload {
        DragPayload::Files(paths) => paths.len(),
        DragPayload::Text(_) => 1,
    };
    let label = window.label().to_owned();
    let requested = std::time::Instant::now();
    tracing::info!(label, items, "drag out requested");

    let platform = Arc::clone(&state.platform);
    let sessions = state.modules.drop_actions.sessions();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    MainThreadWindows::new(app).run(
        &label,
        Box::new(move |handle| {
            tracing::info!(
                wait_ms = requested.elapsed().as_millis(),
                "drag out started"
            );
            let started = std::time::Instant::now();
            let own_drag = sessions.self_drag();
            let outcome = platform.drag_source().start_drag(handle, &payload);
            drop(own_drag);
            match &outcome {
                Ok(outcome) => {
                    let (dropped, effect) = drag_outcome_fields(*outcome);
                    tracing::info!(
                        dropped,
                        effect,
                        ms = started.elapsed().as_millis(),
                        "drag out finished"
                    );
                }
                Err(error) => tracing::warn!(
                    %error,
                    ms = started.elapsed().as_millis(),
                    "drag out failed"
                ),
            }
            // The command may have been cancelled meanwhile; nothing to do then.
            let _ = sender.send(outcome);
        }),
    );
    let outcome = receiver
        .await
        .map_err(|_| IpcError::new("platform.os", "the drag never ran"))??;
    Ok(outcome)
}

/// `(dropped, effect)` for the log line the spike driver and QA read.
fn drag_outcome_fields(outcome: DragOutcome) -> (bool, &'static str) {
    match outcome {
        DragOutcome::Dropped { effect } => (
            true,
            match effect {
                DropEffect::Copy => "copy",
                DropEffect::Move => "move",
                DropEffect::Link => "link",
            },
        ),
        DragOutcome::Cancelled => (false, "none"),
    }
}

/// A warning raised by the UI (an error boundary, a suppressed native drag) that belongs in
/// the app log next to the shell's own lines. The UI sends fixed messages, never content.
#[tauri::command]
#[specta::specta]
fn ui_warn(window: WebviewWindow, message: String) {
    tracing::warn!(label = window.label(), %message, "ui");
}

/// Publishes the painted shapes so pointer events outside them pass through. The first rect
/// is the strip (the yield rules measure caption overlap against it).
#[tauri::command]
#[specta::specta]
fn publish_shape_rects(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Shared>,
    rects: Vec<ShapeRect>,
) -> Result<(), IpcError> {
    if let Some(spike) = &state.spike {
        spike.publish_shapes(window.label(), &rects);
        return Ok(());
    }
    shell(&state)?.publish_shapes(&app, window.label(), &rects);
    Ok(())
}

/// Records the frame statistics of one morph (spike log; an `info` line in the product shell so
/// the ≥ 58 fps budget can be read from the log of a hardware run).
#[tauri::command]
#[specta::specta]
fn report_morph(window: WebviewWindow, state: State<'_, Shared>, report: MorphReport) {
    if let Some(spike) = &state.spike {
        spike.record_morph(window.label(), &report);
    } else {
        tracing::info!(
            label = window.label(),
            expanded = report.expanded,
            fps = morph_fps(&report),
            frames = report.frames,
            duration_ms = report.duration_us / 1000,
            max_frame_ms = report.max_frame_us / 1000,
            dropped = report.dropped_frames,
            "morph"
        );
    }
}

/// Average frames per second of a morph, rounded; `0` for an empty report.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn morph_fps(report: &MorphReport) -> u32 {
    if report.duration_us == 0 {
        return 0;
    }
    let fps = f64::from(report.frames) * 1_000_000.0 / f64::from(report.duration_us);
    // Both inputs are non-negative and `as` saturates: an absurd report cannot panic.
    fps.round() as u32
}

/// Layout of the calling notch window; `None` until the shell has attached it (the UI then
/// waits for `ShellLayoutChanged`).
#[tauri::command]
#[specta::specta]
fn get_shell_layout(
    window: WebviewWindow,
    state: State<'_, Shared>,
) -> Result<Option<ShellLayout>, IpcError> {
    Ok(shell(&state)?.shell_layout(window.label()))
}

/// The calling notch window wants (or no longer wants) to take keyboard focus (a text field
/// gained focus while Pinned). Toggles `WS_EX_NOACTIVATE` and focuses the window.
#[tauri::command]
#[specta::specta]
fn set_notch_focusable(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Shared>,
    focusable: bool,
) -> Result<(), IpcError> {
    shell(&state)?.set_focusable(&app, window.label(), focusable);
    Ok(())
}

/// Parks the notch on one display until resumed (tray: "Pause on display").
#[tauri::command]
#[specta::specta]
fn set_display_paused(
    app: AppHandle,
    state: State<'_, Shared>,
    monitor_id: String,
    paused: bool,
) -> Result<(), IpcError> {
    shell(&state)?.set_display_paused(&app, &monitor_id, paused);
    Ok(())
}

/// Shows and focuses the settings window.
#[tauri::command]
#[specta::specta]
fn open_settings(app: AppHandle) {
    ShellManager::open_settings(&app);
}

/// The media module's state and the current artwork in one round trip (a window that just
/// opened; afterwards it follows `MediaStateChanged` and `MediaArtChanged`).
#[tauri::command]
#[specta::specta]
fn get_media_snapshot(state: State<'_, Shared>) -> MediaSnapshot {
    state.modules.media.snapshot()
}

/// Sends a transport command to `source_app_id`, or to the active session when `None`. The
/// module re-checks the session list when the app stays silent for 2 s.
#[tauri::command]
#[specta::specta]
fn media_command(
    state: State<'_, Shared>,
    source_app_id: Option<String>,
    command: MediaCommand,
) -> Result<(), IpcError> {
    media::send_with_watchdog(&state.modules.media, source_app_id.as_deref(), command)?;
    Ok(())
}

/// Pins the shown session to one app (`None` follows the scoring again) and remembers it as
/// the preferred app in `settings.modules.media`, so the choice survives a relaunch and the
/// Media pane shows the same value.
#[tauri::command]
#[specta::specta]
fn media_pin(
    app: AppHandle,
    state: State<'_, Shared>,
    source_app_id: Option<String>,
) -> Result<MediaState, IpcError> {
    let observation = state.modules.media.set_pinned(source_app_id.clone());
    media::schedule_art(&state.modules.media, &observation);
    let mut settings = state.settings.lock().clone();
    let mut media_settings = media::MediaSettings::from_document(&settings);
    if media_settings.preferred_app != source_app_id {
        media_settings.preferred_app = source_app_id;
        media_settings
            .write(&mut settings)
            .map_err(|error| IpcError::new("settings.invalid", error.to_string()))?;
        commit_settings(&app, &state, settings)?;
    }
    Ok(state.modules.media.snapshot().state)
}

/// Asks the OS for its session list again (settings "Refresh", diagnostics).
#[tauri::command]
#[specta::specta]
fn media_refresh(state: State<'_, Shared>) -> Result<(), IpcError> {
    state.modules.media.refresh()?;
    Ok(())
}

/// The HUD module's levels, monitors and flyout state (a window that just opened; afterwards
/// it follows `HudStateChanged`).
#[tauri::command]
#[specta::specta]
fn get_hud_snapshot(state: State<'_, Shared>) -> HudState {
    state.modules.hud.state()
}

/// Sets the default output level (HUD slider drag). The strip shows the result through the
/// platform's own event, so a change made elsewhere looks the same.
#[tauri::command]
#[specta::specta]
fn hud_set_volume(state: State<'_, Shared>, percent: u8) -> Result<(), IpcError> {
    state.modules.hud.set_volume(percent)?;
    Ok(())
}

/// Moves the output level by `delta` (wheel notches × `hud::VOLUME_STEP`), clamped, and
/// unmutes when turning up.
#[tauri::command]
#[specta::specta]
fn hud_nudge_volume(state: State<'_, Shared>, delta: i8) -> Result<(), IpcError> {
    state.modules.hud.nudge_volume(delta)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn hud_set_muted(state: State<'_, Shared>, muted: bool) -> Result<(), IpcError> {
    state.modules.hud.set_muted(muted)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn hud_set_mic_muted(state: State<'_, Shared>, muted: bool) -> Result<(), IpcError> {
    state.modules.hud.set_mic_muted(muted)?;
    Ok(())
}

/// Sets one monitor's brightness (`monitor_id` from the HUD state). Best effort per monitor:
/// a DDC/CI write that fails surfaces as `platform.os`.
#[tauri::command]
#[specta::specta]
fn hud_set_brightness(
    state: State<'_, Shared>,
    monitor_id: String,
    percent: u8,
) -> Result<(), IpcError> {
    state.modules.hud.set_brightness(&monitor_id, percent)?;
    Ok(())
}

/// Quits the app, releasing OS reservations first.
#[tauri::command]
#[specta::specta]
fn quit_app(app: AppHandle, state: State<'_, Shared>) {
    if let Some(shell) = &state.shell {
        shell.shutdown();
    }
    app.exit(0);
}

/// The pomodoro timer as it stands (a panel that just opened; afterwards it follows
/// `PomodoroStateChanged`). `remainingMs` is exact now; the UI counts down from it.
#[tauri::command]
#[specta::specta]
fn get_pomodoro_snapshot(state: State<'_, Shared>) -> PomodoroState {
    state.modules.pomodoro.state()
}

/// Starts, pauses, resumes, resets or skips the timer and returns the state after it. The
/// strip follows through `StripContentChanged`.
#[tauri::command]
#[specta::specta]
fn pomodoro_command(state: State<'_, Shared>, command: PomodoroCommand) -> PomodoroState {
    state.modules.pomodoro.command(command)
}

/// Every task list and task (a panel that just opened; afterwards it follows `TodoChanged`).
#[tauri::command]
#[specta::specta]
fn get_todo_snapshot(state: State<'_, Shared>) -> Result<TodoSnapshot, IpcError> {
    Ok(state.modules.todo.snapshot()?)
}

/// Adds, edits, completes, trashes, restores or reorders tasks and lists; returns the
/// snapshot after the command. The strip follows through `StripContentChanged`.
#[tauri::command]
#[specta::specta]
fn todo_command(state: State<'_, Shared>, command: TodoCommand) -> Result<TodoSnapshot, IpcError> {
    Ok(state.modules.todo.command(command)?)
}

/// The latest system reading, if the module has taken one (a panel that just opened;
/// afterwards it follows `SystemMonitorChanged`).
#[tauri::command]
#[specta::specta]
fn get_system_monitor_snapshot(state: State<'_, Shared>) -> Option<SystemMonitorSnapshot> {
    state.modules.system_monitor.snapshot()
}

/// Tells the module a panel in this window opened (`true`) or closed (`false`), which sets
/// the sampling cadence (docs/modules/system-monitor.md). Returns the latest reading so the
/// panel can draw at once.
#[tauri::command]
#[specta::specta]
fn system_monitor_watch(
    window: WebviewWindow,
    state: State<'_, Shared>,
    watching: bool,
) -> Option<SystemMonitorSnapshot> {
    state.modules.system_monitor.watch(window.label(), watching)
}

/// The paired devices and the radio as the module now sees them (a panel that just opened;
/// afterwards it follows `BluetoothChanged`).
#[tauri::command]
#[specta::specta]
fn get_bluetooth_snapshot(state: State<'_, Shared>) -> BluetoothSnapshot {
    state.modules.bluetooth.snapshot()
}

/// Connects or disconnects a device, or switches the radio, and returns the snapshot as it
/// stands afterwards. Connecting pages the device and can take seconds when it is out of
/// range, so the platform call runs on a blocking thread. A device that will not connect or
/// a radio the system refuses to switch surfaces as `platform.unsupported` /
/// `platform.accessDenied`, which the panel reports in place.
#[tauri::command]
#[specta::specta]
async fn bluetooth_command(
    state: State<'_, Shared>,
    command: BluetoothCommand,
) -> Result<BluetoothSnapshot, IpcError> {
    let service = Arc::clone(&state.modules.bluetooth);
    let snapshot = tauri::async_runtime::spawn_blocking(move || service.command(command))
        .await
        .map_err(|error| IpcError::new("platform.os", error))??;
    Ok(snapshot)
}

/// The Action Center as the module now sees it (a panel that just opened; afterwards it
/// follows `NotificationsChanged`).
#[tauri::command]
#[specta::specta]
fn get_notifications_snapshot(state: State<'_, Shared>) -> NotificationsSnapshot {
    state.modules.notifications.snapshot()
}

/// Asks for access, marks read, dismisses, clears or opens, and returns the snapshot as it
/// stands afterwards. Every listener call blocks (the consent prompt for as long as the user
/// takes), so it runs on a blocking thread. A notification that has gone or a sender Windows
/// cannot launch surfaces as `platform.notFound`, which the panel reports in place.
#[tauri::command]
#[specta::specta]
async fn notifications_command(
    state: State<'_, Shared>,
    command: NotificationsCommand,
) -> Result<NotificationsSnapshot, IpcError> {
    let service = Arc::clone(&state.modules.notifications);
    let snapshot = tauri::async_runtime::spawn_blocking(move || service.command(command))
        .await
        .map_err(|error| IpcError::new("platform.os", error))??;
    Ok(snapshot)
}

/// Opens one of the Windows Settings pages the panel points at: notification privacy (where
/// access is granted or withdrawn) or focus (Focus Assist / Do not disturb). A closed list, so
/// the webview cannot ask for an arbitrary URI.
#[tauri::command]
#[specta::specta]
fn notifications_open_settings(
    app: AppHandle,
    page: NotificationsSettingsPage,
) -> Result<(), IpcError> {
    let uri = match page {
        NotificationsSettingsPage::Privacy => "ms-settings:privacy-notifications",
        NotificationsSettingsPage::Focus => "ms-settings:quiethours",
    };
    app.opener()
        .open_url(uri, None::<&str>)
        .map_err(|error| IpcError::new("platform.os", error))
}

/// The Windows Settings pages [`notifications_open_settings`] can open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum NotificationsSettingsPage {
    Privacy,
    Focus,
}

/// The forecast and the refresh state as the module now sees them (a panel that just opened;
/// afterwards it follows `WeatherChanged`).
#[tauri::command]
#[specta::specta]
fn get_weather_snapshot(state: State<'_, Shared>) -> WeatherSnapshot {
    state.modules.weather.snapshot()
}

/// Refreshes now or asks for the position again; returns the snapshot as it stands afterwards
/// (the work itself runs in the module's loop and arrives as `WeatherChanged`).
#[tauri::command]
#[specta::specta]
fn weather_command(state: State<'_, Shared>, command: WeatherCommand) -> WeatherSnapshot {
    state.modules.weather.command(command)
}

/// Places matching a typed city name, for the settings pane. `weather.disabled` while the
/// module is off, `weather.offline` when the request never reached the provider,
/// `weather.provider` when it answered with something other than places.
#[tauri::command]
#[specta::specta]
async fn weather_search(state: State<'_, Shared>, query: String) -> Result<Vec<Place>, IpcError> {
    let service = Arc::clone(&state.modules.weather);
    Ok(service.search(query).await?)
}

/// The subscribed calendars and their events as the module now sees them (a panel that just
/// opened; afterwards it follows `CalendarChanged`).
#[tauri::command]
#[specta::specta]
fn get_calendar_snapshot(state: State<'_, Shared>) -> CalendarSnapshot {
    state.modules.calendar.snapshot()
}

/// Refreshes every enabled source now; returns the snapshot as it stands afterwards (the
/// work itself runs in the module's loop and arrives as `CalendarChanged`).
#[tauri::command]
#[specta::specta]
fn calendar_command(state: State<'_, Shared>, command: CalendarCommand) -> CalendarSnapshot {
    state.modules.calendar.command(command)
}

/// Subscribes to an ICS feed: the address goes to the credential vault, the source (name,
/// colour, host — never the address) into `settings.modules.calendar.sources`, and the
/// settings are saved and broadcast. `calendar.url.*` when the address is not a web link,
/// `calendar.vault` when the vault refused it.
#[tauri::command]
#[specta::specta]
fn calendar_add_source(
    app: AppHandle,
    state: State<'_, Shared>,
    name: String,
    url: String,
    color: Tint,
) -> Result<SourceSetting, IpcError> {
    let service = Arc::clone(&state.modules.calendar);
    let source = service.add_source(&name, &url, color)?;
    let mut settings = state.settings.lock().clone();
    let mut calendar = CalendarSettings::from_document(&settings);
    calendar.sources.push(source.clone());
    calendar
        .write(&mut settings)
        .map_err(|error| IpcError::new("settings.invalid", error))?;
    if let Err(error) = commit_settings(&app, &state, settings) {
        if let Err(vault) = service.remove_source_secret(&source.id) {
            tracing::warn!(%vault, "calendar source address could not be removed after a failed save");
        }
        return Err(error);
    }
    Ok(source)
}

/// Unsubscribes: the source leaves the settings (saved and broadcast), then its address
/// leaves the vault and its cache the store.
#[tauri::command]
#[specta::specta]
fn calendar_remove_source(
    app: AppHandle,
    state: State<'_, Shared>,
    id: String,
) -> Result<Settings, IpcError> {
    let mut settings = state.settings.lock().clone();
    let mut calendar = CalendarSettings::from_document(&settings);
    calendar.sources.retain(|source| source.id != id);
    calendar
        .write(&mut settings)
        .map_err(|error| IpcError::new("settings.invalid", error))?;
    let saved = commit_settings(&app, &state, settings)?;
    if let Err(error) = state.modules.calendar.remove_source_secret(&id) {
        tracing::warn!(%error, "calendar source address could not be removed from the vault");
    }
    Ok(saved)
}

/// Opens an event's meeting link or URL in the default browser. Only `http(s)` links the
/// module itself read from the feed are opened; `calendar.noLink` when the event has none.
#[tauri::command]
#[specta::specta]
fn calendar_open(
    app: AppHandle,
    state: State<'_, Shared>,
    event_id: String,
) -> Result<(), IpcError> {
    let Some(url) = state.modules.calendar.link_for(&event_id) else {
        return Err(IpcError::new("calendar.noLink", "the event has no link"));
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| IpcError::new("platform.os", error))
}

/// The connected account, its review queue and the poll state as the module now sees them (a
/// panel that just opened; afterwards it follows `CodeHostingChanged`).
#[tauri::command]
#[specta::specta]
fn get_code_hosting_snapshot(state: State<'_, Shared>) -> CodeHostingSnapshot {
    state.modules.code_hosting.snapshot()
}

/// Refreshes now; returns the snapshot as it stands afterwards (the work itself runs in the
/// module's loop and arrives as `CodeHostingChanged`).
#[tauri::command]
#[specta::specta]
fn code_hosting_command(
    state: State<'_, Shared>,
    command: CodeHostingCommand,
) -> CodeHostingSnapshot {
    state.modules.code_hosting.command(command)
}

/// Connects a GitHub account with a personal access token: the token is checked against the
/// host once, goes to the credential vault and is never echoed back; the queue it returned is
/// the snapshot. `codeHosting.disabled` while the module is off, `codeHosting.token.*` for a
/// blank or malformed token, `codeHosting.unauthorized` when the host refused it,
/// `codeHosting.offline` / `rateLimited` / `provider` when the check did not get an answer,
/// `codeHosting.vault` when the vault would not keep it.
#[tauri::command]
#[specta::specta]
async fn code_hosting_connect(
    state: State<'_, Shared>,
    token: String,
) -> Result<CodeHostingSnapshot, IpcError> {
    let service = Arc::clone(&state.modules.code_hosting);
    Ok(service.connect(&token).await?)
}

/// Forgets the token, the account and the cached queue.
#[tauri::command]
#[specta::specta]
fn code_hosting_disconnect(state: State<'_, Shared>) -> CodeHostingSnapshot {
    state.modules.code_hosting.disconnect()
}

/// Opens a listed pull request in the default browser. Only pages the module itself fetched
/// are opened; `codeHosting.unknown` when `id` is not in the queue.
#[tauri::command]
#[specta::specta]
fn code_hosting_open(app: AppHandle, state: State<'_, Shared>, id: String) -> Result<(), IpcError> {
    let Some(url) = state.modules.code_hosting.url_for(&id) else {
        return Err(IpcError::new(
            "codeHosting.unknown",
            "the pull request is not listed",
        ));
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| IpcError::new("platform.os", error))
}

/// Opens GitHub's *New personal access token* page, pre-filled for Muna, in the default
/// browser. A fixed address the webview cannot vary.
#[tauri::command]
#[specta::specta]
fn code_hosting_open_token_page(app: AppHandle) -> Result<(), IpcError> {
    app.opener()
        .open_url(NEW_TOKEN_URL, None::<&str>)
        .map_err(|error| IpcError::new("platform.os", error))
}

/// Every bound action with its chord and whether the OS took it (docs/modules/
/// keyboard-shortcuts.md). Actions without a chord are not listed; the UI knows the full set.
#[tauri::command]
#[specta::specta]
fn get_hotkeys(state: State<'_, Shared>) -> Vec<HotkeyBinding> {
    state.modules.keyboard_shortcuts.bindings()
}

/// Binds `action` to `chord` (`tauri-plugin-global-shortcut` syntax, e.g. `ctrl+alt+space`):
/// the OS is asked first, so a chord another app holds fails with `hotkey.inUse` and nothing
/// is saved; `hotkey.taken` names the Muna action that already has the chord; `hotkey.invalid`
/// is a chord the plugin cannot parse. On success the namespace is persisted and
/// `SettingsChanged` broadcast.
#[tauri::command]
#[specta::specta]
fn set_hotkey(
    app: AppHandle,
    state: State<'_, Shared>,
    action: String,
    chord: String,
) -> Result<Vec<HotkeyBinding>, IpcError> {
    let bindings = state.modules.keyboard_shortcuts.try_bind(&action, &chord)?;
    persist_hotkeys(&app, &state)?;
    Ok(bindings)
}

/// Removes the binding of `action`, releases the chord and persists the namespace.
#[tauri::command]
#[specta::specta]
fn clear_hotkey(
    app: AppHandle,
    state: State<'_, Shared>,
    action: String,
) -> Result<Vec<HotkeyBinding>, IpcError> {
    let bindings = state.modules.keyboard_shortcuts.unbind(&action);
    persist_hotkeys(&app, &state)?;
    Ok(bindings)
}

/// Writes the service's in-memory namespace over the document's and commits it; the
/// `apply_settings` that follows finds every registration already in place.
fn persist_hotkeys(app: &AppHandle, state: &Shared) -> Result<(), IpcError> {
    let mut settings = state.settings.lock().clone();
    state
        .modules
        .keyboard_shortcuts
        .settings()
        .write(&mut settings)
        .map_err(|error| IpcError::new("settings.invalid", error))?;
    commit_settings(app, state, settings)?;
    Ok(())
}

/// The drop-actions row and recent jobs (a window that just opened; afterwards it follows
/// `DropActionsChanged`).
#[tauri::command]
#[specta::specta]
fn get_drop_actions_snapshot(state: State<'_, Shared>) -> DropActionsSnapshot {
    state.modules.drop_actions.snapshot()
}

/// Runs `action` on the items of a dropped session and returns the finished job
/// (docs/modules/drop-actions.md). Blocks for as long as the shell's own dialogs are up, so
/// it runs on a blocking thread. `drop.unknownSession` when the drag is gone or its items
/// were never released over the window; `drop.unknownFolder` for a folder tile that was
/// removed meanwhile.
#[tauri::command]
#[specta::specta]
async fn drop_run(
    state: State<'_, Shared>,
    session: u32,
    action: DropAction,
) -> Result<DropJob, IpcError> {
    let service = Arc::clone(&state.modules.drop_actions);
    let job = tauri::async_runtime::spawn_blocking(move || service.run(session, &action))
        .await
        .map_err(|error| IpcError::new("platform.os", error))??;
    Ok(job)
}

/// The drop landed outside every tile (or the user declined the confirmation): forgets the
/// session's items. `false` when it was already gone.
#[tauri::command]
#[specta::specta]
fn drop_cancel(state: State<'_, Shared>, session: u32) -> bool {
    state.modules.drop_actions.cancel_session(session)
}

/// Stops a running zip or unzip job at its next buffer; `false` for a job that is not
/// running.
#[tauri::command]
#[specta::specta]
fn drop_cancel_job(state: State<'_, Shared>, job: u32) -> bool {
    state.modules.drop_actions.cancel_job(job)
}

/// Opens the folder picker for Settings › Drop actions ("Add folder") and returns the chosen
/// path, or `null` when the user dismissed it. Blocks while the dialog is up, so it runs on a
/// blocking thread.
#[tauri::command]
#[specta::specta]
async fn drop_pick_folder(
    state: State<'_, Shared>,
    title: String,
) -> Result<Option<String>, IpcError> {
    let service = Arc::clone(&state.modules.drop_actions);
    let folder = tauri::async_runtime::spawn_blocking(move || service.choose_folder(&title))
        .await
        .map_err(|error| IpcError::new("platform.os", error))??;
    Ok(folder.map(|path| path.to_string_lossy().into_owned()))
}

impl From<DropError> for IpcError {
    fn from(error: DropError) -> Self {
        let code = match error {
            DropError::UnknownSession | DropError::NotDropped => "drop.unknownSession",
            DropError::UnknownFolder => "drop.unknownFolder",
        };
        Self::new(code, error)
    }
}

/// The Shelf's items or settings changed (docs/modules/shelf.md).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ShelfChanged {
    pub snapshot: ShelfSnapshot,
}

/// Bridges the Shelf service to [`ShelfChanged`].
pub struct ShelfEventSink {
    app: AppHandle,
}

impl std::fmt::Debug for ShelfEventSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ShelfEventSink").finish_non_exhaustive()
    }
}

impl ShelfEventSink {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl ShelfSink for ShelfEventSink {
    fn changed(&self, snapshot: &ShelfSnapshot) {
        if let Err(error) = (ShelfChanged {
            snapshot: snapshot.clone(),
        })
        .emit(&self.app)
        {
            tracing::warn!(%error, "failed to emit ShelfChanged");
        }
    }
}

impl From<ShelfError> for IpcError {
    fn from(error: ShelfError) -> Self {
        match error {
            ShelfError::Store(error) => error.into(),
            ShelfError::Platform(error) => error.into(),
            ShelfError::UnknownItem => Self::new("shelf.unknownItem", error),
            ShelfError::EmptyText => Self::new("shelf.emptyText", error),
            ShelfError::NothingToCarry => Self::new("shelf.nothingToCarry", error),
            ShelfError::NoStorage => Self::new("shelf.noStorage", error),
        }
    }
}

/// The Shelf's items and settings (docs/modules/shelf.md). Stats every file for the missing
/// state, so it runs on a blocking thread.
#[tauri::command]
#[specta::specta]
async fn get_shelf_snapshot(state: State<'_, Shared>) -> Result<ShelfSnapshot, IpcError> {
    let service = Arc::clone(&state.modules.shelf);
    let snapshot = tauri::async_runtime::spawn_blocking(move || service.snapshot())
        .await
        .map_err(|error| IpcError::new("platform.os", error))??;
    Ok(snapshot)
}

/// Applies a Shelf command and returns the snapshot after it. *Open*, *Reveal* and *Copy*
/// reach the shell, so it runs on a blocking thread. `shelf.emptyText` for a blank snippet,
/// `shelf.unknownItem` for ids that are gone, `shelf.nothingToCarry` when none of the items
/// has a file to open, reveal or copy.
#[tauri::command]
#[specta::specta]
async fn shelf_command(
    state: State<'_, Shared>,
    command: ShelfCommand,
) -> Result<ShelfSnapshot, IpcError> {
    let service = Arc::clone(&state.modules.shelf);
    let snapshot = tauri::async_runtime::spawn_blocking(move || service.command(command))
        .await
        .map_err(|error| IpcError::new("platform.os", error))??;
    Ok(snapshot)
}

/// Explorer's thumbnail for one Shelf item as a PNG data URL, or `null` when the item is a
/// snippet or has no picture (the UI shows its extension). Cached per item after the first
/// call; the first call renders, so it runs on a blocking thread.
#[tauri::command]
#[specta::specta]
async fn shelf_thumbnail(state: State<'_, Shared>, id: String) -> Result<Option<String>, IpcError> {
    let service = Arc::clone(&state.modules.shelf);
    let url = tauri::async_runtime::spawn_blocking(move || service.thumbnail(&id))
        .await
        .map_err(|error| IpcError::new("platform.os", error))??;
    Ok(url)
}

/// A tracked window drag (docs/modules/window-snap.md) is over the notch window `label` at
/// `position`: the UI shows the zones once the cursor is in the hot zone and highlights the
/// tile under it. Only on change, at most once per cursor sample.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct SnapDragMoved {
    pub label: String,
    pub session: u32,
    pub position: DropPoint,
}

/// The tracked drag left the notch window `label`; the zones collapse.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct SnapDragLeft {
    pub label: String,
    pub session: u32,
}

/// The tracked drag ended (button released). `label` is the notch window the cursor was over
/// at that moment, if any: the UI resolves the tile under its last position and calls
/// `snap_apply`, or `snap_cancel` when nothing was hit.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct SnapDragEnded {
    pub session: u32,
    pub label: Option<String>,
}

/// Places the dragged window of `session` into `zone` on the monitor of the notch window
/// `label` (docs/modules/window-snap.md). Waits for the placement to settle, so it runs on a
/// blocking thread. `snap.unknownSession` when the drag is gone, `snap.zoneNotOffered` for a
/// zone the settings do not enable, `snap.unknownMonitor` for a label that is no longer a
/// notch window.
#[tauri::command]
#[specta::specta]
async fn snap_apply(
    state: State<'_, Shared>,
    session: u32,
    label: String,
    zone: SnapZoneRef,
) -> Result<(), IpcError> {
    let monitor = state
        .shell
        .as_ref()
        .and_then(|shell| shell.monitor_id_of(&label))
        .ok_or_else(|| IpcError::new("snap.unknownMonitor", SnapError::UnknownMonitor))?;
    let service = Arc::clone(&state.modules.window_snap);
    tauri::async_runtime::spawn_blocking(move || service.apply(session, &monitor, zone))
        .await
        .map_err(|error| IpcError::new("platform.os", error))??;
    Ok(())
}

/// The drag ended outside every zone: forgets the session. `false` when it was already gone.
#[tauri::command]
#[specta::specta]
fn snap_cancel(state: State<'_, Shared>, session: u32) -> bool {
    state.modules.window_snap.cancel(session)
}

impl From<SnapError> for IpcError {
    fn from(error: SnapError) -> Self {
        match error {
            SnapError::Platform(error) => error.into(),
            SnapError::UnknownSession => Self::new("snap.unknownSession", error),
            SnapError::ZoneNotOffered => Self::new("snap.zoneNotOffered", error),
            SnapError::UnknownMonitor => Self::new("snap.unknownMonitor", error),
        }
    }
}

/// The single source of truth for the command/event surface.
#[must_use]
// A flat registry, one line per command and event: its length is the size of the surface,
// not a sign the function does too much.
#[allow(clippy::too_many_lines)]
pub fn builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            app_info,
            get_settings,
            update_settings,
            list_monitors,
            export_settings,
            import_settings,
            open_logs_folder,
            get_strip_content,
            set_strip_suspended,
            list_activities,
            get_shell_mode,
            shell_ready,
            publish_shape_rects,
            report_morph,
            drag_out,
            get_drag_spike,
            ui_warn,
            get_shell_layout,
            set_notch_focusable,
            set_display_paused,
            open_settings,
            get_media_snapshot,
            media_command,
            media_pin,
            media_refresh,
            get_hud_snapshot,
            hud_set_volume,
            hud_nudge_volume,
            hud_set_muted,
            hud_set_mic_muted,
            hud_set_brightness,
            get_pomodoro_snapshot,
            pomodoro_command,
            get_todo_snapshot,
            todo_command,
            get_system_monitor_snapshot,
            system_monitor_watch,
            get_bluetooth_snapshot,
            bluetooth_command,
            get_weather_snapshot,
            weather_command,
            weather_search,
            get_calendar_snapshot,
            calendar_command,
            calendar_add_source,
            calendar_remove_source,
            calendar_open,
            get_code_hosting_snapshot,
            code_hosting_command,
            code_hosting_connect,
            code_hosting_disconnect,
            code_hosting_open,
            code_hosting_open_token_page,
            get_notifications_snapshot,
            notifications_command,
            notifications_open_settings,
            get_hotkeys,
            set_hotkey,
            clear_hotkey,
            get_drop_actions_snapshot,
            drop_run,
            drop_cancel,
            drop_cancel_job,
            drop_pick_folder,
            get_shelf_snapshot,
            shelf_command,
            shelf_thumbnail,
            snap_apply,
            snap_cancel,
            quit_app
        ])
        .events(collect_events![
            SettingsChanged,
            StripContentChanged,
            MorphRequested,
            ShellLayoutChanged,
            ShellYieldChanged,
            HotkeyPressed,
            ShellPointerDownOutside,
            DropEntered,
            DropMoved,
            DropLeft,
            Dropped,
            DropActionsChanged,
            MediaStateChanged,
            MediaArtChanged,
            HudStateChanged,
            PomodoroStateChanged,
            TodoChanged,
            SystemMonitorChanged,
            BluetoothChanged,
            WeatherChanged,
            CalendarChanged,
            CodeHostingChanged,
            NotificationsChanged,
            ShelfChanged,
            SnapDragMoved,
            SnapDragLeft,
            SnapDragEnded
        ])
}

/// `packages/contracts/src/bindings.ts`, resolved from this crate's location.
#[must_use]
pub fn default_bindings_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/contracts/src/bindings.ts")
        .components()
        .collect()
}

/// Writes the TypeScript bindings for the whole surface.
pub fn export_bindings(path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    builder().export(
        Typescript::default().header("/* eslint-disable */\n// @ts-nocheck"),
        path,
    )?;
    Ok(())
}
