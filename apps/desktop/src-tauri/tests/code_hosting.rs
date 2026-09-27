//! The `code-hosting` module against `FakePlatform` and a scripted code host
//! (docs/modules/code-hosting.md acceptance criteria, docs/build-plan/m4-power-tools.md E4).
//! Integration tests because the `muna` lib cannot host unit tests (Common Controls manifest
//! on Tauri-linked tests).
//!
//! The service is a reducer: the tests call `plan` and hand the outcome to `complete_poll` in
//! place of the backend loop, so every branch runs without a network or a runtime.

use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use muna_core::{
    Clock, FakeClock, Glyph, Hub, Leading, Settings, Store, StripContent, StripMessage, StripSink,
    Tint, activities::priority,
};
use muna_lib::modules::code_hosting::provider::{BoxFuture, MAX_TOKEN_CHARS, parse_queue};
use muna_lib::modules::code_hosting::{
    Account, CACHE_KEY, ChecksState, CodeHost, CodeHostError, CodeHostingCommand,
    CodeHostingService, CodeHostingSettings, CodeHostingSink, CodeHostingSnapshot, ConnectError,
    ID, Job, NOTICES_PER_POLL, NoticeSettings, POLL, Provider, PullRequest, Queue, RETRY_MAX,
    ReviewDecision, TOKEN_KEY, Token, TokenError, backoff, normalise_token, notices_for,
};
use muna_lib::modules::{ModuleServices, Surface, backends};
use muna_platform::{FakePlatform, Platform};
use parking_lot::Mutex;

const QUEUE_JSON: &str = include_str!("fixtures/github-queue.json");
const START_SECS: u64 = 1_790_000_000;
const TOKEN: &str = "ghp_examplevalue0123456789abcdefghijklmnop";

/// A host that never makes a request: answers are scripted, newest last; the token of every
/// call is recorded so the tests can check what was sent (and that nothing was).
struct StubHost {
    answers: Mutex<Vec<Result<Queue, CodeHostError>>>,
    tokens: Mutex<Vec<String>>,
}

impl StubHost {
    fn new() -> Self {
        Self {
            answers: Mutex::new(Vec::new()),
            tokens: Mutex::new(Vec::new()),
        }
    }

    fn script(&self, answer: Result<Queue, CodeHostError>) {
        self.answers.lock().push(answer);
    }
}

impl CodeHost for StubHost {
    fn fetch(&self, token: String) -> BoxFuture<'_, Result<Queue, CodeHostError>> {
        self.tokens.lock().push(token);
        let answer = self
            .answers
            .lock()
            .pop()
            .unwrap_or(Err(CodeHostError::Offline));
        Box::pin(async move { answer })
    }

    fn name(&self) -> &'static str {
        "stub"
    }
}

#[derive(Default)]
struct Recorder {
    snapshots: Mutex<Vec<CodeHostingSnapshot>>,
    strip: Mutex<Vec<StripContent>>,
}

impl CodeHostingSink for Recorder {
    fn changed(&self, snapshot: &CodeHostingSnapshot) {
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
    store: Arc<Store>,
    host: Arc<StubHost>,
    service: Arc<CodeHostingService>,
    recorder: Arc<Recorder>,
}

impl Rig {
    fn new() -> Self {
        Self::with(
            Arc::new(Store::open_in_memory().expect("store")),
            Arc::new(FakePlatform::new()),
            Duration::ZERO,
        )
    }

    /// A fresh service over an existing store and platform, `later` after the usual start:
    /// "the next launch".
    fn with(store: Arc<Store>, platform: Arc<FakePlatform>, later: Duration) -> Self {
        let clock = Arc::new(FakeClock::at(
            UNIX_EPOCH + Duration::from_secs(START_SECS) + later,
        ));
        let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
        let host = Arc::new(StubHost::new());
        let service = Arc::new(CodeHostingService::new(
            Arc::clone(&platform) as Arc<dyn Platform>,
            Arc::clone(&hub),
            Arc::clone(&store),
            Arc::clone(&clock) as Arc<dyn Clock>,
            Arc::clone(&host) as Arc<dyn CodeHost>,
        ));
        let recorder = Arc::new(Recorder::default());
        service.set_sink(Arc::clone(&recorder) as Arc<dyn CodeHostingSink>);
        hub.add_sink(Arc::clone(&recorder) as Arc<dyn StripSink>);
        Self {
            clock,
            platform,
            hub,
            store,
            host,
            service,
            recorder,
        }
    }

