//! The `notifications` module backend (docs/modules/notifications.md): the Action Center as
//! the panel shows it — grouped by sender, newest first — the unread glance in the strip, the
//! arrival notices, and dismiss, clear and open against the listener.
//!
//! The service is a reducer over the listener's list: every refresh re-reads it and diffs ids,
//! which is the same code path for a `NotificationChanged` event (a build with package
//! identity) and for the one-second poll (a build without, ADR-0003 and its M0 amendment). So
//! `tests/notifications.rs` drives it with `FakePlatform` alone. Every listener call blocks on
//! the OS; the IPC layer and the backend loop run them off the async threads.
//!
//! Content (titles, bodies, sender names) is never logged: this module logs counts and ids.

pub mod settings;

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use muna_core::{
    Activity, Glyph, Hub, Int53, Leading, Notice, Settings, StripMessage, Trailing,
    activities::priority, artwork,
};
use muna_platform::{
    Notification, NotificationAccess, NotificationDelivery, Platform, PlatformError, PlatformEvent,
    UserNotificationState,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tokio::sync::Notify;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use settings::NotificationsSettings;

pub const ID: &str = "notifications";
/// The unread glance's activity id.
pub const UNREAD_ACTIVITY_ID: &str = "notifications:unread";
/// How often a build without package identity asks the listener (ADR-0003 amendment).
pub const POLL_INTERVAL: Duration = Duration::from_secs(1);
/// Sender logos kept in memory; past this the least recently seen sender's goes.
pub const LOGO_CACHE_ENTRIES: usize = 64;

/// Whether Muna may read the Action Center, as the panel states it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AccessState {
    Allowed,
    /// The user said no in Settings → Privacy → Notifications; the panel offers that page.
    Denied,
    /// Never asked; the panel offers *Allow*, which shows the consent prompt.
    Unspecified,
    /// This Windows has no listener at all.
    Unavailable,
}

/// What the panel and the settings pane show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationsSnapshot {
    pub access: AccessState,
    /// How changes arrive once access is allowed: `Push` with package identity, `Polling`
    /// without; `None` until the first watch (or while access is not allowed).
    pub delivery: Option<NotificationDelivery>,
    /// A Windows focus session is on (`None` before Windows 11 22H2).
    pub focus_active: Option<bool>,
    /// Unread notifications from unmuted senders.
    pub unread: u32,
    /// Newest sender first (by its latest notification).
    pub groups: Vec<NotificationGroup>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationGroup {
    pub app_id: String,
    pub app_name: String,
    /// The sender's logo as a data URL; `None` when Windows has none for it.
    pub logo: Option<String>,
    pub muted: bool,
    /// Newest first.
    pub notifications: Vec<NotificationView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationView {
    pub id: u32,
    pub app_id: String,
    pub title: String,
    pub body: String,
    #[specta(type = Int53)]
    pub created_at_ms: i64,
    pub unread: bool,
}

/// What the panel can ask for. Muting a sender is a setting (`mutedApps`), written through the
/// settings editor like any other.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum NotificationsCommand {
    /// Shows the consent prompt (or, once answered, re-reads the answer).
    RequestAccess,
    /// Re-reads the Action Center now.
    Refresh,
    /// Everything listed counts as read (the panel expanded).
    MarkRead,
    /// Removes one notification from the Action Center too.
    Dismiss { id: u32 },
    /// Removes every notification of one sender from the Action Center too.
    DismissApp { app_id: String },
    /// Empties the Action Center.
    Clear,
    /// Brings the sender to the front and removes the notification, as Windows does when a
    /// toast is activated.
    Open { id: u32 },
}

/// Where the module reports a changed snapshot; the shell bridges it to a Tauri event.
pub trait NotificationsSink: Send + Sync {
    fn changed(&self, snapshot: &NotificationsSnapshot);
}

