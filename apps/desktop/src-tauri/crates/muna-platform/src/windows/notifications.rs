//! The Action Center listener for the notifications module (docs/modules/notifications.md,
//! docs/04-windows-platform-apis.md "Notifications & focus", ADR-0003).
//!
//! `UserNotificationListener` answers `GetAccessStatus`, `RequestAccessAsync` and
//! `GetNotificationsAsync` for any desktop app once the user allowed it under Settings →
//! Privacy → Notifications. Only the `NotificationChanged` subscription needs package identity:
//! without it the call fails with `ERROR_NOT_FOUND` (measured in the M0 spike), which [`watch`]
//! reports as [`NotificationDelivery::Polling`] so the module asks once a second instead.
//!
//! Notification content never leaves this module through logs: the projection carries titles
//! and bodies to the caller and nothing else sees them.
//!
//! Focus state is `FocusSessionManager` (Windows 11 22H2+), read-only: `IsFocusActive` plus its
//! change event, republished as [`PlatformEvent::FocusChanged`]. Older builds answer `None`.
//!
//! The listener and the focus manager are agile, so every call runs on the caller's thread — the
//! module's blocking pool — the way the M0 probe did; only the `shell:` launch initialises a
//! COM apartment, as `ShellExecuteW` asks.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use parking_lot::Mutex;
use tokio::sync::broadcast;
use tracing::debug;
use windows::ApplicationModel::AppInfo;
use windows::Foundation::{Size, TypedEventHandler};
use windows::Storage::Streams::IRandomAccessStreamReference;
use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus,
};
use windows::UI::Notifications::{
    KnownNotificationBindings, NotificationKinds, UserNotification,
    UserNotificationChangedEventArgs,
};
use windows::UI::Shell::FocusSessionManager;
use windows::Win32::Foundation::{
    ERROR_FILE_NOT_FOUND, ERROR_NOT_FOUND, ERROR_PATH_NOT_FOUND, RPC_E_CHANGED_MODE,
};
use windows::Win32::System::Com::{
    COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoUninitialize,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::{HSTRING, IInspectable, Interface, PCWSTR, w};

use super::os_error;
use super::winrt::{join_within, read_image, universal_ticks_to_unix_ms};
use crate::error::{PlatformError, PlatformResult};
use crate::events::PlatformEvent;
use crate::types::{Notification, NotificationAccess, NotificationDelivery, Thumbnail};

/// `RequestAccessAsync` may wait on the consent prompt of a packaged build; Windows remembers
/// the answer, and the module asks again only when the user presses *Allow*.
const ACCESS_WAIT: Duration = Duration::from_secs(60);

/// `GetNotificationsAsync` answers from the local Action Center store in milliseconds; the
/// probe never saw more than a few hundred.
const LIST_WAIT: Duration = Duration::from_secs(10);

/// Sender logos are 48 px squares; anything past this is not a logo.
const MAX_LOGO_BYTES: u64 = 256 * 1024;

/// The pixel size asked of `AppDisplayInfo.GetLogo`; the panel shows logos at 36 px.
const LOGO_SIZE: Size = Size {
    Width: 48.0,
    Height: 48.0,
};

/// `ShellExecuteW` answers a pseudo-`HINSTANCE`: values past this are success.
const SHELL_EXECUTE_SUCCESS: usize = 32;

pub(super) fn access() -> PlatformResult<NotificationAccess> {
    current()?
        .GetAccessStatus()
        .map(access_of)
        .map_err(|e| os_error("UserNotificationListener.GetAccessStatus", &e))
}

pub(super) fn request_access() -> PlatformResult<NotificationAccess> {
    current()?
        .RequestAccessAsync()
        .and_then(|operation| join_within(&operation, ACCESS_WAIT))
        .map(access_of)
        .map_err(|e| os_error("UserNotificationListener.RequestAccessAsync", &e))
}

pub(super) fn remove(id: u32) -> PlatformResult<()> {
    current()?
        .RemoveNotification(id)
        .map_err(|e| os_error("UserNotificationListener.RemoveNotification", &e))
}

pub(super) fn clear() -> PlatformResult<()> {
    current()?
        .ClearNotifications()
        .map_err(|e| os_error("UserNotificationListener.ClearNotifications", &e))
}

pub(super) fn app_logo(app_id: &str) -> PlatformResult<Option<Thumbnail>> {
    let info = AppInfo::GetFromAppUserModelId(&HSTRING::from(app_id))
        .map_err(|e| os_error("AppInfo.GetFromAppUserModelId", &e))?;
    let reference: IRandomAccessStreamReference = info
        .DisplayInfo()
        .and_then(|display| display.GetLogo(LOGO_SIZE))
        .and_then(|logo| logo.cast())
        .map_err(|e| os_error("AppDisplayInfo.GetLogo", &e))?;
    read_image(&reference, MAX_LOGO_BYTES).map_err(|e| os_error("AppDisplayInfo.GetLogo", &e))
}

/// Owns the change subscriptions (dropping it removes both handlers) and the projections of
/// the toasts it has listed. A toast's sender and text never change once posted — Windows
/// gives a replacement a new id — so the one-second poll of a build without package identity
/// projects only the ids it has not seen and reads `Id` for the rest, instead of walking
/// `AppInfo`, `DisplayInfo` and the text binding of every toast every second.
#[derive(Debug)]
pub(super) struct Listener {
    events: broadcast::Sender<PlatformEvent>,
    changed: Mutex<Option<ChangedSubscription>>,
    focus: Mutex<Option<FocusSubscription>>,
    projected: Mutex<HashMap<u32, Notification>>,
}

impl Listener {
    pub(super) fn new(events: broadcast::Sender<PlatformEvent>) -> Self {
        Self {
            events,
            changed: Mutex::new(None),
            focus: Mutex::new(None),
            projected: Mutex::new(HashMap::new()),
        }
    }

    /// The Action Center's toasts, in the order Windows lists them; the ones seen before come
    /// from the cache, the rest are projected and remembered, and what has gone is forgotten.
    pub(super) fn list(&self) -> PlatformResult<Vec<Notification>> {
        let toasts = current()?
            .GetNotificationsAsync(NotificationKinds::Toast)
            .and_then(|operation| join_within(&operation, LIST_WAIT))
            .map_err(|e| os_error("UserNotificationListener.GetNotificationsAsync", &e))?;
        let mut projected = self.projected.lock();
        let mut listed = Vec::new();
        for toast in toasts {
            let Ok(id) = toast.Id() else {
                continue;
            };
            let notification = if let Some(known) = projected.get(&id) {
                known.clone()
            } else {
                let fresh = project(&toast, id);
                projected.insert(id, fresh.clone());
                fresh
            };
            listed.push(notification);
        }
        let present: HashSet<u32> = listed.iter().map(|notification| notification.id).collect();
        projected.retain(|id, _| present.contains(id));
        Ok(listed)
    }

    /// Subscribes to `NotificationChanged` (and to focus changes where Windows has them).
    /// Idempotent: a second call answers what the first found out.
    pub(super) fn watch(&self) -> PlatformResult<NotificationDelivery> {
        self.watch_focus();
        let mut changed = self.changed.lock();
        if changed.is_some() {
            return Ok(NotificationDelivery::Push);
        }
        let listener = current()?;
        let events = self.events.clone();
        let handler =
            TypedEventHandler::<UserNotificationListener, UserNotificationChangedEventArgs>::new(
                move |_, _| {
                    // No receivers only means nobody is listening yet.
                    let _ = events.send(PlatformEvent::NotificationsChanged);
                    Ok(())
                },
            );
        match listener.NotificationChanged(&handler) {
            Ok(token) => {
                *changed = Some(ChangedSubscription { listener, token });
                Ok(NotificationDelivery::Push)
            }
            // The one failure the spike measured on a build without package identity.
            Err(error) if error.code() == ERROR_NOT_FOUND.to_hresult() => {
                debug!("NotificationChanged is unavailable without package identity; polling");
                Ok(NotificationDelivery::Polling)
            }
            Err(error) => Err(os_error(
                "UserNotificationListener.NotificationChanged",
                &error,
            )),
        }
    }

    pub(super) fn focus_active(&self) -> Option<bool> {
        if let Some(subscription) = self.focus.lock().as_ref() {
            return subscription.manager.IsFocusActive().ok();
        }
        if !FocusSessionManager::IsSupported().unwrap_or(false) {
            return None;
        }
        FocusSessionManager::GetDefault()
            .and_then(|manager| manager.IsFocusActive())
            .ok()
    }

    fn watch_focus(&self) {
        let mut focus = self.focus.lock();
        if focus.is_some() || !FocusSessionManager::IsSupported().unwrap_or(false) {
            return;
        }
        let manager = match FocusSessionManager::GetDefault() {
            Ok(manager) => manager,
            Err(error) => {
                debug!(%error, "FocusSessionManager.GetDefault failed");
                return;
            }
        };
        let events = self.events.clone();
        let handler =
            TypedEventHandler::<FocusSessionManager, IInspectable>::new(move |sender, _| {
                if let Ok(manager) = sender.ok()
                    && let Ok(active) = manager.IsFocusActive()
                {
                    let _ = events.send(PlatformEvent::FocusChanged { active });
                }
                Ok(())
            });
        match manager.IsFocusActiveChanged(&handler) {
            Ok(token) => *focus = Some(FocusSubscription { manager, token }),
            Err(error) => debug!(%error, "FocusSessionManager.IsFocusActiveChanged failed"),
        }
    }
}

#[derive(Debug)]
struct ChangedSubscription {
    listener: UserNotificationListener,
    token: i64,
}

impl Drop for ChangedSubscription {
    fn drop(&mut self) {
        if let Err(error) = self.listener.RemoveNotificationChanged(self.token) {
            debug!(%error, "UserNotificationListener.RemoveNotificationChanged failed");
        }
    }
}

#[derive(Debug)]
struct FocusSubscription {
    manager: FocusSessionManager,
    token: i64,
}

impl Drop for FocusSubscription {
    fn drop(&mut self) {
        if let Err(error) = self.manager.RemoveIsFocusActiveChanged(self.token) {
            debug!(%error, "FocusSessionManager.RemoveIsFocusActiveChanged failed");
        }
    }
}

fn current() -> PlatformResult<UserNotificationListener> {
    UserNotificationListener::Current().map_err(|e| {
        // The class is missing on a Windows without the listener (Server SKUs, N editions
        // before the media pack): not an OS error the module can retry.
        if e.code() == windows::Win32::Foundation::REGDB_E_CLASSNOTREG
            || e.code() == windows::Win32::Foundation::CLASS_E_CLASSNOTAVAILABLE
        {
            PlatformError::Unsupported("notification listener")
        } else {
            os_error("UserNotificationListener.Current", &e)
        }
    })
}

fn access_of(status: UserNotificationListenerAccessStatus) -> NotificationAccess {
    match status {
        UserNotificationListenerAccessStatus::Allowed => NotificationAccess::Allowed,
        UserNotificationListenerAccessStatus::Denied => NotificationAccess::Denied,
        _ => NotificationAccess::Unspecified,
    }
}

/// One toast as the module sees it: what cannot be read (a sender without display info, a
/// toast without the `ToastGeneric` binding) reads as empty rather than dropping the toast.
fn project(toast: &UserNotification, id: u32) -> Notification {
    let created_at_ms = toast
        .CreationTime()
        .map_or(0, |time| universal_ticks_to_unix_ms(time.UniversalTime));
    let app = toast.AppInfo().ok();
    let app_id = app
        .as_ref()
        .and_then(|info| info.AppUserModelId().ok())
        .map(|value| value.to_string_lossy())
        .unwrap_or_default();
    let app_name = app
        .as_ref()
        .and_then(|info| info.DisplayInfo().ok())
        .and_then(|display| display.DisplayName().ok())
        .map(|value| value.to_string_lossy())
        .unwrap_or_default();
    let (title, body) = text_of(toast);
    Notification {
        id,
        app_id,
        app_name,
        title,
        body,
        created_at_ms,
    }
}

/// The `ToastGeneric` binding's text elements: the first is the title, the rest the body. A
/// toast without that binding (or without text) reads as empty; the grouped panel still shows
/// the sender.
fn text_of(toast: &UserNotification) -> (String, String) {
    let elements = toast
        .Notification()
        .and_then(|notification| notification.Visual())
        .and_then(|visual| visual.GetBinding(&KnownNotificationBindings::ToastGeneric()?))
        .and_then(|binding| binding.GetTextElements());
    let Ok(elements) = elements else {
        return (String::new(), String::new());
    };
    let mut lines = elements
        .into_iter()
        .filter_map(|element| element.Text().ok())
        .map(|text| text.to_string_lossy().trim().to_owned())
        .filter(|text| !text.is_empty());
    let title = lines.next().unwrap_or_default();
    let body = lines.collect::<Vec<_>>().join("\n");
    (title, body)
}

/// Brings the sender to the front through its `shell:AppsFolder` entry, the one launch path
/// that works for packaged and classic apps alike.
pub(super) fn open_app(app_id: &str) -> PlatformResult<()> {
    if !is_plausible_app_id(app_id) {
        return Err(PlatformError::NotFound(format!("app {app_id}")));
    }
    let target = HSTRING::from(format!("shell:AppsFolder\\{app_id}"));
    // SAFETY: initialising COM has no preconditions. `RPC_E_CHANGED_MODE` means the thread
    // already has an apartment of the other kind, which serves just as well; only a successful
    // call is balanced by `CoUninitialize` below.
    #[allow(unsafe_code)]
    let initialised =
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
    if initialised.is_err() && initialised != RPC_E_CHANGED_MODE {
        return Err(PlatformError::Os {
            api: "CoInitializeEx",
            code: initialised.0.cast_unsigned(),
        });
    }
    // SAFETY: every pointer is valid for the duration of the call and `ShellExecuteW` does not
    // retain any of them; the null window handle asks for no owner.
    #[allow(unsafe_code)]
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            &target,
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if initialised.is_ok() {
        // SAFETY: balances the successful `CoInitializeEx` above on the same thread.
        #[allow(unsafe_code)]
        unsafe {
            CoUninitialize();
        }
    }
    let code = result.0.addr();
    if code > SHELL_EXECUTE_SUCCESS {
        return Ok(());
    }
    // Below 33 the value is a Win32 error code, not an instance handle.
    #[allow(clippy::cast_possible_truncation)]
    let code = code as u32;
    if code == ERROR_FILE_NOT_FOUND.0 || code == ERROR_PATH_NOT_FOUND.0 {
        return Err(PlatformError::NotFound(format!("app {app_id}")));
    }
    Err(PlatformError::Os {
        api: "ShellExecuteW",
        code,
    })
}

/// An app user model id is a package family + app id or a registered shortcut id, which for
/// classic apps may be a known-folder path (`{GUID}\Vendor\App.exe`): never empty, never
/// quoted, never spanning lines, never climbing out of the folder. Anything else is not
/// launched. Defence in depth — the module only ever passes ids the listener itself reported.
fn is_plausible_app_id(app_id: &str) -> bool {
    !app_id.is_empty()
        && app_id.len() <= 512
        && !app_id.contains("..")
        && !app_id
            .chars()
            .any(|c| c == '"' || c == '/' || c.is_control())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_status_maps_the_three_answers() {
        assert_eq!(
            access_of(UserNotificationListenerAccessStatus::Allowed),
            NotificationAccess::Allowed
        );
        assert_eq!(
            access_of(UserNotificationListenerAccessStatus::Denied),
            NotificationAccess::Denied
        );
        assert_eq!(
            access_of(UserNotificationListenerAccessStatus::Unspecified),
            NotificationAccess::Unspecified
        );
    }

    #[test]
    fn app_ids_that_could_escape_the_apps_folder_are_refused() {
        assert!(is_plausible_app_id(
            "Microsoft.WindowsStore_8wekyb3d8bbwe!App"
        ));
        assert!(is_plausible_app_id("Microsoft.Office.OUTLOOK.EXE.15"));
        assert!(is_plausible_app_id(
            "{6D809377-6AF0-444B-8957-A3773F02200E}\\Zoom\\bin\\Zoom.exe"
        ));
        assert!(!is_plausible_app_id(""));
        assert!(!is_plausible_app_id("..\\..\\Windows\\System32\\cmd.exe"));
        assert!(!is_plausible_app_id("App\" /c evil"));
        assert!(!is_plausible_app_id("App/../evil"));
        assert!(!is_plausible_app_id("App\nApp"));
        assert!(!is_plausible_app_id(&"a".repeat(513)));
    }

    #[test]
    fn an_unknown_app_is_not_found_not_a_panic() {
        assert!(matches!(
            open_app("..\\evil"),
            Err(PlatformError::NotFound(_))
        ));
    }

    /// Talks to the real OS; only meaningful on the nightly lab machine.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session"
    )]
    fn access_status_answers_without_identity() {
        let (events, _) = broadcast::channel(4);
        let listener = Listener::new(events);
        // Allowed, denied or unspecified; never an error on a desktop SKU.
        access().unwrap();
        // The subscription answers push or polling depending on the build's identity.
        let _ = listener.watch().unwrap();
        // Focus state is a bool on Windows 11 22H2+ and `None` before; never a panic.
        let _ = listener.focus_active();
    }
}