    fn apply(&self, settings: CodeHostingSettings) {
        let mut document = Settings::default();
        settings.write(&mut document).expect("settings serialise");
        self.service.apply_settings(&document);
    }

    fn enable(&self) {
        self.apply(CodeHostingSettings {
            enabled: true,
            ..CodeHostingSettings::default()
        });
    }

    /// Turns the module on and connects with the fixture queue: the usual starting point.
    fn connected() -> Self {
        let rig = Self::new();
        rig.enable();
        rig.host.script(Ok(fixture()));
        block_on(rig.service.connect(TOKEN)).expect("connects");
        rig
    }

    fn now_ms(&self) -> i64 {
        i64::try_from(
            self.clock
                .system_time()
                .duration_since(UNIX_EPOCH)
                .expect("after the epoch")
                .as_millis(),
        )
        .expect("fits")
    }

    /// Lets time pass the way the loop's sleep would.
    fn pass(&self, by: Duration) {
        self.clock.advance(by);
        self.hub.refresh();
    }

    /// What the backend loop does for a `Job`: hand the scripted answer over.
    fn poll(&self, answer: Result<Queue, CodeHostError>) -> Job {
        let job = self.service.plan().expect("a poll is due");
        self.service.complete_poll(answer);
        job
    }

    fn snapshot(&self) -> CodeHostingSnapshot {
        self.service.snapshot()
    }

    /// Every notice the strip showed, in order.
    fn notices(&self) -> Vec<muna_core::Notice> {
        self.recorder
            .strip
            .lock()
            .iter()
            .filter_map(|content| match content {
                StripContent::Notice { notice } => Some(notice.clone()),
                StripContent::Idle | StripContent::Activity { .. } => None,
            })
            .collect()
    }
}

/// A tiny executor for futures that are already complete (the stub's are).
fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    use std::pin::pin;
    use std::task::{Context, Poll, Waker};
    let mut context = Context::from_waker(Waker::noop());
    let mut future = pin!(future);
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
    }
}

fn ms(duration: Duration) -> i64 {
    i64::try_from(duration.as_millis()).expect("fits")
}

fn fixture() -> Queue {
    parse_queue(QUEUE_JSON).expect("fixture parses")
}

fn row(queue: &Queue, id: &str) -> PullRequest {
    queue
        .pull_requests
        .iter()
        .find(|row| row.id == id)
        .cloned()
        .unwrap_or_else(|| panic!("{id} listed"))
}

fn ids(rows: &[PullRequest]) -> Vec<&str> {
    rows.iter().map(|row| row.id.as_str()).collect()
}

/// A pull request somebody else opened and asked the user to review.
fn requested(id: &str, title: &str, updated_at_ms: i64) -> PullRequest {
    PullRequest {
        id: id.into(),
        provider: Provider::GitHub,
        repo: "octo-org/app".into(),
        number: 1,
        title: title.into(),
        url: format!("https://github.com/octo-org/app/pull/{id}"),
        author: "hubot".into(),
        author_avatar_url: None,
        draft: false,
        additions: 10,
        deletions: 2,
        changed_files: 3,
        checks: ChecksState::Pending,
        review_decision: ReviewDecision::ReviewRequired,
        updated_at_ms,
        review_requested: true,
        mine: false,
    }
}

// --- provider parsing ----------------------------------------------------------------------

