//! The Windows Credential Manager for [`Secrets`](crate::traits::Secrets)
//! (docs/04-windows-platform-apis.md "Storage & identity"): generic credentials under
//! `Muna/<key>`, persisted for the user on this machine, the value as the UTF-8 blob.
//!
//! The vault is the right place for a calendar's private feed address or a token because it
//! is encrypted with the user's logon secret and never travels with `settings.json` when the
//! user exports it. The API is synchronous and fast (a local RPC to `lsass`); callers still
//! keep it off the UI thread by habit.

use windows::Win32::Foundation::{ERROR_NOT_FOUND, FILETIME, GetLastError, WIN32_ERROR};
use windows::Win32::Security::Credentials::{
    CRED_FLAGS, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredDeleteW, CredFree,
    CredReadW, CredWriteW,
};
use windows::core::{PCWSTR, PWSTR};

use crate::error::{PlatformError, PlatformResult};

/// Every entry the app writes starts with this, so a listing of the vault shows whose they are
/// and nothing outside it is ever read.
const TARGET_PREFIX: &str = "Muna/";

/// `CRED_MAX_CREDENTIAL_BLOB_SIZE` (512 × 5 bytes): the largest value the vault accepts.
const MAX_BLOB_BYTES: usize = 2560;

fn target(key: &str) -> Vec<u16> {
    format!("{TARGET_PREFIX}{key}\0").encode_utf16().collect()
}

fn os_error(api: &'static str, code: WIN32_ERROR) -> PlatformError {
    PlatformError::Os {
        api,
        code: code.to_hresult().0.cast_unsigned(),
    }
}

fn last_error(api: &'static str) -> PlatformError {
    // SAFETY: `GetLastError` has no preconditions; it reads the calling thread's last error.
    #[allow(unsafe_code)]
    let code = unsafe { GetLastError() };
    os_error(api, code)
}

pub(super) fn get(key: &str) -> PlatformResult<Option<String>> {
    let target = target(key);
    let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
    // SAFETY: `target` is a live NUL-terminated UTF-16 buffer for the duration of the call and
    // `credential` is a valid out-pointer; on success Windows allocates the record, which is
    // released with `CredFree` below and read only before that.
    #[allow(unsafe_code)]
    let read = unsafe {
        CredReadW(
            PCWSTR(target.as_ptr()),
            CRED_TYPE_GENERIC,
            None,
            &raw mut credential,
        )
    };
    if let Err(error) = read {
        return if error.code() == ERROR_NOT_FOUND.to_hresult() {
            Ok(None)
        } else {
            Err(PlatformError::Os {
                api: "CredReadW",
                code: error.code().0.cast_unsigned(),
            })
        };
    }
    if credential.is_null() {
        return Err(last_error("CredReadW"));
    }
    // SAFETY: `credential` is the non-null record `CredReadW` just returned; its blob pointer
    // and size describe memory owned by that record, copied out before `CredFree` releases it.
    #[allow(unsafe_code)]
    let value = unsafe {
        let record = &*credential;
        let bytes = if record.CredentialBlob.is_null() || record.CredentialBlobSize == 0 {
            &[][..]
        } else {
            std::slice::from_raw_parts(record.CredentialBlob, record.CredentialBlobSize as usize)
        };
        let value = String::from_utf8_lossy(bytes).into_owned();
        CredFree(credential.cast());
        value
    };
    Ok(Some(value))
}

pub(super) fn set(key: &str, value: &str) -> PlatformResult<()> {
    if value.len() > MAX_BLOB_BYTES {
        return Err(PlatformError::Unsupported(
            "secret longer than the vault allows",
        ));
    }
    let mut target = target(key);
    let mut blob = value.as_bytes().to_vec();
    let credential = CREDENTIALW {
        Flags: CRED_FLAGS::default(),
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_mut_ptr()),
        Comment: PWSTR::null(),
        LastWritten: FILETIME::default(),
        CredentialBlobSize: u32::try_from(blob.len()).unwrap_or(u32::MAX),
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: std::ptr::null_mut(),
        TargetAlias: PWSTR::null(),
        UserName: PWSTR::null(),
    };
    // SAFETY: every pointer in `credential` refers to a buffer (`target`, `blob`) that outlives
    // the call, and the sizes match those buffers; Windows copies what it needs before
    // returning.
    #[allow(unsafe_code)]
    unsafe { CredWriteW(&raw const credential, 0) }.map_err(|error| PlatformError::Os {
        api: "CredWriteW",
        code: error.code().0.cast_unsigned(),
    })
}

pub(super) fn remove(key: &str) -> PlatformResult<()> {
    let target = target(key);
    // SAFETY: `target` is a live NUL-terminated UTF-16 buffer for the duration of the call.
    #[allow(unsafe_code)]
    let deleted = unsafe { CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) };
    match deleted {
        Ok(()) => Ok(()),
        Err(error) if error.code() == ERROR_NOT_FOUND.to_hresult() => Ok(()),
        Err(error) => Err(PlatformError::Os {
            api: "CredDeleteW",
            code: error.code().0.cast_unsigned(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_are_namespaced_and_terminated() {
        let target = target("calendar:ics:abc");
        let text = String::from_utf16_lossy(&target[..target.len() - 1]);
        assert_eq!(text, "Muna/calendar:ics:abc");
        assert_eq!(target.last(), Some(&0));
    }

    #[test]
    fn a_value_past_the_vault_limit_is_refused_before_any_call() {
        let long = "x".repeat(MAX_BLOB_BYTES + 1);
        assert!(matches!(
            set("calendar:test:too-long", &long),
            Err(PlatformError::Unsupported(_))
        ));
    }

    /// Round-trips through the real vault; only meaningful on a Windows session with a user
    /// profile (the lab machine). Cleans up after itself.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session"
    )]
    fn a_secret_round_trips_and_is_gone_after_removal() {
        let key = format!("test:{}", std::process::id());
        assert_eq!(get(&key).unwrap(), None);
        set(&key, "https://example.test/private.ics").unwrap();
        assert_eq!(
            get(&key).unwrap().as_deref(),
            Some("https://example.test/private.ics")
        );
        set(&key, "second").unwrap();
        assert_eq!(get(&key).unwrap().as_deref(), Some("second"));
        remove(&key).unwrap();
        assert_eq!(get(&key).unwrap(), None);
        remove(&key).unwrap();
    }
}
