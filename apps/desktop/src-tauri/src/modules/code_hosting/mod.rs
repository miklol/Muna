//! The `code-hosting` module backend (docs/modules/code-hosting.md): the pull requests that
//! want the user's review and the ones they opened, from GitHub with a personal access token,
//! polled every two minutes while the module is on and an account is connected, kept across
//! launches so an offline start still shows the last queue with its time.
//!
//! [`CodeHostingService`] is a reducer: everything that decides is synchronous and takes the
//! clock as an argument, so `tests/code_hosting.rs` drives it step by step with a `FakeClock`
//! and scripted queues. The only asynchronous part — the provider's request — happens in the
//! backend loop, between [`CodeHostingService::plan`] and [`CodeHostingService::complete_poll`],
//! and in *Connect*, which checks a token by fetching with it once.
//!
//! Privacy (`.github/copilot-instructions.md`, "local-first & private"): nothing is requested
//! until `settings.modules["code-hosting"].enabled` is true and the user pasted a token; the
//! token lives in the credential vault under [`TOKEN_KEY`], is read for each poll and is never
//! logged or written anywhere else; titles, authors and repository names are content and stay
//! out of the log too.

pub mod provider;
pub mod settings;

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use muna_core::{
    Clock, Glyph, Hub, Int53, Leading, Notice, Settings, Store, StripMessage, Tint,
    activities::priority,
};
use muna_platform::Platform;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tokio::sync::Notify;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use provider::{
    Account, ChecksState, CodeHost, FetchError, GitHub, NEW_TOKEN_URL, Provider, PullRequest,
    Queue, ReviewDecision, TokenError, normalise_token,
};
pub use settings::{CodeHostingSettings, NoticeSettings};

pub const ID: &str = "code-hosting";

/// How often the queue is fetched while connected (docs/modules/code-hosting.md).
pub const POLL: Duration = Duration::from_mins(2);
/// The longest wait after consecutive failures; the first is one [`POLL`], doubling.
pub const RETRY_MAX: Duration = Duration::from_mins(30);
/// The credential-vault key the token is kept under.
pub const TOKEN_KEY: &str = "code-hosting.github.token";
/// The `meta` key the last good queue is kept under.
pub const CACHE_KEY: &str = "code-hosting:queue";
/// How many notices one poll may publish: after a long lock the strip should not replay
/// every change one by one.
pub const NOTICES_PER_POLL: usize = 3;

/// What the UI renders (docs/modules/code-hosting.md).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CodeHostingSnapshot {
    /// `false` until the user turns the module on; nothing below is populated meanwhile.
    pub enabled: bool,
    /// The connected account; `None` shows *Connect* in the panel and the pane.
    pub account: Option<Account>,
    /// The last good queue, newest first, possibly from a previous launch.
    pub pull_requests: Vec<PullRequest>,
    /// When `pull_requests` was fetched, Unix milliseconds; the timestamp chip while offline.
    #[specta(type = Option<Int53>)]
    pub fetched_at_ms: Option<i64>,
    /// A request is on the wire.
    pub fetching: bool,
    /// Why the last poll failed; cleared by the next one that works. The queue, if any, stays.
    /// `Unauthorized` also stops polling until the user connects again.
    pub error: Option<FetchError>,
}

/// What the panel can ask for. Settings go through the settings document like every module's;
/// connecting and disconnecting have their own commands because they touch the vault.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CodeHostingCommand {
    /// Fetches now, whatever the schedule says.
    Refresh,
}

/// Why *Connect* did not connect.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ConnectError {
    #[error("code hosting is off")]
    Disabled,
    #[error(transparent)]
    Token(#[from] TokenError),
    #[error(transparent)]
    Fetch(#[from] FetchError),
    /// The credential vault refused the token; nothing was kept.
    #[error("the token could not be stored")]
    Vault,
}

/// Where the module reports changes; the shell bridges it to a Tauri event.
pub trait CodeHostingSink: Send + Sync {
    fn changed(&self, snapshot: &CodeHostingSnapshot);
}

/// A token on its way to the provider. Its `Debug` says nothing, so a logged [`Job`] cannot
/// leak it.
#[derive(Clone, PartialEq, Eq)]
pub struct Token(pub String);

impl std::fmt::Debug for Token {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Token(…)")
    }
}

