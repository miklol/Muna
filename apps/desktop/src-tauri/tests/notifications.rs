//! The `notifications` module against `FakePlatform` (docs/modules/notifications.md acceptance
//! criteria, docs/build-plan/m3-daily-modules.md E5). Integration tests because the `muna` lib
//! cannot host unit tests (Common Controls manifest on Tauri-linked tests).
//!
//! The backend loop is thin (wait, then `refresh`), so the tests drive the service the way the
//! loop does: `seed`, `observe`, `refresh`, `command`, `next_wake`.

use std::sync::Arc;
use std::time::Duration;

use muna_core::{
    Clock, FakeClock, Glyph, Hub, Leading, Settings, StripContent, StripMessage, StripSink,
    Trailing,
    activities::{NOTICE_HOLD, priority},
};
use muna_lib::modules::notifications::{
    AccessState, ID, NotificationsCommand, NotificationsService, NotificationsSettings,
    NotificationsSink, NotificationsSnapshot, POLL_INTERVAL, UNREAD_ACTIVITY_ID,
};
use muna_lib::modules::{ModuleServices, Surface, backends};
use muna_platform::{
    FakePlatform, Notification, NotificationAccess, NotificationCall, NotificationDelivery,
    Platform, PlatformError, PlatformEvent, UserNotificationState,
};
use parking_lot::Mutex;

/// 1×1 opaque PNG (`#3060c0`), the smallest real logo (bytes verified with zlib).
const PNG_BLUE: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x78, 0xDA, 0x63, 0x30, 0x48, 0x38, 0x00,
    0x00, 0x02, 0x14, 0x01, 0x51, 0x44, 0x4E, 0x7F, 0xF2, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82,
];

const TEAMS: &str = "MSTeams_8wekyb3d8bbwe!MSTeams";
const MAIL: &str = "microsoft.windowscommunicationsapps_8wekyb3d8bbwe!microsoft.windowslive.mail";

#[derive(Default)]
struct Recorder {
    snapshots: Mutex<Vec<NotificationsSnapshot>>,
    strip: Mutex<Vec<StripContent>>,
}

impl NotificationsSink for Recorder {
    fn changed(&self, snapshot: &NotificationsSnapshot) {
        self.snapshots.lock().push(snapshot.clone());
    }
}

impl StripSink for Recorder {
    fn strip_changed(&self, content: &StripContent) {
        self.strip.lock().push(content.clone());
    }
}

struct Rig {
    clock: Arc<FakeClock>,
    platform: Arc<FakePlatform>,
    hub: Arc<Hub>,
    service: Arc<NotificationsService>,
    recorder: Arc<Recorder>,
}

impl Rig {
    /// A service seeded from whatever `script` puts on the fake first.
    fn new(script: impl FnOnce(&FakePlatform)) -> Self {
        let clock = Arc::new(FakeClock::new());
        let platform = Arc::new(FakePlatform::new());
        script(&platform);
        let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
        let service = Arc::new(NotificationsService::new(
            Arc::clone(&platform) as Arc<dyn Platform>,
            Arc::clone(&hub),
        ));
        let recorder = Arc::new(Recorder::default());
        service.set_sink(Arc::clone(&recorder) as Arc<dyn NotificationsSink>);
        hub.add_sink(Arc::clone(&recorder) as Arc<dyn StripSink>);
        service.seed();
        Self {
            clock,
            platform,
            hub,
            service,
            recorder,
        }
    }

    fn apply(&self, settings: &NotificationsSettings) {
        let mut document = Settings::default();
        settings.write(&mut document).expect("settings serialise");
        self.service.apply_settings(&document);
    }

    /// What the backend loop does when a toast lands: the fake's change event wakes it, and it
    /// re-reads the list.
    fn arrive(&self, notification: Notification) -> bool {
        self.platform.push_notification(notification);
        self.service.refresh()
    }

    fn shown_notice_id(&self) -> Option<String> {
        match self.hub.current() {
            StripContent::Notice { notice } => Some(notice.id),
            _ => None,
        }
    }

    fn shown_activity_id(&self) -> Option<String> {
        match self.hub.current() {
            StripContent::Activity { activity, .. } => Some(activity.id),
            _ => None,
        }
    }

    /// Lets whatever notice is showing run out, so the activity underneath is visible again.
    fn expire_notices(&self) {
        self.clock.advance(NOTICE_HOLD + Duration::from_secs(1));
        self.hub.refresh();
        assert_eq!(self.shown_notice_id(), None, "the strip is clear again");
    }

