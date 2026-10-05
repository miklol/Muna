//! Well-known locations (docs/03-architecture.md "Storage" and "Logging").

use std::path::{Path, PathBuf};

/// Publisher segment of the profile path; matches the `com.miklol.muna` identifier.
const PUBLISHER: &str = "miklol";
const APP: &str = "Muna";

/// Files that make a directory a Muna profile worth carrying over.
const PROFILE_FILES: &[&str] = &["settings.json", "muna.db"];

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
pub fn migrate_legacy_profile(from: &Path, to: &Path) -> std::io::Result<Vec<PathBuf>> {
    let already = PROFILE_FILES.iter().any(|name| to.join(name).exists());
    let source: Vec<PathBuf> = PROFILE_FILES
        .iter()
        .map(|name| from.join(name))
        .filter(|path| path.is_file())
        .collect();
    if already || source.is_empty() || from == to {
        return Ok(Vec::new());
    }
    std::fs::create_dir_all(to)?;
    let mut moved = Vec::with_capacity(source.len() + 1);
    for path in source {
        let Some(name) = path.file_name() else {
            continue;
        };
        let target = to.join(name);
        std::fs::rename(&path, &target)?;
        moved.push(target);
    }
    // Logs travel too, but a locked or missing folder must not fail the migration.
    let logs = from.join("logs");
    if logs.is_dir() && std::fs::rename(&logs, to.join("logs")).is_ok() {
        moved.push(to.join("logs"));
    }
    Ok(moved)
}