#[test]
fn parse_queue_merges_both_lists_newest_first_and_skips_what_is_not_a_pull_request() {
    let queue = fixture();
    assert_eq!(
        queue.account,
        Account {
            provider: Provider::GitHub,
            login: "octocat".into(),
            avatar_url: Some("https://avatars.githubusercontent.com/u/583231?v=4".into()),
        }
    );
    assert_eq!(
        ids(&queue.pull_requests),
        ["PR_kwDOD4", "PR_kwDOA1", "PR_kwDOC3", "PR_kwDOB2"],
        "one row per pull request, newest update first; the null and the issue are skipped"
    );

    let snap = row(&queue, "PR_kwDOA1");
    assert_eq!(snap.repo, "miklol/Muna");
    assert_eq!(snap.number, 41);
    assert_eq!(
        snap.title,
        "feat(window-snap): snap zones for dragged windows"
    );
    assert_eq!(snap.url, "https://github.com/miklol/Muna/pull/41");
    assert_eq!(snap.author, "copilot-app");
    assert_eq!(
        (snap.additions, snap.deletions, snap.changed_files),
        (5041, 69, 65)
    );
    assert_eq!(snap.checks, ChecksState::Failure);
    assert_eq!(snap.review_decision, ReviewDecision::ReviewRequired);
    assert!(snap.review_requested && !snap.mine);
    assert!(!snap.draft);

    let infra = row(&queue, "PR_kwDOB2");
    assert!(infra.draft);
    assert_eq!(infra.checks, ChecksState::None, "no rollup means no checks");
    assert_eq!(infra.review_decision, ReviewDecision::None);
    assert_eq!(infra.author_avatar_url, None);

    let shared = row(&queue, "PR_kwDOC3");
    assert!(
        shared.review_requested && shared.mine,
        "a pull request in both lists is one row with both flags"
    );
    assert_eq!(shared.checks, ChecksState::Success);
    assert_eq!(shared.review_decision, ReviewDecision::Approved);

    let mine = row(&queue, "PR_kwDOD4");
    assert!(mine.mine && !mine.review_requested);
    assert_eq!(mine.checks, ChecksState::Pending);
    assert_eq!(mine.review_decision, ReviewDecision::ChangesRequested);
    assert_eq!(
        mine.updated_at_ms, 1_790_503_530_000,
        "2026-09-27T10:05:30Z"
    );
}