    fn snapshots(&self) -> usize {
        self.recorder.snapshots.lock().len()
    }

    fn unread_activity(&self) -> Option<muna_core::Activity> {
        self.hub
            .activities()
            .into_iter()
            .map(|state| state.activity)
            .find(|activity| activity.id == UNREAD_ACTIVITY_ID)
    }

    fn calls_without_reads(&self) -> Vec<NotificationCall> {
        self.platform
            .notification_calls()
            .into_iter()
            .filter(|call| {
                !matches!(
                    call,
                    NotificationCall::List | NotificationCall::Watch | NotificationCall::Logo(_)
                )
            })
            .collect()
    }
}

fn toast(id: u32, app_id: &str, app_name: &str, title: &str, created_at_ms: i64) -> Notification {
    Notification {
        id,
        app_id: app_id.into(),
        app_name: app_name.into(),
        title: title.into(),
        body: format!("Body of {title}"),
        created_at_ms,
    }
}

fn group_titles(snapshot: &NotificationsSnapshot, app_id: &str) -> Vec<String> {
    snapshot
        .groups
        .iter()
        .find(|group| group.app_id == app_id)
        .map(|group| {
            group
                .notifications
                .iter()
                .map(|view| view.title.clone())
                .collect()
        })
        .unwrap_or_default()
}

// --- access states -------------------------------------------------------------------------

#[test]
fn the_seed_reads_access_lists_the_action_center_and_marks_it_read() {
    let rig = Rig::new(|fake| {
        fake.push_notification(toast(1, TEAMS, "Teams", "Stand-up in 5", 1_000));
        fake.push_notification(toast(2, MAIL, "Mail", "Invoice", 2_000));
        fake.push_notification(toast(3, TEAMS, "Teams", "Reply from Ada", 3_000));
    });
    let snapshot = rig.service.snapshot();
    assert_eq!(snapshot.access, AccessState::Allowed);
    assert_eq!(snapshot.delivery, Some(NotificationDelivery::Push));
    assert_eq!(snapshot.unread, 0, "nothing already there is unread");
    assert_eq!(
        snapshot
            .groups
            .iter()
            .map(|group| group.app_name.as_str())
            .collect::<Vec<_>>(),
        ["Teams", "Mail"],
        "senders by their latest notification, newest first"
    );
    assert_eq!(
        group_titles(&snapshot, TEAMS),
        ["Reply from Ada", "Stand-up in 5"],
        "newest first within a sender"
    );
    assert!(
        snapshot.groups[0]
            .notifications
            .iter()
            .all(|view| !view.unread)
    );
    assert!(snapshot.groups[0].logo.is_none(), "no logo scripted");
    assert_eq!(rig.unread_activity(), None);
    assert_eq!(
        rig.shown_notice_id(),
        None,
        "nothing already true is announced"
    );
    assert_eq!(rig.snapshots(), 1, "the seed reaches the sink once");
    assert_eq!(
        rig.platform.notification_calls(),
        [
            NotificationCall::List,
            NotificationCall::Watch,
            NotificationCall::Logo(TEAMS.into()),
            NotificationCall::Logo(MAIL.into()),
        ]
    );
}

#[test]
fn before_the_seed_nothing_is_known() {
    let clock = Arc::new(FakeClock::new());
    let platform = Arc::new(FakePlatform::new());
    let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
    let service = NotificationsService::new(Arc::clone(&platform) as Arc<dyn Platform>, hub);
    let before = service.snapshot();
    assert_eq!(before.access, AccessState::Unavailable);
    assert_eq!(before.delivery, None);
    assert!(before.groups.is_empty());
    assert_eq!(service.next_wake(), None);
}

#[test]
fn without_consent_the_module_neither_lists_nor_polls() {
    let rig = Rig::new(|fake| {
        fake.set_notification_access(NotificationAccess::Unspecified);
        fake.push_notification(toast(1, TEAMS, "Teams", "Hidden", 1_000));
    });
    let snapshot = rig.service.snapshot();
    assert_eq!(snapshot.access, AccessState::Unspecified);
    assert_eq!(snapshot.delivery, None);
    assert!(snapshot.groups.is_empty());
    assert_eq!(rig.platform.notification_calls(), [], "no list, no watch");
    assert_eq!(rig.service.next_wake(), None, "no polling without consent");
    assert!(
        !rig.service.refresh(),
        "a refresh without access is a no-op"
    );
    assert_eq!(rig.platform.notification_calls(), []);
}