#[derive(Debug)]
struct State {
    access: AccessState,
    delivery: Option<NotificationDelivery>,
    focus_active: Option<bool>,
    /// As the listener reported them, in its order.
    notifications: Vec<Notification>,
    /// Ids the user has seen (the panel expanded, or already there at start-up).
    read: HashSet<u32>,
    /// Sender → logo data URL (`None`: Windows has none), most recently used last.
    logos: HashMap<String, Option<String>>,
    logo_order: VecDeque<String>,
    /// The session is locked: a polling build stops asking until it unlocks.
    locked: bool,
}

impl State {
    fn new() -> Self {
        Self {
            access: AccessState::Unavailable,
            delivery: None,
            focus_active: None,
            notifications: Vec::new(),
            read: HashSet::new(),
            logos: HashMap::new(),
            logo_order: VecDeque::new(),
            locked: false,
        }
    }

    fn ids(&self) -> HashSet<u32> {
        self.notifications
            .iter()
            .map(|notification| notification.id)
            .collect()
    }

    fn find(&self, id: u32) -> Option<&Notification> {
        self.notifications
            .iter()
            .find(|notification| notification.id == id)
    }

    /// Replaces the list, forgets read marks for notifications that left, and answers the
    /// notifications that were not there before, newest first.
    fn replace(&mut self, notifications: Vec<Notification>) -> Vec<Notification> {
        let known = self.ids();
        self.notifications = notifications;
        let current = self.ids();
        self.read.retain(|id| current.contains(id));
        let mut arrived: Vec<Notification> = self
            .notifications
            .iter()
            .filter(|notification| !known.contains(&notification.id))
            .cloned()
            .collect();
        arrived.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms).then(b.id.cmp(&a.id)));
        arrived
    }

    fn mark_all_read(&mut self) {
        self.read = self.ids();
    }

    fn remember_logo(&mut self, app_id: &str, logo: Option<String>) {
        if self.logos.insert(app_id.to_owned(), logo).is_none() {
            self.logo_order.push_back(app_id.to_owned());
            while self.logo_order.len() > LOGO_CACHE_ENTRIES {
                if let Some(oldest) = self.logo_order.pop_front() {
                    self.logos.remove(&oldest);
                }
            }
        }
    }
}

pub struct NotificationsService {
    platform: Arc<dyn Platform>,
    hub: Arc<Hub>,
    settings: Mutex<NotificationsSettings>,
    sink: Mutex<Option<Arc<dyn NotificationsSink>>>,
    state: Mutex<State>,
    /// Wakes the backend loop after a command or a settings change.
    wake: Notify,
}

impl std::fmt::Debug for NotificationsService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let state = self.state.lock();
        f.debug_struct("NotificationsService")
            .field("settings", &*self.settings.lock())
            .field("access", &state.access)
            .field("delivery", &state.delivery)
            .field("notifications", &state.notifications.len())
            .field("read", &state.read.len())
            .finish_non_exhaustive()
    }
}

