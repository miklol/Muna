//! Shell-crate tests. They are integration tests rather than unit tests because test
//! executables that link Tauri need the Common Controls v6 manifest, which `build.rs` can only
//! attach to `[[test]]` targets (see the comments there and in `Cargo.toml`).

use std::sync::Arc;

use muna_core::{Settings, SettingsError, StripContent};
use muna_lib::ipc::{IpcError, default_bindings_path, export_bindings};
use muna_lib::paths::{legacy_profile_dir, migrate_legacy_profile, profile_dir};
use muna_lib::state::AppState;
use muna_platform::FakePlatform;

#[test]
fn bindings_export_matches_committed_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("bindings.ts");
    export_bindings(&path).unwrap();
    let generated = std::fs::read_to_string(&path)
        .unwrap()
        .replace("\r\n", "\n");

    let committed = std::fs::read_to_string(default_bindings_path())
        .unwrap()
        .replace("\r\n", "\n");
    assert_eq!(
        generated, committed,
        "packages/contracts/src/bindings.ts is stale; run `pnpm -w contracts:generate`"
    );
}

#[test]
fn ipc_error_maps_settings_errors_to_stable_codes() {
    let error: IpcError = SettingsError::Newer {
        found: 2,
        supported: 1,
    }
    .into();
    assert_eq!(error.code, "settings.newer");
    assert!(error.message.contains("newer"));
}

#[test]
fn in_memory_state_starts_with_defaults_and_an_idle_strip() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::in_memory(dir.path()).unwrap();
    assert_eq!(*state.settings.lock(), Settings::default());
    assert_eq!(state.activities.current(), StripContent::Idle);
    assert_eq!(state.platform.name(), "fake");
    assert!(
        !dir.path().join("settings.json").exists(),
        "in-memory state must not write until asked"
    );
}

#[test]
fn open_creates_the_profile_and_persists_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let profile = dir.path().join("profile");
    let state = AppState::open(&profile, Arc::new(FakePlatform::new())).unwrap();
    assert_eq!(*state.settings.lock(), Settings::default());
    assert!(profile.join("muna.db").exists());
}

#[test]
fn profile_dir_sits_under_the_publisher_not_the_install_dir() {
    let dir = profile_dir();
    assert_eq!(dir.file_name().unwrap(), "Muna");
    assert_eq!(dir.parent().unwrap().file_name().unwrap(), "miklol");
    // `%LOCALAPPDATA%\Muna` is where the per-user NSIS installer puts muna.exe.
    assert_ne!(dir, legacy_profile_dir());
    assert_eq!(legacy_profile_dir().file_name().unwrap(), "Muna");
}

#[test]
fn legacy_profile_moves_once_and_leaves_the_install_dir_alone() {
    let root = tempfile::tempdir().unwrap();
    let from = root.path().join("Muna");
    let to = root.path().join("miklol").join("Muna");
    std::fs::create_dir_all(from.join("logs")).unwrap();
    std::fs::write(from.join("settings.json"), "{}").unwrap();
    std::fs::write(from.join("muna.db"), b"db").unwrap();
    std::fs::write(from.join("muna.exe"), b"bin").unwrap();

    let moved = migrate_legacy_profile(&from, &to).unwrap();
    assert_eq!(moved.len(), 3);
    assert!(to.join("settings.json").exists() && to.join("muna.db").exists());
    assert!(to.join("logs").is_dir());
    // The binary the installer put there is none of our business.
    assert!(from.join("muna.exe").exists());
    assert!(!from.join("settings.json").exists());

    // A second run finds a populated target and leaves everything alone.
    std::fs::write(from.join("settings.json"), "{\"stale\":true}").unwrap();
    assert!(migrate_legacy_profile(&from, &to).unwrap().is_empty());
    assert_eq!(
        std::fs::read_to_string(to.join("settings.json")).unwrap(),
        "{}"
    );

    // Nothing to migrate is not an error and creates nothing.
    let empty = root.path().join("nothing");
    let fresh = root.path().join("fresh");
    assert!(migrate_legacy_profile(&empty, &fresh).unwrap().is_empty());
    assert!(!fresh.exists());
}
