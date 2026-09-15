//! The typed IPC surface. Commands and events declared here are exported to
//! `packages/contracts/src/bindings.ts` by tauri-specta; the UI never writes `invoke('…')`
//! strings by hand. Changes must be additive or versioned (docs/03-architecture.md).

// Tauri extracts command arguments (`AppHandle`, `State`, payloads) by value.
#![allow(clippy::needless_pass_by_value)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use muna_core::{Settings, SettingsError, StoreError, StripContent};
use serde::{Deserialize, Serialize};
use specta::Type;
use specta_typescript::Typescript;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_specta::{Builder, Event, collect_commands, collect_events};

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
    state.settings_store.save(&settings)?;
    *state.settings.lock() = settings.clone();
    if let Err(error) = (SettingsChanged {
        settings: settings.clone(),
    })
    .emit(&app)
    {
        tracing::warn!(%error, "failed to emit SettingsChanged");
    }
    Ok(settings)
}

#[tauri::command]
#[specta::specta]
fn get_strip_content(state: State<'_, Shared>) -> StripContent {
    state.scheduler.lock().current()
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

fn spike(state: &Shared) -> Result<&Arc<crate::shell::spike::Spike>, IpcError> {
    state
        .spike
        .as_ref()
        .ok_or_else(|| IpcError::new("shell.spike_disabled", "MUNA_SPIKE=window is not set"))
}

/// The UI has painted its first frame; the shell may move the window into place.
#[tauri::command]
#[specta::specta]
fn shell_ready(window: WebviewWindow, state: State<'_, Shared>) -> Result<(), IpcError> {
    spike(&state)?.window_ready(window.label());
    Ok(())
}

/// Publishes the painted shapes so pointer events outside them pass through.
#[tauri::command]
#[specta::specta]
fn publish_shape_rects(
    window: WebviewWindow,
    state: State<'_, Shared>,
    rects: Vec<ShapeRect>,
) -> Result<(), IpcError> {
    spike(&state)?.publish_shapes(window.label(), &rects);
    Ok(())
}

/// Records the frame statistics of one morph.
#[tauri::command]
#[specta::specta]
fn report_morph(
    window: WebviewWindow,
    state: State<'_, Shared>,
    report: MorphReport,
) -> Result<(), IpcError> {
    spike(&state)?.record_morph(window.label(), &report);
    Ok(())
}

/// The single source of truth for the command/event surface.
#[must_use]
pub fn builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            app_info,
            get_settings,
            update_settings,
            get_strip_content,
            get_shell_mode,
            shell_ready,
            publish_shape_rects,
            report_morph
        ])
        .events(collect_events![
            SettingsChanged,
            StripContentChanged,
            MorphRequested
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
