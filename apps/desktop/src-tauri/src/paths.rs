//! Well-known locations (docs/03-architecture.md "Storage" and "Logging").

use std::path::{Path, PathBuf};

/// Publisher segment of the profile path; matches the `com.miklol.muna` identifier.
const PUBLISHER: &str = "miklol";
const APP: &str = "Muna";

/// Files that make a directory a Muna profile worth carrying over.
const PROFILE_FILES: &[&str] = &["settings.json", "muna.db"];

/// Everything the migration moves, in order. The database group goes first: the store runs in
/// WAL mode (`muna_core::store`), so after an unclean exit `muna.db-wal` holds committed
/// transactions that are not in `muna.db` yet, and a stray `-shm` next to a moved database
/// is wrong too. `settings.json` goes last because it is what the next start reads first.
const MIGRATED_FILES: &[&str] = &["muna.db", "muna.db-wal", "muna.db-shm", "settings.json"];

/// `%LOCALAPPDATA%\miklol\Muna` on Windows. Falls back to a temp directory when the variable is
/// missing (headless CI) so the app still starts.
///
/// The publisher segment keeps the profile out of `%LOCALAPPDATA%\Muna`, which is where the
/// per-user NSIS installer puts `muna.exe` itself (Tauri offers no override for that path).
/// Sharing the folder made an uninstall delete user data and, worse, put a build's own
/// binary next to a database another build had migrated further.
#[must_use]
pub fn profile_dir() -> PathBuf {
    local_app_data().join(PUBLISHER).join(APP)
}

/// Where profiles lived before the publisher segment (M0–M1). Read for migration only.
#[must_use]
pub fn legacy_profile_dir() -> PathBuf {
    local_app_data().join(APP)
}

fn local_app_data() -> PathBuf {
    std::env::var_os("LOCALAPPDATA").map_or_else(std::env::temp_dir, PathBuf::from)
}

/// Moves a legacy profile into `to` once: only when `to` has no profile files yet and the
/// legacy folder has some. The legacy folder itself is left in place because, on an installed
/// build, it is also the install directory. Returns the paths that were moved.
///
/// All or nothing: the files move in [`MIGRATED_FILES`] order and a rename that fails (the
/// database held open by an older build still running, say — this runs before the
/// single-instance guard) moves back what already moved, so the legacy profile stays whole.
/// The caller then runs the session from the legacy folder ([`choose_profile_dir`]) so the
/// new one stays empty and the next start tries again. Without both, `settings.json` in the
/// new folder would mark the profile as migrated and orphan the database.
///
/// Copies the Shelf module made under the legacy folder (`shelf/`) are not carried over:
/// the database records their absolute paths, so moving them would break every item.
pub fn migrate_legacy_profile(from: &Path, to: &Path) -> std::io::Result<Vec<PathBuf>> {
    let already = PROFILE_FILES.iter().any(|name| to.join(name).is_file());
    let has_profile = PROFILE_FILES.iter().any(|name| from.join(name).is_file());
    if already || !has_profile || from == to {
        return Ok(Vec::new());
    }
    std::fs::create_dir_all(to)?;
    let mut moved = Vec::with_capacity(MIGRATED_FILES.len() + 1);
    for name in MIGRATED_FILES {
        let source = from.join(name);
        if !source.is_file() {
            continue;
        }
        let target = to.join(name);
        if let Err(error) = std::fs::rename(&source, &target) {
            move_back(&moved, from);
            return Err(error);
        }
        moved.push(target);
    }
    // Logs travel too, but a locked or missing folder must not fail the migration.
    let logs = from.join("logs");
    if logs.is_dir() && std::fs::rename(&logs, to.join("logs")).is_ok() {
        moved.push(to.join("logs"));
    }
    Ok(moved)
}

/// Undoes a partial migration, newest move first. Best effort: a file that will not go back
/// is reported by the caller's error for the rename that failed, and the next start retries.
fn move_back(moved: &[PathBuf], from: &Path) {
    for target in moved.iter().rev() {
        if let Some(name) = target.file_name() {
            drop(std::fs::rename(target, from.join(name)));
        }
    }
}

/// The directory this session runs from, given how [`migrate_legacy_profile`] went: the new
/// profile when it succeeded (or had nothing to do), the legacy folder when it failed and
/// still holds a profile. Writing a fresh `settings.json` to the new folder after a failed
/// move would mark the profile as migrated on the next start and strand the legacy data;
/// running from the legacy folder keeps the new one empty, so the next start retries.
#[must_use]
pub fn choose_profile_dir<T>(
    result: &std::io::Result<T>,
    legacy: PathBuf,
    profile: PathBuf,
) -> PathBuf {
    let legacy_has_profile = PROFILE_FILES.iter().any(|name| legacy.join(name).is_file());
    if result.is_err() && legacy_has_profile {
        legacy
    } else {
        profile
    }
}
