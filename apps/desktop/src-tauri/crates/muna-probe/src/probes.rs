//! The `WinRT` probes (Windows only). Each returns a [`ProbeResult`]; nothing here panics on an
//! API failure — a failure *is* a finding.

use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use muna_platform::windows::identity;
use windows::ApplicationModel::Appointments::{AppointmentManager, AppointmentStoreAccessType};
use windows::ApplicationModel::{StartupTask, StartupTaskState};
use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::TypedEventHandler;
use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus,
};
use windows::UI::Notifications::{
    NotificationKinds, ToastNotification, ToastNotificationManager,
    UserNotificationChangedEventArgs,
};
use windows::core::{HSTRING, Result as WinResult};

use crate::options::{Options, ToastSource};
use crate::report::{ProbeResult, Reporter, millis};

const TOAST_XML: &str = r#"<toast><visual><binding template="ToastGeneric"><text>Muna probe</text><text>Test toast for the M0-E3 identity spike. Safe to dismiss.</text></binding></visual></toast>"#;

pub fn run_all(options: &Options, reporter: &mut Reporter) {
    let identity = probe_identity(reporter);
    reporter.note(
        "mode",
        identity
            .as_deref()
            .unwrap_or("unpackaged (no package identity)"),
    );
    probe_listener_access(options, reporter);
    let before = probe_count("I3", "GetNotificationsAsync (before toast)", reporter);
    probe_notification_changed(options, reporter, before);
    let after = probe_count("I3", "GetNotificationsAsync (after toast)", reporter);
    if let (Some(before), Some(after)) = (before, after) {
        reporter.note(
            "toast_count_delta",
            &format!(
                "{before} -> {after} ({})",
                i64::from(after) - i64::from(before)
            ),
        );
    }
    probe_startup_task(options, reporter);
    probe_appointments(options, reporter);
}

/// I1 — package identity via `GetCurrentPackageFullName` (`muna-platform`).
fn probe_identity(reporter: &mut Reporter) -> Option<String> {
    let started = Instant::now();
    let (result, name) = match identity::current_package_full_name() {
        Ok(Some(name)) => (
            ProbeResult::new("I1", "GetCurrentPackageFullName", true, "package identity")
                .detail(name.clone()),
            Some(name),
        ),
        Ok(None) => (
            ProbeResult::new(
                "I1",
                "GetCurrentPackageFullName",
                false,
                "no package identity (APPMODEL_ERROR_NO_PACKAGE)",
            ),
            None,
        ),
        Err(error) => (
            ProbeResult::new("I1", "GetCurrentPackageFullName", false, "error")
                .detail(error.to_string()),
            None,
        ),
    };
    reporter.record(&result.elapsed(started.elapsed()));
    name
}

/// I2 — `UserNotificationListener.RequestAccessAsync`; may show a consent prompt.
fn probe_listener_access(options: &Options, reporter: &mut Reporter) {
    let started = Instant::now();
    let outcome = with_timeout(options.prompt_wait, || {
        UserNotificationListener::Current()?
            .RequestAccessAsync()?
            .join()
    });
    let result = match outcome {
        None => ProbeResult::new(
            "I2",
            "UserNotificationListener.RequestAccessAsync",
            false,
            "timed out (consent prompt left unanswered?)",
        ),
        Some(Ok(status)) => ProbeResult::new(
            "I2",
            "UserNotificationListener.RequestAccessAsync",
            status == UserNotificationListenerAccessStatus::Allowed,
            access_status_name(status),
        ),
        Some(Err(error)) => ProbeResult::new(
            "I2",
            "UserNotificationListener.RequestAccessAsync",
            false,
            "error",
        )
        .detail(describe(&error)),
    };
    reporter.record(&result.elapsed(started.elapsed()));
}

/// I3 — toast count in the Action Center.
fn probe_count(id: &'static str, probe: &'static str, reporter: &mut Reporter) -> Option<u32> {
    let started = Instant::now();
    let outcome = with_timeout(Duration::from_secs(10), || {
        UserNotificationListener::Current()?
            .GetNotificationsAsync(NotificationKinds::Toast)?
            .join()?
            .Size()
    });
    let (result, count) = match outcome {
        None => (ProbeResult::new(id, probe, false, "timed out"), None),
        Some(Ok(count)) => (
            ProbeResult::new(id, probe, true, format!("{count} toast notifications")),
            Some(count),
        ),
        Some(Err(error)) => (
            ProbeResult::new(id, probe, false, "error").detail(describe(&error)),
            None,
        ),
    };
    reporter.record(&result.elapsed(started.elapsed()));
    count
}