#[test]
fn parse_queue_maps_answers_without_data_to_one_error_each() {
    assert_eq!(
        parse_queue(r#"{"errors":[{"type":"RATE_LIMITED","message":"slow down"}]}"#),
        Err(CodeHostError::RateLimited)
    );
    assert_eq!(
        parse_queue(r#"{"data":null,"errors":[{"type":"FORBIDDEN","message":"no"}]}"#),
        Err(CodeHostError::Unauthorized)
    );
    assert_eq!(
        parse_queue(r#"{"errors":[{"message":"Something went wrong"}]}"#),
        Err(CodeHostError::Provider)
    );
    assert_eq!(parse_queue("<!doctype html>"), Err(CodeHostError::Provider));
    assert_eq!(parse_queue(r#"{"data":{}}"#), Err(CodeHostError::Provider));
}

#[test]
fn tokens_are_trimmed_and_checked_before_anything_is_sent() {
    assert_eq!(normalise_token("  ghp_abc \n"), Ok("ghp_abc".into()));
    assert_eq!(normalise_token("   "), Err(TokenError::Empty));
    assert_eq!(normalise_token("ghp abc"), Err(TokenError::Malformed));
    assert_eq!(normalise_token("ghp_ábc"), Err(TokenError::Malformed));
    assert_eq!(normalise_token("ghp\"abc"), Err(TokenError::Malformed));
    assert_eq!(
        normalise_token(&"x".repeat(MAX_TOKEN_CHARS + 1)),
        Err(TokenError::Malformed)
    );
    assert!(normalise_token(&"x".repeat(MAX_TOKEN_CHARS)).is_ok());
}

#[test]
fn a_job_never_prints_its_token() {
    let job = Job {
        token: Token(TOKEN.into()),
    };
    let printed = format!("{job:?}");
    assert!(!printed.contains(TOKEN), "{printed}");
    assert!(printed.contains("Token(…)"), "{printed}");
}

#[test]
fn backoff_doubles_from_one_poll_to_half_an_hour() {
    assert_eq!(backoff(1), POLL);
    assert_eq!(backoff(2), POLL * 2);
    assert_eq!(backoff(3), POLL * 4);
    assert_eq!(backoff(4), POLL * 8);
    assert_eq!(backoff(5), RETRY_MAX);
    assert_eq!(backoff(40), RETRY_MAX);
}

#[test]
fn settings_read_with_defaults_and_survive_a_malformed_entry() {
    let defaults = CodeHostingSettings::default();
    assert!(!defaults.enabled, "off until the user turns it on");
    assert!(defaults.notices.review_requested && defaults.notices.checks_finished);

    let mut document = Settings::default();
    assert_eq!(CodeHostingSettings::from_document(&document), defaults);

    let wanted = CodeHostingSettings {
        enabled: true,
        notices: NoticeSettings {
            review_requested: false,
            checks_finished: true,
        },
    };
    wanted.write(&mut document).expect("serialises");
    assert_eq!(CodeHostingSettings::from_document(&document), wanted);
    assert!(
        document.modules[CodeHostingSettings::KEY]
            .get("token")
            .is_none(),
        "the token is never part of the settings document"
    );

    document.modules.insert(
        CodeHostingSettings::KEY.to_owned(),
        serde_json::json!(["on"]),
    );
    assert_eq!(CodeHostingSettings::from_document(&document), defaults);
}

// --- switch and connect --------------------------------------------------------------------

#[test]
fn off_by_default_nothing_is_planned() {
    let rig = Rig::new();
    rig.apply(CodeHostingSettings::default());
    assert!(!rig.snapshot().enabled);
    assert_eq!(rig.service.next_wake(), None);
    assert_eq!(rig.service.plan(), None);
    assert!(rig.host.tokens.lock().is_empty(), "no request while off");
}

#[test]
fn turning_on_without_a_token_shows_connect_and_polls_nothing() {
    let rig = Rig::new();
    rig.enable();
    let snapshot = rig.snapshot();
    assert!(snapshot.enabled);
    assert_eq!(snapshot.account, None);
    assert!(snapshot.pull_requests.is_empty());
    assert_eq!(rig.service.next_wake(), None);
    assert!(rig.host.tokens.lock().is_empty());
}

#[test]
fn connect_checks_the_token_keeps_it_in_the_vault_and_adopts_the_queue() {
    let rig = Rig::new();
    rig.enable();
    rig.host.script(Ok(fixture()));

    let snapshot = block_on(rig.service.connect(&format!("  {TOKEN}\n"))).expect("connects");
    assert_eq!(
        rig.host.tokens.lock().as_slice(),
        [TOKEN],
        "the trimmed token was sent once, to check it"
    );
    assert_eq!(rig.platform.secret(TOKEN_KEY).as_deref(), Some(TOKEN));
    assert_eq!(
        snapshot.account.as_ref().map(|a| a.login.as_str()),
        Some("octocat")
    );
    assert_eq!(snapshot.pull_requests.len(), 4);
    assert_eq!(snapshot.fetched_at_ms, Some(rig.now_ms()));
    assert_eq!(snapshot.error, None);
    assert!(!snapshot.fetching);
    assert_eq!(rig.snapshot(), snapshot);
    assert!(
        rig.store.get_meta(CACHE_KEY).expect("store").is_some(),
        "the queue is cached for the next launch"
    );
    assert!(
        rig.notices().is_empty(),
        "the first list is the baseline, not news"
    );
    assert_eq!(
        rig.service.next_wake(),
        Some(POLL),
        "the first poll is one period away"
    );
}

#[test]
fn connect_is_refused_while_off_without_a_request() {
    let rig = Rig::new();
    rig.apply(CodeHostingSettings::default());
    assert_eq!(
        block_on(rig.service.connect(TOKEN)),
        Err(ConnectError::Disabled)
    );
    assert!(rig.host.tokens.lock().is_empty());
    assert_eq!(rig.platform.secret(TOKEN_KEY), None);
}

#[test]
fn connect_with_a_blank_or_malformed_token_sends_nothing() {
    let rig = Rig::new();
    rig.enable();
    assert_eq!(
        block_on(rig.service.connect("   ")),
        Err(ConnectError::Token(TokenError::Empty))
    );
    assert_eq!(
        block_on(rig.service.connect("ghp abc")),
        Err(ConnectError::Token(TokenError::Malformed))
    );
    assert!(rig.host.tokens.lock().is_empty());
    assert_eq!(rig.platform.secret(TOKEN_KEY), None);
    assert_eq!(rig.snapshot().account, None);
}

#[test]
fn a_refused_or_unanswered_connect_keeps_nothing() {
    let rig = Rig::new();
    rig.enable();
    for (answer, expected) in [
        (
            CodeHostError::Unauthorized,
            ConnectError::Fetch(CodeHostError::Unauthorized),
        ),
        (
            CodeHostError::Offline,
            ConnectError::Fetch(CodeHostError::Offline),
        ),
        (
            CodeHostError::RateLimited,
            ConnectError::Fetch(CodeHostError::RateLimited),
        ),
        (
            CodeHostError::Provider,
            ConnectError::Fetch(CodeHostError::Provider),
        ),
    ] {
        rig.host.script(Err(answer));
        assert_eq!(block_on(rig.service.connect(TOKEN)), Err(expected));
        assert_eq!(rig.platform.secret(TOKEN_KEY), None, "{answer:?}");
        assert_eq!(rig.snapshot().account, None, "{answer:?}");
        assert_eq!(
            rig.snapshot().error,
            None,
            "a failed connect is the pane's, not the panel's"
        );
    }
    assert_eq!(rig.host.tokens.lock().len(), 4);
}

#[test]
fn a_vault_that_refuses_the_token_fails_the_connect() {
    let rig = Rig::new();
    rig.enable();
    rig.platform.set_secrets_unavailable(true);
    rig.host.script(Ok(fixture()));
    assert_eq!(
        block_on(rig.service.connect(TOKEN)),
        Err(ConnectError::Vault)
    );
    assert_eq!(rig.snapshot().account, None);
    assert_eq!(rig.service.next_wake(), None);
}

// --- polling -------------------------------------------------------------------------------

#[test]
fn polls_every_two_minutes_with_the_vaulted_token_and_a_new_review_request_is_a_notice() {
    let rig = Rig::connected();
    assert_eq!(rig.service.plan(), None, "not due yet");

    rig.pass(POLL);
    assert_eq!(rig.service.next_wake(), Some(Duration::ZERO));
    let mut next = fixture();
    next.pull_requests.insert(
        0,
        requested("PR_new", "Add the review queue widget", rig.now_ms()),
    );
    let job = rig.poll(Ok(next));
    assert_eq!(
        job.token,
        Token(TOKEN.into()),
        "the token is read from the vault"
    );

    let snapshot = rig.snapshot();
    assert_eq!(snapshot.pull_requests.len(), 5);
    assert_eq!(snapshot.fetched_at_ms, Some(rig.now_ms()));
    assert!(!snapshot.fetching);
    assert_eq!(rig.service.next_wake(), Some(POLL));

    let notices = rig.notices();
    assert_eq!(notices.len(), 1, "{notices:?}");
    let notice = &notices[0];
    assert_eq!(notice.id, format!("{ID}:review:PR_new"));
    assert_eq!(notice.module, ID);
    assert_eq!(notice.priority, priority::CODE_HOSTING);
    assert_eq!(
        notice.leading,
        Some(Leading::Icon {
            glyph: Glyph::PullRequest,
            tint: Some(Tint::Purple),
        })
    );
    assert_eq!(
        notice.wide,
        Some(StripMessage::ReviewRequested {
            title: "Add the review queue widget".into(),
        })
    );
    assert!(
        rig.recorder
            .snapshots
            .lock()
            .iter()
            .any(|snapshot| snapshot.fetching),
        "the panel saw the request in flight"
    );
}

#[test]
fn checks_finishing_on_my_pull_request_is_a_notice_either_way() {
    let rig = Rig::connected();

    rig.pass(POLL);
    let mut passed = fixture();
    passed
        .pull_requests
        .iter_mut()
        .find(|row| row.id == "PR_kwDOD4")
        .expect("mine")
        .checks = ChecksState::Success;
    rig.poll(Ok(passed.clone()));
    let notices = rig.notices();
    assert_eq!(notices.len(), 1, "{notices:?}");
    assert_eq!(notices[0].id, format!("{ID}:checks:PR_kwDOD4"));
    assert_eq!(
        notices[0].leading,
        Some(Leading::Icon {
            glyph: Glyph::CheckCircle,
            tint: Some(Tint::Green),
        })
    );
    assert_eq!(
        notices[0].wide,
        Some(StripMessage::ChecksFinished {
            title: "feat(code-hosting): github review queue behind a token".into(),
            passed: true,
        })
    );

    // Success again is not news; back to pending and then a failure is.
    rig.pass(POLL);
    rig.poll(Ok(passed.clone()));
    assert_eq!(
        rig.notices().len(),
        1,
        "an unchanged rollup earns no notice"
    );

    let mut pending = passed.clone();
    pending
        .pull_requests
        .iter_mut()
        .find(|row| row.id == "PR_kwDOD4")
        .expect("mine")
        .checks = ChecksState::Pending;
    rig.pass(POLL);
    rig.poll(Ok(pending));
    let mut failed = passed;
    failed
        .pull_requests
        .iter_mut()
        .find(|row| row.id == "PR_kwDOD4")
        .expect("mine")
        .checks = ChecksState::Failure;
    rig.pass(POLL);
    rig.poll(Ok(failed));
    let notices = rig.notices();
    assert_eq!(notices.len(), 2, "{notices:?}");
    assert_eq!(
        notices[1].leading,
        Some(Leading::Icon {
            glyph: Glyph::XCircle,
            tint: Some(Tint::Red),
        })
    );
    assert_eq!(
        notices[1].wide,
        Some(StripMessage::ChecksFinished {
            title: "feat(code-hosting): github review queue behind a token".into(),
            passed: false,
        })
    );
}

#[test]
fn notices_follow_the_settings_and_are_capped_per_poll() {
    let before = fixture().pull_requests;
    let mut after = before.clone();
    for index in 0..5 {
        after.push(requested(
            &format!("PR_n{index}"),
            &format!("Change {index}"),
            i64::from(index),
        ));
    }
    after
        .iter_mut()
        .find(|row| row.id == "PR_kwDOD4")
        .expect("mine")
        .checks = ChecksState::Success;

    let all = notices_for(&before, &after, NoticeSettings::default());
    assert_eq!(all.len(), NOTICES_PER_POLL, "{all:?}");

    let only_checks = notices_for(
        &before,
        &after,
        NoticeSettings {
            review_requested: false,
            checks_finished: true,
        },
    );
    assert_eq!(only_checks.len(), 1);
    assert!(only_checks[0].id.starts_with(&format!("{ID}:checks:")));

    let none = notices_for(
        &before,
        &after,
        NoticeSettings {
            review_requested: false,
            checks_finished: false,
        },
    );
    assert!(none.is_empty());

    // A review request the user already had is not news, nor is one on their own pull request.
    let mut own = after.clone();
    own.retain(|row| row.mine);
    for row in &mut own {
        row.review_requested = true;
    }
    assert!(notices_for(&after, &own, NoticeSettings::default()).is_empty());
    assert!(notices_for(&after, &after, NoticeSettings::default()).is_empty());
}

#[test]
fn failures_back_off_and_keep_the_queue_until_a_poll_works() {
    let rig = Rig::connected();
    let baseline = rig.snapshot().pull_requests;

    rig.pass(POLL);
    rig.poll(Err(CodeHostError::Offline));
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.error, Some(CodeHostError::Offline));
    assert_eq!(snapshot.pull_requests, baseline, "the last queue stands");
    assert_eq!(
        snapshot.fetched_at_ms,
        Some(rig.now_ms() - ms(POLL)),
        "with its own time"
    );
    assert_eq!(rig.service.next_wake(), Some(backoff(1)));

    rig.pass(backoff(1));
    rig.poll(Err(CodeHostError::Provider));
    assert_eq!(rig.snapshot().error, Some(CodeHostError::Provider));
    assert_eq!(rig.service.next_wake(), Some(backoff(2)));

    rig.pass(backoff(2));
    rig.poll(Err(CodeHostError::RateLimited));
    assert_eq!(rig.snapshot().error, Some(CodeHostError::RateLimited));
    assert_eq!(rig.service.next_wake(), Some(backoff(3)));

    rig.pass(backoff(3));
    rig.poll(Ok(fixture()));
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.error, None);
    assert_eq!(snapshot.fetched_at_ms, Some(rig.now_ms()));
    assert_eq!(rig.service.next_wake(), Some(POLL), "the period is back");
    assert!(rig.notices().is_empty(), "the same queue is no news");
}

#[test]
fn a_refused_token_stops_polling_until_refresh_or_reconnect() {
    let rig = Rig::connected();
    rig.pass(POLL);
    rig.poll(Err(CodeHostError::Unauthorized));
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.error, Some(CodeHostError::Unauthorized));
    assert!(
        snapshot.account.is_some(),
        "the pane still names the account"
    );
    assert_eq!(snapshot.pull_requests.len(), 4, "the last queue stands");
    assert_eq!(rig.service.next_wake(), None, "no more polls on their own");
    rig.pass(RETRY_MAX * 4);
    assert_eq!(rig.service.plan(), None);

    // "Refresh" tries once more.
    rig.service.command(CodeHostingCommand::Refresh);
    assert_eq!(rig.service.next_wake(), Some(Duration::ZERO));
    rig.poll(Err(CodeHostError::Unauthorized));
    assert_eq!(rig.service.next_wake(), None);

    // A new token starts over.
    rig.host.script(Ok(fixture()));
    block_on(rig.service.connect("ghp_second")).expect("connects");
    assert_eq!(
        rig.platform.secret(TOKEN_KEY).as_deref(),
        Some("ghp_second")
    );
    assert_eq!(rig.snapshot().error, None);
    assert_eq!(rig.service.next_wake(), Some(POLL));
}

#[test]
fn refresh_polls_now_and_is_ignored_when_there_is_nothing_to_poll() {
    let rig = Rig::new();
    rig.enable();
    rig.service.command(CodeHostingCommand::Refresh);
    assert_eq!(
        rig.service.next_wake(),
        None,
        "no account, nothing to refresh"
    );

    let rig = Rig::connected();
    rig.pass(Duration::from_secs(10));
    assert_eq!(rig.service.plan(), None);
    let snapshot = rig.service.command(CodeHostingCommand::Refresh);
    assert!(
        !snapshot.fetching,
        "the request starts when the loop plans it"
    );
    assert_eq!(rig.service.next_wake(), Some(Duration::ZERO));
    rig.poll(Ok(fixture()));
    assert_eq!(rig.snapshot().fetched_at_ms, Some(rig.now_ms()));
    assert_eq!(
        rig.service.next_wake(),
        Some(POLL),
        "the period restarts from the refresh"
    );
}

#[test]
fn a_locked_session_pauses_polling_and_an_unlock_resumes_it() {
    let rig = Rig::connected();
    rig.service.set_locked(true);
    rig.pass(POLL * 3);
    assert_eq!(rig.service.next_wake(), None);
    assert_eq!(rig.service.plan(), None);
    rig.service.set_locked(false);
    assert_eq!(
        rig.service.next_wake(),
        Some(Duration::ZERO),
        "overdue: poll at once"
    );
    rig.poll(Ok(fixture()));
    assert_eq!(rig.snapshot().error, None);
}

#[test]
fn a_token_removed_from_the_vault_ends_polling() {
    let rig = Rig::connected();
    rig.platform
        .secrets()
        .remove(TOKEN_KEY)
        .expect("fake vault");
    rig.pass(POLL);
    assert_eq!(rig.service.plan(), None, "nothing to send");
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.error, Some(CodeHostError::Unauthorized));
    assert_eq!(rig.service.next_wake(), None);
    assert!(
        rig.host.tokens.lock().len() == 1,
        "only the connect's check was sent"
    );
}

#[test]
fn a_poll_that_outlives_its_account_is_dropped() {
    let rig = Rig::connected();
    rig.pass(POLL);
    let job = rig.service.plan().expect("due");
    assert_eq!(job.token, Token(TOKEN.into()));
    assert!(rig.snapshot().fetching);

    let snapshot = rig.service.disconnect();
    assert_eq!(snapshot.account, None);
    assert!(!snapshot.fetching, "a disconnect forgets the request too");

    rig.service.complete_poll(Ok(fixture()));
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.account, None, "the stale answer changed nothing");
    assert!(snapshot.pull_requests.is_empty());
    assert!(rig.notices().is_empty());
}

