//! [`SystemInfo`](crate::traits::SystemInfo) on Windows (docs/modules/support.md): the OS
//! edition and build from the same registry keys `winver` reads (through `sysinfo`), the
//! `WebView2` runtime version from the statically linked loader, the Desktop known folder, and
//! the user's regional format (docs/localization.md).

use std::path::PathBuf;

use sysinfo::System;
use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
use windows::Win32::Globalization::GetUserDefaultLocaleName;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{FOLDERID_Desktop, KF_FLAG_DEFAULT, SHGetKnownFolderPath};
use windows::core::{PCWSTR, PWSTR};

use super::{last_error, os_error};
use crate::error::{PlatformError, PlatformResult};
use crate::types::SystemDescription;

/// `HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)`: the loader's answer when no runtime is installed.
const E_FILE_NOT_FOUND: i32 = 0x8007_0002_u32.cast_signed();

/// `LOCALE_NAME_MAX_LENGTH`: the longest locale name Windows writes, NUL included.
const LOCALE_NAME_MAX_LENGTH: usize = 85;

pub(super) fn describe() -> PlatformResult<SystemDescription> {
    Ok(SystemDescription {
        os: os_name(),
        webview2: webview2_version()?,
    })
}

/// `Windows 11 Pro (build 26200)`; falls back to the pieces `sysinfo` could read.
fn os_name() -> String {
    let edition = System::long_os_version()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Windows".to_owned());
    match System::kernel_version().filter(|build| !build.is_empty()) {
        Some(build) => format!("{edition} (build {build})"),
        None => edition,
    }
}

/// The Evergreen (or fixed-version) runtime the app would load, or `None` without one.
fn webview2_version() -> PlatformResult<Option<String>> {
    let mut version = PWSTR::null();
    // SAFETY: `version` is a valid out pointer for the call's duration; on success the loader
    // hands back a `CoTaskMemAlloc`'d NUL-terminated string that is ours to read once and free.
    #[allow(unsafe_code)]
    unsafe {
        match GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &raw mut version) {
            Ok(()) => {}
            Err(error) if error.code().0 == E_FILE_NOT_FOUND => return Ok(None),
            Err(error) => {
                return Err(PlatformError::Os {
                    api: "GetAvailableCoreWebView2BrowserVersionString",
                    code: error.code().0.cast_unsigned(),
                });
            }
        }
        if version.is_null() {
            return Ok(None);
        }
        let text = version.to_string().ok();
        CoTaskMemFree(Some(version.0.cast_const().cast()));
        Ok(text.filter(|text| !text.is_empty()))
    }
}

pub(super) fn desktop_dir() -> PlatformResult<PathBuf> {
    // SAFETY: `SHGetKnownFolderPath` with a null token answers for the current user; the
    // returned string is `CoTaskMemAlloc`'d and freed here after one read.
    #[allow(unsafe_code)]
    unsafe {
        let desktop = FOLDERID_Desktop;
        let path = SHGetKnownFolderPath(&raw const desktop, KF_FLAG_DEFAULT, None)
            .map_err(|error| os_error("SHGetKnownFolderPath", &error))?;
        if path.is_null() {
            return Err(PlatformError::NotFound("desktop folder".into()));
        }
        let text = path.to_hstring().to_os_string();
        CoTaskMemFree(Some(path.0.cast_const().cast()));
        if text.is_empty() {
            return Err(PlatformError::NotFound("desktop folder".into()));
        }
        Ok(PathBuf::from(text))
    }
}

/// The user's regional format (`GetUserDefaultLocaleName`), e.g. `de-CH`; a custom locale's
/// `-x-` private-use tail is kept, since `Intl` accepts it.
pub(super) fn region_format() -> PlatformResult<String> {
    let mut buffer = [0_u16; LOCALE_NAME_MAX_LENGTH];
    // SAFETY: the buffer is `LOCALE_NAME_MAX_LENGTH` wide, the most the call ever writes; on
    // success the answer is the written length, NUL included, and 0 means failure.
    #[allow(unsafe_code)]
    let written = unsafe { GetUserDefaultLocaleName(&mut buffer) };
    let Ok(written) = usize::try_from(written) else {
        return Err(last_error("GetUserDefaultLocaleName"));
    };
    if written == 0 {
        return Err(last_error("GetUserDefaultLocaleName"));
    }
    let name = String::from_utf16_lossy(&buffer[..written.saturating_sub(1)]);
    if name.is_empty() {
        return Err(PlatformError::NotFound("regional format".into()));
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_name_starts_with_windows_and_carries_a_build() {
        let name = os_name();
        assert!(name.starts_with("Windows"), "{name}");
        assert!(name.contains("(build "), "{name}");
    }

    #[test]
    fn desktop_dir_is_an_absolute_existing_folder() {
        let dir = desktop_dir().expect("desktop folder");
        assert!(dir.is_absolute(), "{}", dir.display());
        assert!(dir.is_dir(), "{}", dir.display());
    }

    #[test]
    fn webview2_version_reads_the_installed_runtime() {
        // The desktop app cannot run without a runtime, so the developer machine has one.
        let version = webview2_version().expect("loader answers");
        let version = version.expect("a runtime is installed");
        assert!(version.split('.').count() >= 3, "{version}");
    }

    #[test]
    fn region_format_is_a_language_tag() {
        let tag = region_format().expect("regional format");
        let language = tag.split('-').next().unwrap_or_default();
        assert!(
            (2..=3).contains(&language.len()) && language.chars().all(|c| c.is_ascii_alphabetic()),
            "{tag}"
        );
    }
}