#[test]
fn denied_access_is_a_single_explanatory_state_without_polling() {
    let rig = Rig::new(|fake| {
        fake.set_notification_access(NotificationAccess::Denied);
        fake.set_notification_delivery(NotificationDelivery::Polling);
    });
    assert_eq!(rig.service.snapshot().access, AccessState::Denied);
    assert_eq!(rig.service.next_wake(), None);
    assert_eq!(rig.platform.notification_calls(), []);
}

#[test]
fn a_windows_without_the_listener_reads_as_unavailable() {
    let rig = Rig::new(|fake| fake.set_notifications_unavailable(true));
    assert_eq!(rig.service.snapshot().access, AccessState::Unavailable);
    assert_eq!(rig.service.next_wake(), None);
}

#[test]
fn request_access_shows_the_prompt_and_adopts_the_list_on_allow() {
    let rig = Rig::new(|fake| {
        fake.set_notification_access(NotificationAccess::Unspecified);
        fake.push_notification(toast(1, TEAMS, "Teams", "Already there", 1_000));
    });
    // The user says yes in the prompt.
    rig.platform
        .set_notification_access(NotificationAccess::Allowed);
    let snapshot = rig
        .service
        .command(NotificationsCommand::RequestAccess)
        .expect("request access");
    assert_eq!(snapshot.access, AccessState::Allowed);
    assert_eq!(snapshot.delivery, Some(NotificationDelivery::Push));
    assert_eq!(group_titles(&snapshot, TEAMS), ["Already there"]);
    assert_eq!(
        snapshot.unread, 0,
        "what was there when access came is read"
    );
    assert_eq!(rig.calls_without_reads(), [NotificationCall::RequestAccess]);
    assert_eq!(rig.snapshots(), 2);
}

#[test]
fn request_access_that_is_refused_stays_denied() {
    let rig = Rig::new(|fake| {
        fake.set_notification_access(NotificationAccess::Unspecified);
    });
    rig.platform
        .set_notification_access(NotificationAccess::Denied);
    let snapshot = rig
        .service
        .command(NotificationsCommand::RequestAccess)
        .expect("request access");
    assert_eq!(snapshot.access, AccessState::Denied);
    assert_eq!(snapshot.delivery, None);
    assert_eq!(rig.service.next_wake(), None);
}

#[test]
fn access_withdrawn_in_settings_is_noticed_on_the_next_refresh() {
    let rig = Rig::new(|fake| {
        fake.push_notification(toast(1, TEAMS, "Teams", "Before", 1_000));
    });
    // The user flips the switch off: the list fails and access reads `Denied`.
    rig.platform
        .set_notification_access(NotificationAccess::Denied);
    assert!(rig.service.refresh());
    let snapshot = rig.service.snapshot();
    assert_eq!(snapshot.access, AccessState::Denied);
    assert!(snapshot.groups.is_empty(), "content is dropped with access");
    assert_eq!(rig.service.next_wake(), None);
}

// --- delivery ------------------------------------------------------------------------------

#[test]
fn a_build_with_identity_waits_for_events_and_a_build_without_polls_every_second() {
    let push = Rig::new(|_| {});
    assert_eq!(
        push.service.snapshot().delivery,
        Some(NotificationDelivery::Push)
    );
    assert_eq!(
        push.service.next_wake(),
        None,
        "push builds only wake on events"
    );

    let polling = Rig::new(|fake| fake.set_notification_delivery(NotificationDelivery::Polling));
    assert_eq!(
        polling.service.snapshot().delivery,
        Some(NotificationDelivery::Polling)
    );
    assert_eq!(polling.service.next_wake(), Some(POLL_INTERVAL));
    assert_eq!(POLL_INTERVAL, Duration::from_secs(1));
}

#[test]
fn polling_pauses_while_the_session_is_locked() {
    let rig = Rig::new(|fake| fake.set_notification_delivery(NotificationDelivery::Polling));
    assert!(
        !rig.service
            .observe(&PlatformEvent::SessionLockChanged { locked: true })
    );
    assert_eq!(rig.service.next_wake(), None);
    rig.service
        .observe(&PlatformEvent::SessionLockChanged { locked: false });
    assert_eq!(rig.service.next_wake(), Some(POLL_INTERVAL));
}