// --- switch off, disconnect, restart -------------------------------------------------------

#[test]
fn turning_off_stops_polling_and_drops_the_queue_but_keeps_the_token_for_next_time() {
    let rig = Rig::connected();
    rig.apply(CodeHostingSettings::default());
    let snapshot = rig.snapshot();
    assert!(!snapshot.enabled);
    assert_eq!(snapshot.account, None);
    assert!(snapshot.pull_requests.is_empty());
    assert_eq!(rig.service.next_wake(), None);
    assert_eq!(
        rig.platform.secret(TOKEN_KEY).as_deref(),
        Some(TOKEN),
        "the token stays"
    );
    assert!(
        rig.store.get_meta(CACHE_KEY).expect("store").is_some(),
        "so does the cache"
    );

    rig.pass(Duration::from_secs(30));
    rig.enable();
    let snapshot = rig.snapshot();
    assert_eq!(
        snapshot.account.as_ref().map(|a| a.login.as_str()),
        Some("octocat"),
        "back on: the cached queue is shown at once"
    );
    assert_eq!(snapshot.pull_requests.len(), 4);
    assert_eq!(snapshot.fetched_at_ms, Some(rig.now_ms() - 30_000));
    assert_eq!(
        rig.service.next_wake(),
        Some(POLL.saturating_sub(Duration::from_secs(30))),
        "the next poll is due when it was"
    );
}