/// One step of asynchronous work the backend loop runs for the service: fetch the queue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Job {
    pub token: Token,
}

enum Schedule {
    Now,
    /// Nothing until this wall time (Unix milliseconds).
    At(i64),
    Never,
}

/// The last good queue as kept in the store.
#[derive(Serialize, Deserialize)]
struct CacheEntry {
    account: Account,
    fetched_at_ms: i64,
    pull_requests: Vec<PullRequest>,
}

struct Inner {
    settings: CodeHostingSettings,
    /// Bumped when the switch flips or the account changes, so a result that started under
    /// the old state is dropped.
    generation: u64,
    in_flight: Option<u64>,
    /// The session is locked: nobody is looking, so nothing is fetched.
    locked: bool,
    account: Option<Account>,
    pull_requests: Vec<PullRequest>,
    fetched_at_ms: Option<i64>,
    error: Option<FetchError>,
    /// Consecutive polls that failed; sets the wait before the next.
    failures: u32,
    /// Wall time the next poll may run; `None` when one is wanted as soon as possible.
    due_at_ms: Option<i64>,
    /// "Refresh" was pressed.
    force: bool,
    /// A queue has been seen for this account (cached or fetched), so the next one can be
    /// compared with it for notices. Off after *Connect*'s own fetch, whose list is the
    /// baseline, not news.
    primed: bool,
}

pub struct CodeHostingService {
    platform: Arc<dyn Platform>,
    hub: Arc<Hub>,
    store: Arc<Store>,
    clock: Arc<dyn Clock>,
    provider: Arc<dyn CodeHost>,
    inner: Mutex<Inner>,
    sink: Mutex<Option<Arc<dyn CodeHostingSink>>>,
    /// Wakes the backend loop after a command, a connect or a settings change.
    wake: Notify,
}

impl std::fmt::Debug for CodeHostingService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let inner = self.inner.lock();
        f.debug_struct("CodeHostingService")
            .field("enabled", &inner.settings.enabled)
            .field("connected", &inner.account.is_some())
            .field("in_flight", &inner.in_flight)
            .field("provider", &self.provider.name())
            .finish_non_exhaustive()
    }
}