/// I4 — `NotificationChanged` after a test toast, within `--wait-secs`. Whether or not the
/// subscription works, the toast is sent and `GetNotificationsAsync` is polled once a second
/// (ADR-0003's fallback when identity is absent) so both detection paths get a latency.
fn probe_notification_changed(options: &Options, reporter: &mut Reporter, before: Option<u32>) {
    const PROBE: &str = "NotificationChanged after test toast";
    let started = Instant::now();
    let (tx, rx) = mpsc::channel::<(Instant, i32, u32)>();
    let subscription = UserNotificationListener::Current().and_then(|listener| {
        let handler =
            TypedEventHandler::<UserNotificationListener, UserNotificationChangedEventArgs>::new(
                move |_sender, args| {
                    let args = args.ok()?;
                    let kind = args.ChangeKind().map_or(-1, |kind| kind.0);
                    let notification_id = args.UserNotificationId().unwrap_or(0);
                    // A closed receiver only means the probe stopped waiting.
                    let _ = tx.send((Instant::now(), kind, notification_id));
                    Ok(())
                },
            );
        let token = listener.NotificationChanged(&handler)?;
        Ok((listener, token))
    });
    let sent_at = Instant::now();
    let toast_sent = match send_toast(&options.toast) {
        Ok(Some(source)) => {
            reporter.note("toast_sent", &source);
            true
        }
        Ok(None) => {
            reporter.note("toast_sent", "none (--toast none); waiting for any change");
            true
        }
        Err(error) => {
            reporter.note("toast_send_error", &describe(&error));
            false
        }
    };
    let result = match &subscription {
        Err(error) => {
            ProbeResult::new("I4", PROBE, false, "subscribing failed").detail(describe(error))
        }
        Ok(_) => match rx.recv_timeout(options.wait) {
            Ok((fired_at, kind, notification_id)) => {
                let latency = fired_at.saturating_duration_since(sent_at);
                ProbeResult::new("I4", PROBE, latency <= options.wait, "fired").detail(format!(
                    "latency {} ms, change kind {kind}, notification id {notification_id}",
                    millis(latency)
                ))
            }
            Err(_) => ProbeResult::new(
                "I4",
                PROBE,
                false,
                format!("no event within {} s", options.wait.as_secs()),
            ),
        },
    };
    if let Ok((listener, token)) = &subscription
        && let Err(error) = listener.RemoveNotificationChanged(*token)
    {
        reporter.note("remove_handler_error", &describe(&error));
    }
    reporter.record(&result.elapsed(started.elapsed()));
    if toast_sent {
        probe_polling_fallback(options, reporter, before, sent_at);
    }
}

/// I4 (fallback) — how long the 1 s `GetNotificationsAsync` poll takes to see the toast.
fn probe_polling_fallback(
    options: &Options,
    reporter: &mut Reporter,
    before: Option<u32>,
    sent_at: Instant,
) {
    const PROBE: &str = "GetNotificationsAsync 1 s polling sees the toast";
    let Some(before) = before else {
        reporter.record(&ProbeResult::new(
            "I4-poll",
            PROBE,
            false,
            "skipped (no baseline count)",
        ));
        return;
    };
    let deadline = sent_at + options.wait;
    let mut polls = 0u32;
    loop {
        polls += 1;
        let count = with_timeout(Duration::from_secs(5), || {
            UserNotificationListener::Current()?
                .GetNotificationsAsync(NotificationKinds::Toast)?
                .join()?
                .Size()
        });
        match count {
            Some(Ok(count)) if count > before => {
                let latency = sent_at.elapsed();
                reporter.record(
                    &ProbeResult::new("I4-poll", PROBE, true, "seen")
                        .detail(format!(
                            "latency {} ms after {polls} poll(s), {before} -> {count}",
                            millis(latency)
                        ))
                        .elapsed(latency),
                );
                return;
            }
            Some(Err(error)) => {
                reporter.record(
                    &ProbeResult::new("I4-poll", PROBE, false, "error")
                        .detail(describe(&error))
                        .elapsed(sent_at.elapsed()),
                );
                return;
            }
            _ => {}
        }
        if Instant::now() >= deadline {
            reporter.record(
                &ProbeResult::new(
                    "I4-poll",
                    PROBE,
                    false,
                    format!("count still {before} after {polls} poll(s)"),
                )
                .elapsed(sent_at.elapsed()),
            );
            return;
        }
        thread::sleep(Duration::from_secs(1));
    }
}

