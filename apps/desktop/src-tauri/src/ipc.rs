//! The typed IPC surface. Commands and events declared here are exported to
//! `packages/contracts/src/bindings.ts` by tauri-specta; the UI never writes `invoke('…')`
//! strings by hand. Changes must be additive or versioned (docs/03-architecture.md).

// Tauri extracts command arguments (`AppHandle`, `State`, payloads) by value.
#![allow(clippy::needless_pass_by_value)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use muna_core::{ActivityState, Artwork, Settings, SettingsError, StoreError, StripContent};
use muna_platform::{MediaCommand, MonitorInfo, PlatformError};
use serde::{Deserialize, Serialize};
use specta::Type;
use specta_typescript::Typescript;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_specta::{Builder, Event, collect_commands, collect_events};

use crate::modules::bluetooth::{BluetoothCommand, BluetoothSink, BluetoothSnapshot};
use crate::modules::hud::{HudSink, HudState};
use crate::modules::media::{self, MediaSink, MediaSnapshot, MediaState};
use crate::modules::pomodoro::{PomodoroCommand, PomodoroSink, PomodoroState};
use crate::modules::system_monitor::{SystemMonitorSink, SystemMonitorSnapshot};
use crate::modules::todo::{TodoCommand, TodoError, TodoSink, TodoSnapshot};
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

/// The global toggle hotkey was pressed; `label` is the notch on the monitor under the cursor.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ShellToggleRequested {
    pub label: String,
}

/// A mouse button went down while the cursor was outside every shape the notch `label`
/// published. The window is click-through there, so the UI cannot observe that press itself;
/// the cursor poll reports it and the UI closes an unpinned panel (S4 in docs/09-testing-qa.md).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ShellPointerDownOutside {
    pub label: String,
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

/// The single source of truth for the command/event surface.
#[must_use]
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
            quit_app
        ])
        .events(collect_events![
            SettingsChanged,
            StripContentChanged,
            MorphRequested,
            ShellLayoutChanged,
            ShellYieldChanged,
            ShellToggleRequested,
            ShellPointerDownOutside,
            MediaStateChanged,
            MediaArtChanged,
            HudStateChanged,
            PomodoroStateChanged,
            TodoChanged,
            SystemMonitorChanged,
            BluetoothChanged
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