impl CodeHostingService {
    #[must_use]
    pub fn new(
        platform: Arc<dyn Platform>,
        hub: Arc<Hub>,
        store: Arc<Store>,
        clock: Arc<dyn Clock>,
        provider: Arc<dyn CodeHost>,
    ) -> Self {
        Self {
            platform,
            hub,
            store,
            clock,
            provider,
            inner: Mutex::new(Inner {
                settings: CodeHostingSettings::default(),
                generation: 0,
                in_flight: None,
                locked: false,
                account: None,
                pull_requests: Vec::new(),
                fetched_at_ms: None,
                error: None,
                failures: 0,
                due_at_ms: None,
                force: false,
                primed: false,
            }),
            sink: Mutex::new(None),
            wake: Notify::new(),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn CodeHostingSink>) {
        *self.sink.lock() = Some(sink);
    }

    #[must_use]
    pub fn settings(&self) -> CodeHostingSettings {
        self.inner.lock().settings
    }

    #[must_use]
    pub fn snapshot(&self) -> CodeHostingSnapshot {
        snapshot_of(&self.inner.lock())
    }

    fn now_ms(&self) -> i64 {
        unix_ms(self.clock.system_time())
    }

    /// Applies `settings.modules["code-hosting"]` (start-up and every settings change).
    /// Turning the module on restores the cached queue for the vaulted token and polls;
    /// turning it off stops polling and drops the queue from memory — the token and the cache
    /// stay for the next time, *Disconnect* is what forgets them.
    pub fn apply_settings(&self, settings: &Settings) {
        let next = CodeHostingSettings::from_document(settings);
        let snapshot = {
            let mut inner = self.inner.lock();
            if inner.settings == next {
                return;
            }
            let previous = std::mem::replace(&mut inner.settings, next);
            if previous.enabled != inner.settings.enabled {
                inner.generation += 1;
                inner.in_flight = None;
                inner.force = false;
                inner.error = None;
                inner.failures = 0;
                if inner.settings.enabled {
                    self.restore(&mut inner);
                } else {
                    inner.account = None;
                    forget(&mut inner);
                }
            }
            snapshot_of(&inner)
        };
        self.publish(&snapshot);
    }

    /// Runs one command and returns the snapshot after it.
    pub fn command(&self, command: CodeHostingCommand) -> CodeHostingSnapshot {
        let snapshot = {
            let mut inner = self.inner.lock();
            match command {
                CodeHostingCommand::Refresh => {
                    if inner.settings.enabled && inner.account.is_some() {
                        inner.force = true;
                        // A refusal stops the schedule; an explicit refresh may try again.
                        if inner.error == Some(FetchError::Unauthorized) {
                            inner.error = None;
                        }
                    }
                }
            }
            snapshot_of(&inner)
        };
        tracing::debug!(?command, "code hosting command");
        self.publish(&snapshot);
        snapshot
    }

    /// The session locked or unlocked: nothing is fetched while nobody is looking, and an
    /// overdue poll runs as soon as the session is back.
    pub fn set_locked(&self, locked: bool) {
        {
            let mut inner = self.inner.lock();
            if inner.locked == locked {
                return;
            }
            inner.locked = locked;
        }
        self.wake.notify_one();
    }

    /// What the loop should do now, if anything; marks it in flight. The matching
    /// [`Self::complete_poll`] call must follow before the next `plan`. Reads the token from
    /// the vault each time, so a token removed there ends polling with `Unauthorized`.
    pub fn plan(&self) -> Option<Job> {
        let now = self.now_ms();
        let (job, snapshot) = {
            let mut inner = self.inner.lock();
            let Schedule::Now = schedule(&inner, now) else {
                return None;
            };
            inner.force = false;
            let token = match self.platform.secrets().get(TOKEN_KEY) {
                Ok(Some(token)) => token,
                Ok(None) => {
                    tracing::info!("code hosting token is gone from the vault; connect again");
                    inner.error = Some(FetchError::Unauthorized);
                    inner.due_at_ms = None;
                    let snapshot = snapshot_of(&inner);
                    drop(inner);
                    self.notify(&snapshot);
                    return None;
                }
                Err(error) => {
                    inner.failures += 1;
                    inner.error = Some(FetchError::Provider);
                    inner.due_at_ms = Some(now + duration_ms(backoff(inner.failures)));
                    tracing::warn!(%error, failures = inner.failures, "code hosting vault unreadable");
                    let snapshot = snapshot_of(&inner);
                    drop(inner);
                    self.notify(&snapshot);
                    return None;
                }
            };
            inner.in_flight = Some(inner.generation);
            (
                Job {
                    token: Token(token),
                },
                snapshot_of(&inner),
            )
        };
        self.notify(&snapshot);
        Some(job)
    }

    /// How long the loop may sleep: `None` until a command or a settings change wakes it,
    /// zero when a poll is due.
    #[must_use]
    pub fn next_wake(&self) -> Option<Duration> {
        let now = self.now_ms();
        match schedule(&self.inner.lock(), now) {
            Schedule::Never => None,
            Schedule::Now => Some(Duration::ZERO),
            Schedule::At(at) => Some(Duration::from_millis(u64::try_from(at - now).unwrap_or(0))),
        }
    }

    /// The outcome of a [`Job`].
    pub fn complete_poll(&self, result: Result<Queue, FetchError>) {
        let now = self.now_ms();
        let (snapshot, notices) = {
            let mut inner = self.inner.lock();
            let Some(generation) = inner.in_flight.take() else {
                tracing::warn!("code hosting poll completed without one in flight");
                return;
            };
            inner.force = false;
            let mut notices = Vec::new();
            if generation == inner.generation {
                match result {
                    Ok(queue) => {
                        tracing::info!(
                            rows = queue.pull_requests.len(),
                            "code hosting queue fetched"
                        );
                        if inner.primed {
                            notices = notices_for(
                                &inner.pull_requests,
                                &queue.pull_requests,
                                inner.settings.notices,
                            );
                        }
                        self.adopt(&mut inner, queue, now);
                    }
                    Err(FetchError::Unauthorized) => {
                        inner.error = Some(FetchError::Unauthorized);
                        inner.due_at_ms = None;
                        inner.failures = 0;
                        tracing::info!("code hosting token refused; connect again");
                    }
                    Err(error) => {
                        inner.failures += 1;
                        inner.error = Some(error);
                        inner.due_at_ms = Some(now + duration_ms(backoff(inner.failures)));
                        tracing::warn!(%error, failures = inner.failures, "code hosting poll failed");
                    }
                }
            } else {
                tracing::debug!("code hosting poll outlived its account; dropped");
            }
            (snapshot_of(&inner), notices)
        };
        for notice in notices {
            self.hub.publish_notice(notice);
        }
        self.publish(&snapshot);
    }

    /// Checks `token` by fetching with it, then keeps it in the vault and adopts the queue as
    /// the baseline. Refused while the module is off, so the settings pane cannot cause a
    /// request before the switch is on. The token is never logged.
    pub async fn connect(&self, token: &str) -> Result<CodeHostingSnapshot, ConnectError> {
        if !self.inner.lock().settings.enabled {
            return Err(ConnectError::Disabled);
        }
        let token = normalise_token(token)?;
        let queue = self.provider.fetch(token.clone()).await?;
        self.platform
            .secrets()
            .set(TOKEN_KEY, &token)
            .map_err(|error| {
                tracing::warn!(%error, "code hosting token could not be stored");
                ConnectError::Vault
            })?;
        let now = self.now_ms();
        let snapshot = {
            let mut inner = self.inner.lock();
            if !inner.settings.enabled {
                return Err(ConnectError::Disabled);
            }
            inner.generation += 1;
            inner.in_flight = None;
            inner.force = false;
            inner.primed = false;
            self.adopt(&mut inner, queue, now);
            tracing::info!("code hosting account connected");
            snapshot_of(&inner)
        };
        self.publish(&snapshot);
        Ok(snapshot)
    }

    /// Forgets the token, the account and the cached queue.
    pub fn disconnect(&self) -> CodeHostingSnapshot {
        if let Err(error) = self.platform.secrets().remove(TOKEN_KEY) {
            tracing::warn!(%error, "code hosting token could not be removed from the vault");
        }
        if let Err(error) = self.store.remove_meta(CACHE_KEY) {
            tracing::warn!(%error, "code hosting cache could not be removed");
        }
        let snapshot = {
            let mut inner = self.inner.lock();
            inner.generation += 1;
            inner.in_flight = None;
            inner.force = false;
            inner.error = None;
            inner.failures = 0;
            inner.account = None;
            forget(&mut inner);
            tracing::info!("code hosting account disconnected");
            snapshot_of(&inner)
        };
        self.publish(&snapshot);
        snapshot
    }

    /// The web page of a listed pull request, when `id` names one the module itself fetched;
    /// the only thing `code_hosting_open` hands to the browser.
    #[must_use]
    pub fn url_for(&self, id: &str) -> Option<String> {
        self.inner
            .lock()
            .pull_requests
            .iter()
            .find(|row| row.id == id)
            .map(|row| row.url.clone())
    }

    /// Wakes the loop so it re-reads the schedule.
    pub fn wake(&self) {
        self.wake.notify_one();
    }

    /// Takes a fetched queue as the current one and schedules the next poll.
    fn adopt(&self, inner: &mut Inner, queue: Queue, now: i64) {
        inner.account = Some(queue.account);
        inner.pull_requests = queue.pull_requests;
        inner.fetched_at_ms = Some(now);
        inner.error = None;
        inner.failures = 0;
        inner.due_at_ms = Some(now + duration_ms(POLL));
        inner.primed = true;
        self.persist_cache(inner);
    }

    /// The module was turned on (or the app started with it on): if the vault has a token,
    /// the cached queue is shown at once and the first poll is due; without one there is no
    /// account and the panel says *Connect*.
    fn restore(&self, inner: &mut Inner) {
        forget(inner);
        inner.account = None;
        let has_token = match self.platform.secrets().get(TOKEN_KEY) {
            Ok(token) => token.is_some(),
            Err(error) => {
                tracing::warn!(%error, "code hosting vault unreadable at start");
                false
            }
        };
        let cache = self.read_cache();
        if !has_token {
            if cache.is_some() {
                tracing::info!("code hosting token is gone from the vault; cached queue dropped");
                if let Err(error) = self.store.remove_meta(CACHE_KEY) {
                    tracing::warn!(%error, "code hosting cache could not be removed");
                }
            }
            return;
        }
        if let Some(entry) = cache {
            tracing::debug!("code hosting queue restored from the cache");
            inner.account = Some(entry.account);
            inner.pull_requests = entry.pull_requests;
            inner.fetched_at_ms = Some(entry.fetched_at_ms);
            inner.due_at_ms = Some(entry.fetched_at_ms + duration_ms(POLL));
            inner.primed = true;
        } else {
            // A token without a cache (the store was reset): poll for the account.
            inner.account = Some(Account {
                provider: Provider::GitHub,
                login: String::new(),
                avatar_url: None,
            });
            inner.due_at_ms = None;
        }
    }

    fn read_cache(&self) -> Option<CacheEntry> {
        let json = match self.store.get_meta(CACHE_KEY) {
            Ok(Some(json)) => json,
            Ok(None) => return None,
            Err(error) => {
                tracing::warn!(%error, "code hosting cache unreadable");
                return None;
            }
        };
        serde_json::from_str(&json)
            .map_err(|error| tracing::warn!(%error, "code hosting cache malformed; ignored"))
            .ok()
    }

    fn persist_cache(&self, inner: &Inner) {
        let (Some(account), Some(fetched_at_ms)) = (&inner.account, inner.fetched_at_ms) else {
            return;
        };
        let entry = CacheEntry {
            account: account.clone(),
            fetched_at_ms,
            pull_requests: inner.pull_requests.clone(),
        };
        match serde_json::to_string(&entry) {
            Ok(json) => {
                if let Err(error) = self.store.set_meta(CACHE_KEY, &json) {
                    tracing::warn!(%error, "code hosting cache could not be written");
                }
            }
            Err(error) => tracing::warn!(%error, "code hosting cache could not be serialised"),
        }
    }

    fn notify(&self, snapshot: &CodeHostingSnapshot) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.changed(snapshot);
        }
    }

    /// Tells the sink and wakes the loop.
    fn publish(&self, snapshot: &CodeHostingSnapshot) {
        self.notify(snapshot);
        self.wake.notify_one();
    }
}