#[test]
fn disconnect_forgets_the_token_the_account_and_the_cache() {
    let rig = Rig::connected();
    let snapshot = rig.service.disconnect();
    assert_eq!(snapshot.account, None);
    assert!(snapshot.pull_requests.is_empty());
    assert_eq!(snapshot.fetched_at_ms, None);
    assert_eq!(snapshot.error, None);
    assert!(
        snapshot.enabled,
        "the switch is the user's; only the account went"
    );
    assert_eq!(rig.platform.secret(TOKEN_KEY), None);
    assert_eq!(rig.store.get_meta(CACHE_KEY).expect("store"), None);
    assert_eq!(rig.service.next_wake(), None);
    assert_eq!(rig.service.url_for("PR_kwDOA1"), None);
}

#[test]
fn the_next_launch_restores_the_cached_queue_and_compares_against_it() {
    let first = Rig::connected();
    let store = Arc::clone(&first.store);
    let platform = Arc::clone(&first.platform);
    drop(first);

    let rig = Rig::with(store, platform, Duration::from_secs(45));
    rig.enable();
    let snapshot = rig.snapshot();
    assert_eq!(
        snapshot.account.as_ref().map(|a| a.login.as_str()),
        Some("octocat")
    );
    assert_eq!(ids(&snapshot.pull_requests), ids(&fixture().pull_requests));
    assert_eq!(snapshot.fetched_at_ms, Some(rig.now_ms() - 45_000));
    assert_eq!(
        rig.service.next_wake(),
        Some(POLL.saturating_sub(Duration::from_secs(45)))
    );
    assert!(
        rig.host.tokens.lock().is_empty(),
        "nothing sent before the poll is due"
    );

    rig.pass(POLL);
    let mut next = fixture();
    next.pull_requests
        .push(requested("PR_late", "Late request", 1));
    rig.poll(Ok(next));
    let notices = rig.notices();
    assert_eq!(
        notices.len(),
        1,
        "the cached queue is the baseline: {notices:?}"
    );
    assert_eq!(notices[0].id, format!("{ID}:review:PR_late"));
}

