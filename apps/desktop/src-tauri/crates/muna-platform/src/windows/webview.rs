//! `WebView2` runtime knobs that need COM (`ICoreWebView2_*`) rather than Win32. The shell
//! obtains the controller from Tauri (`with_webview`) and hands it here; this module owns the
//! `unsafe` COM calls.

use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    ICoreWebView2_19, ICoreWebView2Controller,
};
use windows_core::Interface;

use crate::error::{PlatformError, PlatformResult};

/// `ICoreWebView2_19::MemoryUsageTargetLevel` — `Low` asks the renderer and browser processes
/// to release caches and shrink heaps; `Normal` restores default behaviour.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryUsageTarget {
    Normal,
    Low,
}

/// Sets the memory usage target of one webview. Fails with [`PlatformError::Unsupported`] on
/// runtimes older than `WebView2` 1.0.1901 (no `ICoreWebView2_19`).
pub fn set_memory_usage_target(
    controller: &ICoreWebView2Controller,
    target: MemoryUsageTarget,
) -> PlatformResult<()> {
    let level = match target {
        MemoryUsageTarget::Normal => COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        MemoryUsageTarget::Low => COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    };
    // SAFETY: `controller` is a live COM reference owned by the caller's webview for the
    // duration of the call; `CoreWebView2` and `cast` return owned references that are
    // released on drop; `SetMemoryUsageTargetLevel` only reads `level`.
    #[allow(unsafe_code)]
    unsafe {
        let core = controller
            .CoreWebView2()
            .map_err(|error| com_error("ICoreWebView2Controller::CoreWebView2", &error))?;
        let core: ICoreWebView2_19 = core
            .cast()
            .map_err(|_| PlatformError::Unsupported("ICoreWebView2_19 (MemoryUsageTargetLevel)"))?;
        core.SetMemoryUsageTargetLevel(level)
            .map_err(|error| com_error("ICoreWebView2_19::SetMemoryUsageTargetLevel", &error))
    }
}

fn com_error(api: &'static str, error: &windows_core::Error) -> PlatformError {
    PlatformError::Os {
        api,
        code: error.code().0.cast_unsigned(),
    }
}