/// Drops the queue and its schedule; the settings and the account stay.
fn forget(inner: &mut Inner) {
    inner.pull_requests = Vec::new();
    inner.fetched_at_ms = None;
    inner.due_at_ms = None;
    inner.primed = false;
}

fn schedule(inner: &Inner, now: i64) -> Schedule {
    if !inner.settings.enabled
        || inner.account.is_none()
        || inner.in_flight.is_some()
        || inner.locked
    {
        return Schedule::Never;
    }
    if inner.force {
        return Schedule::Now;
    }
    if inner.error == Some(FetchError::Unauthorized) {
        return Schedule::Never;
    }
    match inner.due_at_ms {
        Some(due) if due > now => Schedule::At(due),
        _ => Schedule::Now,
    }
}

fn snapshot_of(inner: &Inner) -> CodeHostingSnapshot {
    CodeHostingSnapshot {
        enabled: inner.settings.enabled,
        account: inner.account.clone(),
        pull_requests: inner.pull_requests.clone(),
        fetched_at_ms: inner.fetched_at_ms,
        fetching: inner.in_flight.is_some(),
        error: inner.error,
    }
}

/// The strip notices one poll earns, newest change first and at most [`NOTICES_PER_POLL`]
/// (docs/modules/code-hosting.md "Strip"): a pull request that newly asks for the user's
/// review, and checks that finished on one they opened.
#[must_use]
pub fn notices_for(
    previous: &[PullRequest],
    next: &[PullRequest],
    settings: NoticeSettings,
) -> Vec<Notice> {
    let mut notices = Vec::new();
    for row in next {
        let before = previous.iter().find(|candidate| candidate.id == row.id);
        if settings.review_requested
            && row.review_requested
            && !row.mine
            && !before.is_some_and(|before| before.review_requested)
        {
            notices.push(Notice {
                id: format!("{ID}:review:{}", row.id),
                module: ID.to_owned(),
                priority: priority::CODE_HOSTING,
                leading: Some(Leading::Icon {
                    glyph: Glyph::PullRequest,
                    tint: Some(Tint::Purple),
                }),
                trailing: None,
                wide: Some(StripMessage::ReviewRequested {
                    title: row.title.clone(),
                }),
                hold_ms: 0,
            });
        }
        if settings.checks_finished
            && row.mine
            && before.is_some_and(|before| before.checks == ChecksState::Pending)
            && matches!(row.checks, ChecksState::Success | ChecksState::Failure)
        {
            let passed = row.checks == ChecksState::Success;
            notices.push(Notice {
                id: format!("{ID}:checks:{}", row.id),
                module: ID.to_owned(),
                priority: priority::CODE_HOSTING,
                leading: Some(Leading::Icon {
                    glyph: if passed {
                        Glyph::CheckCircle
                    } else {
                        Glyph::XCircle
                    },
                    tint: Some(if passed { Tint::Green } else { Tint::Red }),
                }),
                trailing: None,
                wide: Some(StripMessage::ChecksFinished {
                    title: row.title.clone(),
                    passed,
                }),
                hold_ms: 0,
            });
        }
    }
    notices.truncate(NOTICES_PER_POLL);
    notices
}

