//! Package identity (ADR-0003). A process has identity when it runs from an installed MSIX or
//! an NSIS install registered with an external-location package; the identity-dependent APIs
//! (`UserNotificationListener` change events, `StartupTask`, appointments) only work then.

use windows::Win32::Foundation::{
    APPMODEL_ERROR_NO_PACKAGE, ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS,
};
use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
use windows::core::PWSTR;

use crate::error::{PlatformError, PlatformResult};

const API: &str = "GetCurrentPackageFullName";

/// The package full name (`Name_Version_Arch__PublisherId`) of the current process, or `None`
/// when it runs without package identity (plain `cargo run`, a bare NSIS install).
pub fn current_package_full_name() -> PlatformResult<Option<String>> {
    let mut length: u32 = 0;
    // SAFETY: a null buffer with length 0 is the documented way to query the required size;
    // `length` is a valid, writable u32 that outlives the call.
    #[allow(unsafe_code)]
    let status = unsafe { GetCurrentPackageFullName(&raw mut length, None) };
    match status {
        APPMODEL_ERROR_NO_PACKAGE => return Ok(None),
        ERROR_INSUFFICIENT_BUFFER | ERROR_SUCCESS => {}
        other => {
            return Err(PlatformError::Os {
                api: API,
                code: other.0,
            });
        }
    }
    let mut buffer = vec![0u16; length as usize];
    // SAFETY: `buffer` has exactly `length` UTF-16 slots, which is the size the first call
    // asked for; both pointers stay valid for the duration of the call.
    #[allow(unsafe_code)]
    let status =
        unsafe { GetCurrentPackageFullName(&raw mut length, Some(PWSTR(buffer.as_mut_ptr()))) };
    if status != ERROR_SUCCESS {
        return Err(PlatformError::Os {
            api: API,
            code: status.0,
        });
    }
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    Ok(Some(String::from_utf16_lossy(&buffer[..end])))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `cargo test` always runs unpackaged, so the deterministic answer is "no identity".
    #[test]
    fn test_binaries_have_no_package_identity() {
        assert_eq!(current_package_full_name(), Ok(None));
    }
}
