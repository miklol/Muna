//! Behaviour that relies on **undocumented** Windows internals (docs/04 ⚠️ rows). Everything
//! here is best effort: when a probe fails the feature reports itself unavailable and the app
//! keeps working with the stock Windows behaviour.
//!
//! * [`flyout`] hides the shell's volume/brightness flyout so the HUD can replace it.
//! * [`window_band`] wraps `GetWindowBand`, the export the flyout check depends on.

pub mod flyout;

use windows::Win32::Foundation::HWND;
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows::core::{BOOL, s, w};

/// `ZBID_ABOVELOCK_UX`: the z-band the shell's OSD (volume, brightness, airplane mode) lives
/// in. Observed as `18` on Windows 11 26200 and matches the public `ZBID` enumeration order.
pub const ZBID_ABOVELOCK_UX: u32 = 18;

type GetWindowBandFn = unsafe extern "system" fn(HWND, *mut u32) -> BOOL;

/// The z-band of a top-level window through the undocumented `user32!GetWindowBand`.
/// `None` when the export is missing (very old builds) or the call fails.
#[must_use]
pub fn window_band(hwnd: HWND) -> Option<u32> {
    // SAFETY: `GetModuleHandleW`/`GetProcAddress` are plain lookups on an already-loaded
    // module; the returned pointer is only called after being transmuted to the signature the
    // export has had since Windows 8 (`BOOL GetWindowBand(HWND, DWORD*)`). `band` is a valid
    // out-pointer for the duration of the call.
    #[allow(unsafe_code)]
    unsafe {
        let user32 = GetModuleHandleW(w!("user32.dll")).ok()?;
        let export = GetProcAddress(user32, s!("GetWindowBand"))?;
        let get_window_band: GetWindowBandFn = std::mem::transmute(export);
        let mut band = 0_u32;
        get_window_band(hwnd, &raw mut band)
            .as_bool()
            .then_some(band)
    }
}
