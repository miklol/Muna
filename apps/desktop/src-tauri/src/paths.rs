//! Well-known locations (docs/03-architecture.md "Storage" and "Logging").

use std::path::PathBuf;

/// `%LOCALAPPDATA%\Muna` on Windows. Falls back to a temp directory when the variable is
/// missing (headless CI) so the app still starts.
#[must_use]
pub fn profile_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map_or_else(std::env::temp_dir, PathBuf::from)
        .join("Muna")
}