#[test]
fn a_poll_that_finds_nothing_new_changes_nothing() {
    let rig = Rig::new(|fake| {
        fake.set_notification_delivery(NotificationDelivery::Polling);
        fake.push_notification(toast(1, TEAMS, "Teams", "Same", 1_000));
    });
    assert!(!rig.service.refresh());
    assert!(!rig.service.refresh());
    assert_eq!(rig.snapshots(), 1, "an unchanged list reaches nobody");
}

#[test]
fn the_change_event_carries_no_content_and_the_focus_event_is_folded_in() {
    let rig = Rig::new(|_| {});
    // The loop wakes on `NotificationsChanged` and refreshes; `observe` itself ignores it.
    assert!(!rig.service.observe(&PlatformEvent::NotificationsChanged));
    assert!(
        rig.service
            .observe(&PlatformEvent::FocusChanged { active: true })
    );
    assert_eq!(rig.service.snapshot().focus_active, Some(true));
    assert!(
        !rig.service
            .observe(&PlatformEvent::FocusChanged { active: true })
    );
    assert_eq!(rig.snapshots(), 2);
}

// --- arrivals ------------------------------------------------------------------------------

#[test]
fn an_arriving_toast_is_listed_unread_announced_and_counted() {
    let rig = Rig::new(|fake| {
        fake.push_notification(toast(1, TEAMS, "Teams", "Old", 1_000));
    });
    assert!(rig.arrive(toast(2, TEAMS, "Teams", "New message", 2_000)));
    let snapshot = rig.service.snapshot();
    assert_eq!(snapshot.unread, 1);
    assert_eq!(group_titles(&snapshot, TEAMS), ["New message", "Old"]);
    assert!(snapshot.groups[0].notifications[0].unread);
    assert!(!snapshot.groups[0].notifications[1].unread);

    assert_eq!(
        rig.shown_notice_id().as_deref(),
        Some("notifications:arrived:2")
    );
    let StripContent::Notice { notice } = rig.hub.current() else {
        panic!("a notice is showing");
    };
    assert_eq!(notice.module, ID);
    assert_eq!(notice.priority, priority::UNREAD);
    assert_eq!(
        notice.leading,
        Some(Leading::Icon {
            glyph: Glyph::Bell,
            tint: None
        }),
        "no logo: the bell"
    );
    assert_eq!(
        notice.wide,
        Some(StripMessage::Notification {
            app: "Teams".into(),
            title: "New message".into(),
        })
    );

    rig.expire_notices();
    assert_eq!(rig.shown_activity_id().as_deref(), Some(UNREAD_ACTIVITY_ID));
    let activity = rig.unread_activity().expect("unread glance");
    assert_eq!(activity.priority, priority::UNREAD);
    assert_eq!(activity.trailing, Some(Trailing::Count { value: 1 }));
    assert_eq!(
        activity.wide,
        Some(StripMessage::Notification {
            app: "Teams".into(),
            title: "New message".into(),
        })
    );
}

#[test]
fn the_glance_follows_the_latest_unread_and_the_count() {
    let rig = Rig::new(|_| {});
    rig.arrive(toast(1, TEAMS, "Teams", "First", 1_000));
    rig.arrive(toast(2, MAIL, "Mail", "Second", 2_000));
    let activity = rig.unread_activity().expect("unread glance");
    assert_eq!(activity.trailing, Some(Trailing::Count { value: 2 }));
    assert_eq!(
        activity.wide,
        Some(StripMessage::Notification {
            app: "Mail".into(),
            title: "Second".into(),
        })
    );
    // The latest leaves on its own (dismissed in Windows): the glance falls back to the other.
    rig.platform.expire_notification(2);
    assert!(rig.service.refresh());
    let activity = rig.unread_activity().expect("unread glance");
    assert_eq!(activity.trailing, Some(Trailing::Count { value: 1 }));
    assert_eq!(
        activity.wide,
        Some(StripMessage::Notification {
            app: "Teams".into(),
            title: "First".into(),
        })
    );
}