impl NotificationsService {
    #[must_use]
    pub fn new(platform: Arc<dyn Platform>, hub: Arc<Hub>) -> Self {
        Self {
            platform,
            hub,
            settings: Mutex::new(NotificationsSettings::default()),
            sink: Mutex::new(None),
            state: Mutex::new(State::new()),
            wake: Notify::new(),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn NotificationsSink>) {
        *self.sink.lock() = Some(sink);
    }

    #[must_use]
    pub fn settings(&self) -> NotificationsSettings {
        self.settings.lock().clone()
    }

    /// Asks the listener whether Muna may read, reads what is there and subscribes. Nothing
    /// already in the Action Center is announced or counted: the user has seen Windows show
    /// it. Blocking: every step is a listener call.
    pub fn seed(&self) {
        let access = self.read_access();
        self.state.lock().access = access;
        if access == AccessState::Allowed {
            self.adopt();
        } else {
            let mut state = self.state.lock();
            state.delivery = None;
            state.notifications.clear();
            state.read.clear();
        }
        self.state.lock().focus_active = self.platform.notifications().focus_active();
        self.sync_unread();
        self.emit();
    }

    fn read_access(&self) -> AccessState {
        match self.platform.notifications().access() {
            Ok(access) => access_state(access),
            Err(PlatformError::Unsupported(_)) => AccessState::Unavailable,
            Err(error) => {
                tracing::warn!(%error, "notification listener access could not be read");
                AccessState::Unavailable
            }
        }
    }

    /// With access allowed: the current list is what the user already knows, and the change
    /// subscription decides between push and polling.
    fn adopt(&self) {
        let listed = self.platform.notifications().list();
        let delivery = match self.platform.notifications().watch() {
            Ok(delivery) => delivery,
            Err(error) => {
                tracing::warn!(%error, "notification changes cannot be watched; polling");
                NotificationDelivery::Polling
            }
        };
        let senders: Vec<String> = {
            let mut state = self.state.lock();
            state.delivery = Some(delivery);
            match listed {
                Ok(notifications) => {
                    state.replace(notifications);
                    state.mark_all_read();
                }
                Err(error) => {
                    tracing::warn!(%error, "notifications could not be listed");
                }
            }
            senders_without_logo(&state)
        };
        self.fetch_logos(&senders);
    }

    /// The panel's view as it stands.
    #[must_use]
    pub fn snapshot(&self) -> NotificationsSnapshot {
        let settings = self.settings.lock();
        let state = self.state.lock();
        let mut groups: Vec<NotificationGroup> = Vec::new();
        let mut by_app: HashMap<&str, usize> = HashMap::new();
        for notification in &state.notifications {
            let index = *by_app
                .entry(notification.app_id.as_str())
                .or_insert_with(|| {
                    groups.push(NotificationGroup {
                        app_id: notification.app_id.clone(),
                        app_name: notification.app_name.clone(),
                        logo: state
                            .logos
                            .get(&notification.app_id)
                            .cloned()
                            .unwrap_or_default(),
                        muted: settings.is_muted(&notification.app_id),
                        notifications: Vec::new(),
                    });
                    groups.len() - 1
                });
            if let Some(group) = groups.get_mut(index) {
                if group.app_name.is_empty() {
                    group.app_name.clone_from(&notification.app_name);
                }
                group.notifications.push(NotificationView {
                    id: notification.id,
                    app_id: notification.app_id.clone(),
                    title: notification.title.clone(),
                    body: notification.body.clone(),
                    created_at_ms: notification.created_at_ms,
                    unread: !state.read.contains(&notification.id),
                });
            }
        }
        for group in &mut groups {
            group
                .notifications
                .sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms).then(b.id.cmp(&a.id)));
        }
        groups.sort_by(|a, b| {
            let latest = |group: &NotificationGroup| {
                group
                    .notifications
                    .first()
                    .map_or((0, 0), |view| (view.created_at_ms, view.id))
            };
            latest(b)
                .cmp(&latest(a))
                .then_with(|| a.app_name.cmp(&b.app_name))
        });
        let unread = unread_of(&state, &settings).len();
        NotificationsSnapshot {
            access: state.access,
            delivery: state.delivery,
            focus_active: state.focus_active,
            unread: u32::try_from(unread).unwrap_or(u32::MAX),
            groups,
        }
    }

    /// Applies `settings.modules.notifications` (start-up and every settings change). Muting a
    /// sender changes the count and the glance; turning notices off retracts none showing.
    pub fn apply_settings(&self, settings: &Settings) {
        let next = NotificationsSettings::from_document(settings);
        {
            let mut current = self.settings.lock();
            if *current == next {
                return;
            }
            *current = next;
        }
        self.sync_unread();
        self.emit();
        self.wake.notify_one();
    }

    /// Re-reads the Action Center and announces what arrived. Blocking. Returns `true` when
    /// the snapshot changed. A list that fails re-checks access: the user may have withdrawn
    /// it in Settings; a transient failure keeps the last list.
    pub fn refresh(&self) -> bool {
        if self.state.lock().access != AccessState::Allowed {
            return false;
        }
        let listed = match self.platform.notifications().list() {
            Ok(listed) => listed,
            Err(error) => {
                let access = self.read_access();
                tracing::debug!(%error, ?access, "notifications could not be listed");
                if access == AccessState::Allowed {
                    return false;
                }
                let mut state = self.state.lock();
                state.access = access;
                state.delivery = None;
                state.notifications.clear();
                state.read.clear();
                drop(state);
                self.sync_unread();
                self.emit();
                return true;
            }
        };
        let (arrived, changed, senders) = {
            let mut state = self.state.lock();
            let changed = state.notifications != listed;
            let arrived = state.replace(listed);
            (arrived, changed, senders_without_logo(&state))
        };
        if !changed {
            return false;
        }
        self.fetch_logos(&senders);
        self.announce(&arrived);
        self.sync_unread();
        self.emit();
        true
    }

    /// Folds one platform event in; other events are ignored. Returns `true` when the
    /// snapshot changed. The Action Center change itself is not applied here — it is a
    /// blocking re-read the backend loop runs off the async threads after this returns.
    pub fn observe(&self, event: &PlatformEvent) -> bool {
        match event {
            PlatformEvent::FocusChanged { active } => {
                let changed = {
                    let mut state = self.state.lock();
                    let changed = state.focus_active != Some(*active);
                    state.focus_active = Some(*active);
                    changed
                };
                if changed {
                    self.emit();
                }
                changed
            }
            PlatformEvent::SessionLockChanged { locked } => {
                self.state.lock().locked = *locked;
                if !locked {
                    self.wake.notify_one();
                }
                false
            }
            _ => false,
        }
    }

    /// How long the backend loop may sleep before asking the listener again: the poll
    /// interval for a polling build with access, while the session is unlocked; `None` (wait
    /// for a wake) for a push build, a build without access, or a locked session. No polling
    /// without consent is an acceptance criterion.
    #[must_use]
    pub fn next_wake(&self) -> Option<Duration> {
        let state = self.state.lock();
        (state.access == AccessState::Allowed
            && state.delivery == Some(NotificationDelivery::Polling)
            && !state.locked)
            .then_some(POLL_INTERVAL)
    }

    /// Wakes the backend loop (a command, a settings change, an unlock).
    pub fn wake(&self) {
        self.wake.notify_one();
    }

    /// Runs one command against the listener and returns the snapshot afterwards. Blocking:
    /// every listener call is; the IPC layer calls this from a blocking task.
    pub fn command(
        &self,
        command: NotificationsCommand,
    ) -> Result<NotificationsSnapshot, PlatformError> {
        match command {
            NotificationsCommand::RequestAccess => {
                let access = match self.platform.notifications().request_access() {
                    Ok(access) => access_state(access),
                    Err(PlatformError::Unsupported(_)) => AccessState::Unavailable,
                    Err(error) => return Err(error),
                };
                self.state.lock().access = access;
                if access == AccessState::Allowed {
                    self.adopt();
                }
                self.sync_unread();
                self.emit();
                self.wake.notify_one();
            }
            NotificationsCommand::Refresh => {
                self.refresh();
            }
            NotificationsCommand::MarkRead => {
                self.state.lock().mark_all_read();
                self.sync_unread();
                self.emit();
            }
            NotificationsCommand::Dismiss { id } => {
                self.platform.notifications().remove(id)?;
                self.forget(&[id]);
            }
            NotificationsCommand::DismissApp { app_id } => {
                let ids: Vec<u32> = {
                    let state = self.state.lock();
                    state
                        .notifications
                        .iter()
                        .filter(|notification| notification.app_id == app_id)
                        .map(|notification| notification.id)
                        .collect()
                };
                for id in &ids {
                    self.platform.notifications().remove(*id)?;
                }
                self.forget(&ids);
            }
            NotificationsCommand::Clear => {
                self.platform.notifications().clear()?;
                let ids: Vec<u32> = self.state.lock().ids().into_iter().collect();
                self.forget(&ids);
            }
            NotificationsCommand::Open { id } => {
                let app_id = self
                    .state
                    .lock()
                    .find(id)
                    .map(|notification| notification.app_id.clone())
                    .ok_or_else(|| PlatformError::NotFound(format!("notification {id}")))?;
                self.platform.notifications().open_app(&app_id)?;
                // Activating a toast removes it in Windows too; a listener that cannot is not
                // worth failing the open for.
                if let Err(error) = self.platform.notifications().remove(id) {
                    tracing::debug!(%error, id, "opened notification could not be removed");
                }
                self.forget(&[id]);
            }
        }
        Ok(self.snapshot())
    }

    /// Drops notifications the user just dismissed without waiting for the listener to say
    /// so (a push build confirms moments later; a polling build within the second).
    fn forget(&self, ids: &[u32]) {
        {
            let mut state = self.state.lock();
            state
                .notifications
                .retain(|notification| !ids.contains(&notification.id));
            for id in ids {
                state.read.remove(id);
            }
        }
        self.sync_unread();
        self.emit();
    }

    /// Logos for senders the state has none for yet. Blocking (each is a stream read); the
    /// caller is already off the async threads.
    fn fetch_logos(&self, senders: &[String]) {
        for app_id in senders {
            let logo = match self.platform.notifications().app_logo(app_id) {
                Ok(Some(thumbnail)) => {
                    match artwork::prepare(app_id, &thumbnail.bytes, &thumbnail.content_type) {
                        Ok(prepared) => Some(prepared.src),
                        Err(error) => {
                            tracing::debug!(%error, "sender logo could not be decoded");
                            None
                        }
                    }
                }
                Ok(None) => None,
                Err(error) => {
                    tracing::debug!(%error, "sender logo could not be read");
                    None
                }
            };
            self.state.lock().remember_logo(app_id, logo);
        }
    }

    /// Publishes a notice per arriving notification from an unmuted sender, unless notices are
    /// off, Windows says the user is busy (fullscreen, presenting, quiet hours) or a focus
    /// session is on. Newest last so the latest ends up showing.
    fn announce(&self, arrived: &[Notification]) {
        if arrived.is_empty() || !self.settings.lock().arrival_notices {
            return;
        }
        if self.state.lock().focus_active == Some(true) {
            tracing::debug!(count = arrived.len(), "notices held: focus session");
            return;
        }
        if self
            .platform
            .windowing()
            .user_notification_state()
            .is_ok_and(UserNotificationState::quiet)
        {
            tracing::debug!(count = arrived.len(), "notices held: busy or quiet hours");
            return;
        }
        let settings = self.settings.lock().clone();
        for notification in arrived.iter().rev() {
            if settings.is_muted(&notification.app_id) {
                continue;
            }
            let logo = self.logo_of(&notification.app_id);
            self.hub
                .publish_notice(arrival_notice(notification, logo.as_deref()));
        }
    }

    /// Publishes or retracts the unread glance to match the state.
    fn sync_unread(&self) {
        let settings = self.settings.lock().clone();
        let (latest, count, logo) = {
            let state = self.state.lock();
            let unread = unread_of(&state, &settings);
            let latest = unread.first().cloned();
            let logo = latest
                .as_ref()
                .and_then(|notification| state.logos.get(&notification.app_id).cloned())
                .flatten();
            (latest, unread.len(), logo)
        };
        match latest {
            Some(latest) if settings.show_unread_in_strip => {
                let count = u32::try_from(count).unwrap_or(u32::MAX);
                self.hub
                    .publish_activity(unread_activity(&latest, count, logo.as_deref()));
            }
            _ => self.hub.retract_activity(UNREAD_ACTIVITY_ID),
        }
    }

    fn logo_of(&self, app_id: &str) -> Option<String> {
        self.state.lock().logos.get(app_id).cloned().flatten()
    }

    fn emit(&self) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.changed(&self.snapshot());
        }
    }
}