fn send_toast(source: &ToastSource) -> WinResult<Option<String>> {
    let (notifier, label) = match source {
        ToastSource::Aumid(aumid) => (
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(aumid))?,
            format!("aumid {aumid}"),
        ),
        ToastSource::SelfIdentity => (
            ToastNotificationManager::CreateToastNotifier()?,
            "own identity".to_owned(),
        ),
        ToastSource::None => return Ok(None),
    };
    let xml = XmlDocument::new()?;
    xml.LoadXml(&HSTRING::from(TOAST_XML))?;
    let toast = ToastNotification::CreateToastNotification(&xml)?;
    notifier.Show(&toast)?;
    Ok(Some(label))
}

/// I5 — `StartupTask.GetAsync` and, unless disabled, an Enabled ↔ Disabled round trip.
fn probe_startup_task(options: &Options, reporter: &mut Reporter) {
    const PROBE: &str = "StartupTask.GetAsync";
    let started = Instant::now();
    let task_id = HSTRING::from(&options.startup_task_id);
    let toggle = options.toggle_startup;
    let outcome = with_timeout(options.prompt_wait, move || -> WinResult<String> {
        let task = StartupTask::GetAsync(&task_id)?.join()?;
        let initial = task.State()?;
        if !toggle {
            return Ok(format!("state {}", startup_state_name(initial)));
        }
        let steps = match initial {
            StartupTaskState::Disabled => {
                let enabled = task.RequestEnableAsync()?.join()?;
                task.Disable()?;
                let restored = task.State()?;
                format!(
                    "Disabled -> RequestEnableAsync {} -> Disable {}",
                    startup_state_name(enabled),
                    startup_state_name(restored)
                )
            }
            StartupTaskState::Enabled => {
                task.Disable()?;
                let disabled = task.State()?;
                let restored = task.RequestEnableAsync()?.join()?;
                format!(
                    "Enabled -> Disable {} -> RequestEnableAsync {}",
                    startup_state_name(disabled),
                    startup_state_name(restored)
                )
            }
            other => format!("state {} (cannot toggle)", startup_state_name(other)),
        };
        Ok(steps)
    });
    let result = match outcome {
        None => ProbeResult::new("I5", PROBE, false, "timed out"),
        Some(Ok(steps)) => ProbeResult::new("I5", PROBE, true, "available").detail(steps),
        Some(Err(error)) => ProbeResult::new("I5", PROBE, false, "error").detail(describe(&error)),
    };
    reporter.record(&result.elapsed(started.elapsed()));
}

/// I6 — `AppointmentManager.RequestStoreAsync(AllCalendarsReadOnly)`.
fn probe_appointments(options: &Options, reporter: &mut Reporter) {
    const PROBE: &str = "AppointmentManager.RequestStoreAsync";
    let started = Instant::now();
    let outcome = with_timeout(options.prompt_wait, || {
        AppointmentManager::RequestStoreAsync(AppointmentStoreAccessType::AllCalendarsReadOnly)?
            .join()
            .map(|_store| ())
    });
    let result = match outcome {
        None => ProbeResult::new(
            "I6",
            PROBE,
            false,
            "timed out (consent prompt left unanswered?)",
        ),
        Some(Ok(())) => ProbeResult::new("I6", PROBE, true, "store granted (AllCalendarsReadOnly)"),
        Some(Err(error)) => ProbeResult::new("I6", PROBE, false, "error").detail(describe(&error)),
    };
    reporter.record(&result.elapsed(started.elapsed()));
}

/// Runs `f` on a worker thread so a blocking `WinRT` call (a consent prompt nobody answers, a
/// broker that never replies) cannot hang the probe. A timed-out thread is abandoned; the
/// process exits regardless.
fn with_timeout<T, F>(timeout: Duration, f: F) -> Option<T>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        // The receiver is gone only when the caller already timed out.
        let _ = tx.send(f());
    });
    rx.recv_timeout(timeout).ok()
}

fn describe(error: &windows::core::Error) -> String {
    format!("{:#010x} {}", error.code().0, error.message().trim())
}

fn access_status_name(status: UserNotificationListenerAccessStatus) -> &'static str {
    match status {
        UserNotificationListenerAccessStatus::Allowed => "Allowed",
        UserNotificationListenerAccessStatus::Denied => "Denied",
        UserNotificationListenerAccessStatus::Unspecified => "Unspecified",
        _ => "unknown status",
    }
}

fn startup_state_name(state: StartupTaskState) -> &'static str {
    match state {
        StartupTaskState::Disabled => "Disabled",
        StartupTaskState::DisabledByUser => "DisabledByUser",
        StartupTaskState::Enabled => "Enabled",
        StartupTaskState::DisabledByPolicy => "DisabledByPolicy",
        StartupTaskState::EnabledByPolicy => "EnabledByPolicy",
        _ => "unknown state",
    }
}