#[test]
fn a_sender_logo_leads_the_notice_and_the_glance() {
    let rig = Rig::new(|fake| fake.set_app_logo(TEAMS, PNG_BLUE.to_vec(), "image/png"));
    rig.arrive(toast(1, TEAMS, "Teams", "Hi", 1_000));
    let snapshot = rig.service.snapshot();
    let logo = snapshot.groups[0].logo.clone().expect("logo prepared");
    assert!(logo.starts_with("data:image/png;base64,"), "{logo}");
    let StripContent::Notice { notice } = rig.hub.current() else {
        panic!("a notice is showing");
    };
    assert_eq!(
        notice.leading,
        Some(Leading::Image {
            src: logo.clone(),
            glow: None
        })
    );
    assert_eq!(
        rig.unread_activity().expect("glance").leading,
        Some(Leading::Image {
            src: logo,
            glow: None
        })
    );
    assert_eq!(
        rig.platform
            .notification_calls()
            .iter()
            .filter(|call| matches!(call, NotificationCall::Logo(_)))
            .count(),
        1,
        "a logo is fetched once per sender"
    );
}

#[test]
fn several_arrivals_at_once_leave_the_newest_showing() {
    let rig = Rig::new(|_| {});
    rig.platform
        .push_notification(toast(1, TEAMS, "Teams", "Older", 1_000));
    rig.platform
        .push_notification(toast(2, MAIL, "Mail", "Newer", 2_000));
    assert!(rig.service.refresh());
    assert_eq!(
        rig.shown_notice_id().as_deref(),
        Some("notifications:arrived:2")
    );
    assert_eq!(rig.service.snapshot().unread, 2);
}

#[test]
fn notices_are_held_while_a_focus_session_is_on() {
    let rig = Rig::new(|fake| fake.set_focus_active(Some(true)));
    assert_eq!(rig.service.snapshot().focus_active, Some(true));
    rig.arrive(toast(1, TEAMS, "Teams", "Quiet", 1_000));
    assert_eq!(rig.shown_notice_id(), None);
    assert_eq!(rig.service.snapshot().unread, 1, "still listed and counted");
    assert!(rig.unread_activity().is_some(), "the glance still shows");
}

#[test]
fn notices_are_held_while_windows_says_the_user_is_busy() {
    for state in [
        UserNotificationState::Busy,
        UserNotificationState::FullscreenD3d,
        UserNotificationState::Presentation,
        UserNotificationState::QuietTime,
    ] {
        let rig = Rig::new(|fake| fake.set_user_notification_state(state));
        rig.arrive(toast(1, TEAMS, "Teams", "Quiet", 1_000));
        assert_eq!(rig.shown_notice_id(), None, "{state:?}");
    }
    let rig = Rig::new(|fake| {
        fake.set_user_notification_state(UserNotificationState::AcceptsNotifications);
    });
    rig.arrive(toast(1, TEAMS, "Teams", "Loud", 1_000));
    assert!(rig.shown_notice_id().is_some());
}

#[test]
fn arrival_notices_can_be_switched_off() {
    let rig = Rig::new(|_| {});
    rig.apply(&NotificationsSettings {
        arrival_notices: false,
        ..NotificationsSettings::default()
    });
    rig.arrive(toast(1, TEAMS, "Teams", "Silent", 1_000));
    assert_eq!(rig.shown_notice_id(), None);
    assert_eq!(rig.service.snapshot().unread, 1);
}

#[test]
fn the_glance_can_be_switched_off_and_comes_back() {
    let rig = Rig::new(|_| {});
    rig.arrive(toast(1, TEAMS, "Teams", "Hi", 1_000));
    assert!(rig.unread_activity().is_some());
    rig.apply(&NotificationsSettings {
        show_unread_in_strip: false,
        ..NotificationsSettings::default()
    });
    assert_eq!(rig.unread_activity(), None);
    assert_eq!(rig.service.snapshot().unread, 1, "the count is unchanged");
    rig.apply(&NotificationsSettings::default());
    assert!(rig.unread_activity().is_some());
}

// --- muting --------------------------------------------------------------------------------

#[test]
fn a_muted_sender_is_listed_but_never_announced_or_counted() {
    let rig = Rig::new(|_| {});
    rig.apply(&NotificationsSettings {
        muted_apps: vec![MAIL.into()],
        ..NotificationsSettings::default()
    });
    rig.arrive(toast(1, MAIL, "Mail", "Newsletter", 1_000));
    let snapshot = rig.service.snapshot();
    assert_eq!(group_titles(&snapshot, MAIL), ["Newsletter"]);
    assert!(snapshot.groups[0].muted);
    assert_eq!(snapshot.unread, 0);
    assert_eq!(rig.shown_notice_id(), None);
    assert_eq!(rig.unread_activity(), None);

    rig.arrive(toast(2, TEAMS, "Teams", "Ping", 2_000));
    assert_eq!(rig.service.snapshot().unread, 1);
    assert_eq!(
        rig.shown_notice_id().as_deref(),
        Some("notifications:arrived:2")
    );
}