fn access_state(access: NotificationAccess) -> AccessState {
    match access {
        NotificationAccess::Allowed => AccessState::Allowed,
        NotificationAccess::Denied => AccessState::Denied,
        NotificationAccess::Unspecified => AccessState::Unspecified,
    }
}

/// Unread notifications from unmuted senders, newest first.
fn unread_of(state: &State, settings: &NotificationsSettings) -> Vec<Notification> {
    let mut unread: Vec<Notification> = state
        .notifications
        .iter()
        .filter(|notification| {
            !state.read.contains(&notification.id) && !settings.is_muted(&notification.app_id)
        })
        .cloned()
        .collect();
    unread.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms).then(b.id.cmp(&a.id)));
    unread
}

fn senders_without_logo(state: &State) -> Vec<String> {
    let mut senders: Vec<String> = Vec::new();
    for notification in &state.notifications {
        if !notification.app_id.is_empty()
            && !state.logos.contains_key(&notification.app_id)
            && !senders.contains(&notification.app_id)
        {
            senders.push(notification.app_id.clone());
        }
    }
    senders
}

fn leading_for(logo: Option<&str>) -> Leading {
    logo.map_or(
        Leading::Icon {
            glyph: Glyph::Bell,
            tint: None,
        },
        |src| Leading::Image {
            src: src.to_owned(),
            glow: None,
        },
    )
}

