//! What an executable says about itself (docs/modules/screen-time.md): the `FileDescription`
//! string of its version resource, which is what Task Manager shows as the app name, and the
//! shell's icon rendered through the same `IShellItemImageFactory` path as shelf thumbnails.
//!
//! Both reads touch the file, so callers use a blocking thread and cache the answer per path.
//! Paths are content and never reach a log line.

use std::path::Path;

use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows::core::{HSTRING, PCWSTR};

use super::thumbnails;
use crate::error::{PlatformError, PlatformResult};
use crate::types::AppDescription;

/// Name and icon of `executable`, either `None` when the file does not carry it.
pub(super) fn describe(executable: &Path, icon_size: u32) -> PlatformResult<AppDescription> {
    if !executable.is_file() {
        return Err(PlatformError::NotFound("executable".into()));
    }
    let icon_png = match thumbnails::thumbnail(executable, icon_size) {
        Ok(png) => Some(png),
        Err(PlatformError::NotFound(_)) => None,
        Err(error) => return Err(error),
    };
    Ok(AppDescription {
        name: file_description(executable),
        icon_png,
    })
}

/// `\StringFileInfo\<lang><codepage>\FileDescription` for the first translation the resource
/// lists, then the neutral and US-English blocks as fallbacks; `None` when the file has no
/// version resource or the string is blank.
fn file_description(executable: &Path) -> Option<String> {
    let path = HSTRING::from(executable.as_os_str());
    // SAFETY: `path` is NUL-terminated and outlives the call; the handle out-param is unused
    // (documented as always zero) so `None` is passed.
    #[allow(unsafe_code)]
    let size = unsafe { GetFileVersionInfoSizeW(PCWSTR(path.as_ptr()), None) };
    if size == 0 {
        return None;
    }
    let mut block = vec![0_u8; usize::try_from(size).ok()?];
    // SAFETY: `block` is a writable buffer of exactly the size the previous call asked for.
    #[allow(unsafe_code)]
    let loaded = unsafe {
        GetFileVersionInfoW(PCWSTR(path.as_ptr()), None, size, block.as_mut_ptr().cast())
    };
    if loaded.is_err() {
        return None;
    }

    let mut candidates: Vec<String> = translations(&block)
        .into_iter()
        .map(|(lang, codepage)| format!("{lang:04X}{codepage:04X}"))
        .collect();
    for fallback in ["040904B0", "000004B0", "040904E4", "00000000"] {
        if !candidates.iter().any(|c| c == fallback) {
            candidates.push(fallback.to_owned());
        }
    }
    candidates.into_iter().find_map(|block_id| {
        let value = query_string(
            &block,
            &format!("\\StringFileInfo\\{block_id}\\FileDescription"),
        )?;
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
}

/// `(language, code page)` pairs from `\VarFileInfo\Translation`, in resource order.
fn translations(block: &[u8]) -> Vec<(u16, u16)> {
    let Some(bytes) = query_bytes(block, "\\VarFileInfo\\Translation") else {
        return Vec::new();
    };
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|pair| {
            let lang = u16::from_le_bytes([pair[0], pair[1]]);
            let codepage = u16::from_le_bytes([pair[2], pair[3]]);
            (lang, codepage)
        })
        .collect()
}

/// A UTF-16 string value from the version block, without its terminator.
fn query_string(block: &[u8], sub_block: &str) -> Option<String> {
    let bytes = query_bytes(block, sub_block)?;
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u16::from_le_bytes(*pair))
        .take_while(|&unit| unit != 0)
        .collect();
    Some(String::from_utf16_lossy(&units))
}

/// The raw bytes `VerQueryValueW` points at for `sub_block`, bounds-checked against `block`.
fn query_bytes<'a>(block: &'a [u8], sub_block: &str) -> Option<&'a [u8]> {
    let name = HSTRING::from(sub_block);
    let mut pointer: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut len = 0_u32;
    // SAFETY: `block` is the buffer `GetFileVersionInfoW` filled and stays alive for the
    // returned slice; `pointer` and `len` are valid out-params.
    #[allow(unsafe_code)]
    let found = unsafe {
        VerQueryValueW(
            block.as_ptr().cast(),
            PCWSTR(name.as_ptr()),
            &raw mut pointer,
            &raw mut len,
        )
    }
    .as_bool();
    if !found || pointer.is_null() {
        return None;
    }
    let start = (pointer as usize).checked_sub(block.as_ptr() as usize)?;
    // String values report their length in UTF-16 units, binary values in bytes; the larger
    // interpretation is clamped to the buffer so a bad resource cannot read past it.
    let byte_len = usize::try_from(len).ok()?.checked_mul(2)?;
    let end = start.checked_add(byte_len)?.min(block.len());
    (start < end).then(|| &block[start..end])
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::describe;
    use crate::error::PlatformError;

    #[test]
    fn notepad_has_a_description_and_an_icon() {
        let notepad = Path::new(r"C:\Windows\System32\notepad.exe");
        if !notepad.is_file() {
            return;
        }
        let description = describe(notepad, 32).expect("describe notepad");
        // What `(Get-Item notepad.exe).VersionInfo.FileDescription` reports on every Windows.
        assert_eq!(description.name.as_deref(), Some("Notepad"));
        let icon = description.icon_png.expect("icon");
        assert_eq!(&icon[..8], b"\x89PNG\r\n\x1a\n", "PNG header");
    }

    #[test]
    fn a_missing_executable_is_not_found() {
        let result = describe(
            Path::new(r"C:\Windows\System32\muna-does-not-exist.exe"),
            32,
        );
        assert!(
            matches!(result, Err(PlatformError::NotFound(_))),
            "{result:?}"
        );
    }
}
