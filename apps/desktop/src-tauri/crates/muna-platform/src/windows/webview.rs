//! `WebView2` runtime knobs that need COM (`ICoreWebView2_*`) rather than Win32. The shell
//! obtains the controller from Tauri (`with_webview`) and hands it here; this module owns the
//! `unsafe` COM calls.

use std::sync::Arc;

use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_AUTOPLAY,
    COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ,
    COREWEBVIEW2_PERMISSION_KIND_FILE_READ_WRITE, COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION,
    COREWEBVIEW2_PERMISSION_KIND_LOCAL_FONTS, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
    COREWEBVIEW2_PERMISSION_KIND_MIDI_SYSTEM_EXCLUSIVE_MESSAGES,
    COREWEBVIEW2_PERMISSION_KIND_MULTIPLE_AUTOMATIC_DOWNLOADS,
    COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS, COREWEBVIEW2_PERMISSION_KIND_OTHER_SENSORS,
    COREWEBVIEW2_PERMISSION_KIND_WINDOW_MANAGEMENT, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    COREWEBVIEW2_PERMISSION_STATE_DENY, ICoreWebView2, ICoreWebView2_19, ICoreWebView2Controller,
    ICoreWebView2PermissionRequestedEventArgs, ICoreWebView2PermissionRequestedEventArgs3,
};
use webview2_com::{PermissionRequestedEventHandler, take_pwstr};
use webview2_core::{Interface, PWSTR};

use crate::error::{PlatformError, PlatformResult};
use crate::permissions::{PermissionDecision, PermissionPolicy, WebPermission};

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

fn com_error(api: &'static str, error: &webview2_core::Error) -> PlatformError {
    PlatformError::Os {
        api,
        code: error.code().0.cast_unsigned(),
    }
}

/// Answers every `PermissionRequested` of one webview from `policy`, without a prompt, for as
/// long as the webview lives (docs/modules/mirror.md). Decisions are never saved in the
/// profile, so a setting change takes effect on the next request.
pub fn install_permission_handler(
    controller: &ICoreWebView2Controller,
    policy: Arc<PermissionPolicy>,
) -> PlatformResult<()> {
    let handler = PermissionRequestedEventHandler::create(Box::new(move |sender, args| {
        let Some(args) = args else {
            return Ok(());
        };
        // SAFETY: `args` and `sender` are live COM references for the duration of the event
        // callback; every out-parameter is a local the runtime writes before returning, and
        // `take_pwstr` frees the strings the runtime allocated for us.
        #[allow(unsafe_code)]
        unsafe {
            decide(&policy, sender.as_ref(), &args)
        }
    }));
    // SAFETY: `controller` is a live COM reference owned by the caller's webview for the
    // duration of the call; `CoreWebView2` returns an owned reference released on drop and
    // `add_PermissionRequested` keeps its own reference to `handler`. The token is only needed
    // to remove the handler, which outlives the webview here on purpose.
    #[allow(unsafe_code)]
    unsafe {
        let core = controller
            .CoreWebView2()
            .map_err(|error| com_error("ICoreWebView2Controller::CoreWebView2", &error))?;
        let mut token = 0_i64;
        core.add_PermissionRequested(&handler, &raw mut token)
            .map_err(|error| com_error("ICoreWebView2::add_PermissionRequested", &error))
    }
}

/// One event: read the kind and the origins, decide, write the state back.
#[allow(unsafe_code)]
unsafe fn decide(
    policy: &PermissionPolicy,
    sender: Option<&ICoreWebView2>,
    args: &ICoreWebView2PermissionRequestedEventArgs,
) -> webview2_core::Result<()> {
    // SAFETY: see `install_permission_handler`; this is only ever called from the callback.
    unsafe {
        let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
        args.PermissionKind(&raw mut kind)?;
        let mut request_uri = PWSTR::null();
        args.Uri(&raw mut request_uri)?;
        let request_uri = take_pwstr(request_uri);
        let document_uri = match sender {
            Some(core) => {
                let mut source = PWSTR::null();
                core.Source(&raw mut source)?;
                take_pwstr(source)
            }
            None => String::new(),
        };
        let permission = web_permission(kind);
        let decision = policy.decide(permission, &request_uri, &document_uri);
        args.SetState(match decision {
            PermissionDecision::Allow => COREWEBVIEW2_PERMISSION_STATE_ALLOW,
            PermissionDecision::Deny => COREWEBVIEW2_PERMISSION_STATE_DENY,
        })?;
        // Runtimes before 1.0.1518 have no `SavesInProfile`; they never persisted a decision
        // made here either, so the cast failing is fine.
        if let Ok(args) = args.cast::<ICoreWebView2PermissionRequestedEventArgs3>() {
            args.SetSavesInProfile(false)?;
        }
        tracing::info!(?permission, ?decision, origin = %request_uri, "webview permission");
        Ok(())
    }
}

fn web_permission(kind: COREWEBVIEW2_PERMISSION_KIND) -> WebPermission {
    match kind {
        COREWEBVIEW2_PERMISSION_KIND_CAMERA => WebPermission::Camera,
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE => WebPermission::Microphone,
        COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION => WebPermission::Geolocation,
        COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS => WebPermission::Notifications,
        COREWEBVIEW2_PERMISSION_KIND_OTHER_SENSORS => WebPermission::OtherSensors,
        COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ => WebPermission::ClipboardRead,
        COREWEBVIEW2_PERMISSION_KIND_MULTIPLE_AUTOMATIC_DOWNLOADS => {
            WebPermission::MultipleAutomaticDownloads
        }
        COREWEBVIEW2_PERMISSION_KIND_FILE_READ_WRITE => WebPermission::FileReadWrite,
        COREWEBVIEW2_PERMISSION_KIND_AUTOPLAY => WebPermission::Autoplay,
        COREWEBVIEW2_PERMISSION_KIND_LOCAL_FONTS => WebPermission::LocalFonts,
        COREWEBVIEW2_PERMISSION_KIND_MIDI_SYSTEM_EXCLUSIVE_MESSAGES => {
            WebPermission::MidiSystemExclusiveMessages
        }
        COREWEBVIEW2_PERMISSION_KIND_WINDOW_MANAGEMENT => WebPermission::WindowManagement,
        _ => WebPermission::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_runtime_kind_maps_onto_a_web_permission() {
        assert_eq!(
            web_permission(COREWEBVIEW2_PERMISSION_KIND_CAMERA),
            WebPermission::Camera
        );
        assert_eq!(
            web_permission(COREWEBVIEW2_PERMISSION_KIND_MICROPHONE),
            WebPermission::Microphone
        );
        assert_eq!(
            web_permission(COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ),
            WebPermission::ClipboardRead
        );
        assert_eq!(
            web_permission(COREWEBVIEW2_PERMISSION_KIND(999)),
            WebPermission::Unknown
        );
    }
}