#[test]
fn muting_a_sender_later_drops_it_from_the_count_and_unmuting_restores_it() {
    let rig = Rig::new(|_| {});
    rig.arrive(toast(1, MAIL, "Mail", "Newsletter", 1_000));
    assert_eq!(rig.service.snapshot().unread, 1);
    rig.apply(&NotificationsSettings {
        muted_apps: vec![MAIL.into()],
        ..NotificationsSettings::default()
    });
    assert_eq!(rig.service.snapshot().unread, 0);
    assert_eq!(rig.unread_activity(), None);
    rig.apply(&NotificationsSettings::default());
    assert_eq!(rig.service.snapshot().unread, 1);
    assert!(rig.unread_activity().is_some());
}

// --- commands ------------------------------------------------------------------------------

#[test]
fn mark_read_clears_the_count_and_retracts_the_glance() {
    let rig = Rig::new(|_| {});
    rig.arrive(toast(1, TEAMS, "Teams", "Hi", 1_000));
    rig.arrive(toast(2, MAIL, "Mail", "Hello", 2_000));
    let snapshot = rig
        .service
        .command(NotificationsCommand::MarkRead)
        .expect("mark read");
    assert_eq!(snapshot.unread, 0);
    assert!(
        snapshot
            .groups
            .iter()
            .flat_map(|group| &group.notifications)
            .all(|view| !view.unread)
    );
    assert_eq!(rig.unread_activity(), None);
    assert_eq!(
        rig.calls_without_reads(),
        [],
        "marking read is Muna's bookkeeping, not the Action Center's"
    );
}

#[test]
fn dismiss_removes_from_the_action_center_and_the_list_at_once() {
    let rig = Rig::new(|fake| {
        fake.push_notification(toast(1, TEAMS, "Teams", "Keep", 1_000));
    });
    rig.arrive(toast(2, TEAMS, "Teams", "Drop", 2_000));
    let snapshot = rig
        .service
        .command(NotificationsCommand::Dismiss { id: 2 })
        .expect("dismiss");
    assert_eq!(group_titles(&snapshot, TEAMS), ["Keep"]);
    assert_eq!(snapshot.unread, 0);
    assert_eq!(rig.calls_without_reads(), [NotificationCall::Remove(2)]);
    assert_eq!(
        rig.platform.notifications().len(),
        1,
        "gone from the OS too"
    );
    assert_eq!(rig.unread_activity(), None);
    // The listener's own change event, moments later, finds nothing new.
    assert!(!rig.service.refresh());
}

#[test]
fn dismissing_a_sender_removes_each_of_its_notifications() {
    let rig = Rig::new(|_| {});
    rig.arrive(toast(1, TEAMS, "Teams", "A", 1_000));
    rig.arrive(toast(2, MAIL, "Mail", "B", 2_000));
    rig.arrive(toast(3, TEAMS, "Teams", "C", 3_000));
    let snapshot = rig
        .service
        .command(NotificationsCommand::DismissApp {
            app_id: TEAMS.into(),
        })
        .expect("dismiss app");
    assert!(group_titles(&snapshot, TEAMS).is_empty());
    assert_eq!(group_titles(&snapshot, MAIL), ["B"]);
    assert_eq!(
        rig.calls_without_reads(),
        [NotificationCall::Remove(1), NotificationCall::Remove(3)],
        "in the listener's order"
    );
}

#[test]
fn clear_empties_the_action_center() {
    let rig = Rig::new(|fake| {
        fake.push_notification(toast(1, TEAMS, "Teams", "A", 1_000));
    });
    rig.arrive(toast(2, MAIL, "Mail", "B", 2_000));
    let snapshot = rig
        .service
        .command(NotificationsCommand::Clear)
        .expect("clear");
    assert!(snapshot.groups.is_empty());
    assert_eq!(snapshot.unread, 0);
    assert_eq!(rig.calls_without_reads(), [NotificationCall::Clear]);
    assert!(rig.platform.notifications().is_empty());
    assert_eq!(rig.unread_activity(), None);
}