/// The arrival notice: the sender's logo (or a bell), "<sender> · <title>" wide.
#[must_use]
pub fn arrival_notice(notification: &Notification, logo: Option<&str>) -> Notice {
    Notice {
        id: format!("notifications:arrived:{}", notification.id),
        module: ID.into(),
        priority: priority::UNREAD,
        leading: Some(leading_for(logo)),
        trailing: None,
        wide: Some(StripMessage::Notification {
            app: notification.app_name.clone(),
            title: notification.title.clone(),
        }),
        hold_ms: 0,
    }
}

/// The unread glance: the latest unread sender's logo (or a bell), the count on the right,
/// the latest title wide.
#[must_use]
pub fn unread_activity(latest: &Notification, count: u32, logo: Option<&str>) -> Activity {
    Activity {
        id: UNREAD_ACTIVITY_ID.into(),
        module: ID.into(),
        priority: priority::UNREAD,
        leading: Some(leading_for(logo)),
        trailing: Some(Trailing::Count { value: count }),
        wide: Some(StripMessage::Notification {
            app: latest.app_name.clone(),
            title: latest.title.clone(),
        }),
    }
}

/// The backend: seeds from the listener, then follows its events or polls.
#[derive(Debug, Clone)]
pub struct NotificationsModule(pub Arc<NotificationsService>);

impl ModuleBackend for NotificationsModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Strip, Surface::Panel]
    }

    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()> {
        let service = Arc::clone(&self.0);
        tauri::async_runtime::spawn(async move {
            let seeder = Arc::clone(&service);
            if let Err(error) = tauri::async_runtime::spawn_blocking(move || seeder.seed()).await {
                tracing::warn!(%error, "notifications seed task failed");
            }
            loop {
                match service.next_wake() {
                    None => service.wake.notified().await,
                    Some(wait) => {
                        tokio::select! {
                            () = tokio::time::sleep(wait) => {}
                            () = service.wake.notified() => {}
                        }
                    }
                }
                let refresher = Arc::clone(&service);
                if let Err(error) =
                    tauri::async_runtime::spawn_blocking(move || refresher.refresh()).await
                {
                    tracing::warn!(%error, "notifications refresh task failed");
                }
            }
        });
        let service = Arc::clone(&self.0);
        let mut events = ctx.platform.subscribe();
        tauri::async_runtime::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(PlatformEvent::NotificationsChanged) => service.wake(),
                    Ok(event) => {
                        service.observe(&event);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "notifications events lagged");
                        service.wake();
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        Ok(())
    }
}