#[test]
fn the_next_launch_without_the_token_drops_the_cache_and_asks_to_connect() {
    let first = Rig::connected();
    let store = Arc::clone(&first.store);
    let platform = Arc::clone(&first.platform);
    drop(first);
    platform.secrets().remove(TOKEN_KEY).expect("fake vault");

    let rig = Rig::with(store, platform, Duration::from_secs(5));
    rig.enable();
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.account, None);
    assert!(snapshot.pull_requests.is_empty());
    assert_eq!(rig.store.get_meta(CACHE_KEY).expect("store"), None);
    assert_eq!(rig.service.next_wake(), None);
}

#[test]
fn a_token_without_a_cache_polls_for_the_account_at_once() {
    let rig = Rig::new();
    rig.platform
        .secrets()
        .set(TOKEN_KEY, TOKEN)
        .expect("fake vault");
    rig.enable();
    let snapshot = rig.snapshot();
    assert!(snapshot.account.is_some(), "connected, name unknown yet");
    assert_eq!(rig.service.next_wake(), Some(Duration::ZERO));
    rig.poll(Ok(fixture()));
    assert_eq!(
        rig.snapshot().account.as_ref().map(|a| a.login.as_str()),
        Some("octocat")
    );
    assert!(rig.notices().is_empty(), "the first queue is the baseline");
}