#[test]
fn open_launches_the_sender_and_removes_the_notification() {
    let rig = Rig::new(|_| {});
    rig.arrive(toast(1, TEAMS, "Teams", "Open me", 1_000));
    let snapshot = rig
        .service
        .command(NotificationsCommand::Open { id: 1 })
        .expect("open");
    assert!(group_titles(&snapshot, TEAMS).is_empty());
    assert_eq!(
        rig.calls_without_reads(),
        [
            NotificationCall::OpenApp(TEAMS.into()),
            NotificationCall::Remove(1)
        ]
    );
}

#[test]
fn opening_a_notification_that_has_gone_is_not_found() {
    let rig = Rig::new(|_| {});
    let error = rig
        .service
        .command(NotificationsCommand::Open { id: 99 })
        .expect_err("unknown");
    assert!(matches!(error, PlatformError::NotFound(_)), "{error:?}");
    assert_eq!(rig.calls_without_reads(), [], "nothing is launched");
}

#[test]
fn a_listener_that_refuses_a_command_surfaces_the_error_unchanged() {
    let rig = Rig::new(|_| {});
    rig.arrive(toast(1, TEAMS, "Teams", "Stuck", 1_000));
    let before = rig.snapshots();
    rig.platform.set_notifications_unavailable(true);
    let error = rig
        .service
        .command(NotificationsCommand::Dismiss { id: 1 })
        .expect_err("dismiss refused");
    assert!(matches!(error, PlatformError::Unsupported(_)), "{error:?}");
    assert_eq!(group_titles(&rig.service.snapshot(), TEAMS), ["Stuck"]);
    assert_eq!(rig.snapshots(), before, "a failed command changes nothing");
}

#[test]
fn refresh_as_a_command_re_reads_the_list() {
    let rig = Rig::new(|fake| fake.set_notification_delivery(NotificationDelivery::Polling));
    rig.platform
        .push_notification(toast(1, TEAMS, "Teams", "Polled", 1_000));
    let snapshot = rig
        .service
        .command(NotificationsCommand::Refresh)
        .expect("refresh");
    assert_eq!(group_titles(&snapshot, TEAMS), ["Polled"]);
    assert_eq!(snapshot.unread, 1);
}

// --- settings ------------------------------------------------------------------------------

#[test]
fn settings_round_trip_and_default_when_missing_or_malformed() {
    let defaults = NotificationsSettings::default();
    assert!(defaults.arrival_notices);
    assert!(defaults.show_unread_in_strip);
    assert!(defaults.muted_apps.is_empty());

    let mut document = Settings::default();
    assert_eq!(NotificationsSettings::from_document(&document), defaults);

    let custom = NotificationsSettings {
        arrival_notices: false,
        show_unread_in_strip: true,
        muted_apps: vec![MAIL.into()],
    };
    custom.write(&mut document).expect("write");
    assert_eq!(NotificationsSettings::from_document(&document), custom);
    assert!(custom.is_muted(MAIL));
    assert!(!custom.is_muted(TEAMS));

    document.modules.insert(
        NotificationsSettings::KEY.to_owned(),
        serde_json::json!({ "arrivalNotices": "yes please" }),
    );
    assert_eq!(NotificationsSettings::from_document(&document), defaults);
}

#[test]
fn the_same_settings_applied_twice_reach_the_sink_once() {
    let rig = Rig::new(|_| {});
    let custom = NotificationsSettings {
        arrival_notices: false,
        ..NotificationsSettings::default()
    };
    rig.apply(&custom);
    rig.apply(&custom);
    assert_eq!(rig.snapshots(), 2);
    assert_eq!(rig.service.settings(), custom);
}

// --- registry ------------------------------------------------------------------------------

#[test]
fn the_module_is_registered_with_strip_and_panel() {
    let clock = Arc::new(FakeClock::new());
    let platform = Arc::new(FakePlatform::new()) as Arc<dyn Platform>;
    let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
    let store = Arc::new(muna_core::Store::open_in_memory().expect("store"));
    let services = ModuleServices::new(
        &platform,
        &hub,
        None,
        &store,
        &(Arc::clone(&clock) as Arc<dyn Clock>),
    );
    let backend = backends(&services)
        .into_iter()
        .find(|backend| backend.id() == ID)
        .expect("notifications is registered");
    assert_eq!(backend.capabilities(), [Surface::Strip, Surface::Panel]);
}