/// The wait after the `attempt`th consecutive failure: 2, 4, 8, 16 minutes, then half an
/// hour.
#[must_use]
pub fn backoff(attempt: u32) -> Duration {
    let doublings = attempt.saturating_sub(1).min(8);
    (POLL * 2u32.pow(doublings)).min(RETRY_MAX)
}

fn duration_ms(duration: Duration) -> i64 {
    i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
}

fn unix_ms(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

/// The backend: runs the poll loop and pauses it while the session is locked.
#[derive(Debug, Clone)]
pub struct CodeHostingModule(pub Arc<CodeHostingService>);

impl ModuleBackend for CodeHostingModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Strip, Surface::Panel, Surface::Widget]
    }

    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()> {
        let service = Arc::clone(&self.0);
        tauri::async_runtime::spawn(async move {
            loop {
                match service.next_wake() {
                    None => service.wake.notified().await,
                    Some(wait) if !wait.is_zero() => {
                        tokio::select! {
                            () = tokio::time::sleep(wait) => {}
                            () = service.wake.notified() => {}
                        }
                    }
                    Some(_) => {}
                }
                let Some(job) = service.plan() else {
                    continue;
                };
                let result = service.provider.fetch(job.token.0).await;
                service.complete_poll(result);
            }
        });
        let service = Arc::clone(&self.0);
        let mut events = ctx.platform.subscribe();
        tauri::async_runtime::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(muna_platform::PlatformEvent::SessionLockChanged { locked }) => {
                        service.set_locked(locked);
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "code hosting events lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        Ok(())
    }
}