// --- open ----------------------------------------------------------------------------------

#[test]
fn open_resolves_only_listed_pull_requests() {
    let rig = Rig::connected();
    assert_eq!(
        rig.service.url_for("PR_kwDOA1").as_deref(),
        Some("https://github.com/miklol/Muna/pull/41")
    );
    assert_eq!(rig.service.url_for("PR_nope"), None);
    assert_eq!(rig.service.url_for(""), None);
}

// --- registry ------------------------------------------------------------------------------

#[test]
fn the_backend_registers_with_the_strip_the_panel_and_a_widget() {
    let clock: Arc<dyn Clock> =
        Arc::new(FakeClock::at(UNIX_EPOCH + Duration::from_secs(START_SECS)));
    let platform: Arc<dyn Platform> = Arc::new(FakePlatform::new());
    let hub = Arc::new(Hub::new(Arc::clone(&clock)));
    let store = Arc::new(Store::open_in_memory().expect("store"));
    let services = ModuleServices::new(&platform, &hub, None, &store, &clock);
    let backend = backends(&services)
        .into_iter()
        .find(|backend| backend.id() == ID)
        .expect("registered");
    assert_eq!(
        backend.capabilities(),
        [Surface::Strip, Surface::Panel, Surface::Widget]
    );
    assert!(!services.code_hosting.snapshot().enabled);
    assert_eq!(services.code_hosting.next_wake(), None);
}
