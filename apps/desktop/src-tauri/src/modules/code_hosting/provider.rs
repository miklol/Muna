//! Where the review queue comes from (docs/modules/code-hosting.md "Providers"): GitHub's
//! GraphQL API with a personal access token, one adapter behind a trait so the service is
//! tested with scripted queues and no network, and another host (GitLab, Bitbucket) can be
//! slotted in later behind the same trait.
//!
//! Nothing here runs unless the user turned the module on and connected an account: the
//! service only calls the provider from its poll loop and from *Connect*, both of which check
//! `settings.modules["code-hosting"].enabled` first. One request per poll asks for the pull
//! requests that want the user's review and the ones they opened, with the check rollup of
//! each; the token goes in the `Authorization` header and nowhere else, and is never logged.
//!
//! The device flow (spike S4) needs an OAuth client id from the maintainer; until then a token
//! the user pastes is the only sign-in, and this trait is where the flow will plug in.

use std::future::Future;
use std::pin::Pin;
use std::sync::OnceLock;
use std::time::Duration;

use muna_core::Int53;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Where the queue is asked for; the host is the whole allow-list.
pub const GRAPHQL_ENDPOINT: &str = "https://api.github.com/graphql";
/// Where "Create a token" sends the user: a classic token with the `repo` scope, which is
/// what private pull requests and their checks need.
pub const NEW_TOKEN_URL: &str =
    "https://github.com/settings/tokens/new?description=Muna%20review%20queue&scopes=repo";
/// How long one request may take before it counts as offline.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// How many pull requests each list carries at most; the panel is a queue, not a search.
pub const PAGE_SIZE: usize = 25;
/// The largest response read; a page of pull requests is a few tens of kilobytes.
pub const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
/// The longest token accepted. GitHub's are 40 (classic) to 93 (fine-grained) characters.
pub const MAX_TOKEN_CHARS: usize = 255;

const USER_AGENT: &str = concat!(
    "Muna/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/miklol/Muna)"
);

/// The one query every poll sends: the account (so *Connect* can name it), then the two
/// lists. `archived:false` keeps read-only repositories out; drafts stay in, flagged.
pub const QUERY: &str = "\
query MunaQueue($toReview: String!, $mine: String!, $first: Int!) {
  viewer { login avatarUrl }
  toReview: search(query: $toReview, type: ISSUE, first: $first) {
    issueCount
    nodes { ...pr }
  }
  mine: search(query: $mine, type: ISSUE, first: $first) {
    issueCount
    nodes { ...pr }
  }
}
fragment pr on PullRequest {
  id number title url isDraft updatedAt additions deletions changedFiles reviewDecision
  repository { nameWithOwner }
  author { login avatarUrl }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}";
pub const TO_REVIEW_SEARCH: &str = "is:pr is:open archived:false review-requested:@me";
pub const MINE_SEARCH: &str = "is:pr is:open archived:false author:@me";

/// Why a poll or a *Connect* did not produce a queue. Never carries what the host said: the
/// UI has one sentence per case.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum FetchError {
    /// No connection, a DNS failure or a timeout: the last queue stands with its time.
    #[error("the code host could not be reached")]
    Offline,
    /// The host refused the token (401, or a 403 that is not the rate limit): it expired or
    /// was revoked. Polling stops until the user connects again.
    #[error("the code host no longer accepts the token")]
    Unauthorized,
    /// The host asked for a pause (403 or 429 with the rate-limit headers): the next poll
    /// waits longer.
    #[error("the code host asked for a pause")]
    RateLimited,
    /// The host answered, but not with a queue (an error status, GraphQL errors without data,
    /// a shape this build does not understand).
    #[error("the code host answered with something unexpected")]
    Provider,
}

/// A code host this build talks to. Closed on purpose, like the strip glyphs: the UI maps
/// each to a chip and a logo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Provider {
    GitHub,
}

/// Where the checks on a pull request's last commit stand, as GitHub's status check rollup
/// reports them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ChecksState {
    /// No checks run on this repository.
    None,
    /// Running, queued or expected.
    Pending,
    Success,
    /// A failed or errored check.
    Failure,
}

/// The review decision on a pull request, as GitHub computes it from the required reviews.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ReviewDecision {
    /// The repository requires no review, or nobody has reviewed yet.
    None,
    ReviewRequired,
    Approved,
    ChangesRequested,
}

/// The connected account, as the settings pane names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub provider: Provider,
    pub login: String,
    pub avatar_url: Option<String>,
}

/// One row of the queue (docs/modules/code-hosting.md "Reference"). The title, the author and
/// the repository name are content and are never logged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    /// The host's node id; stable for the life of the pull request.
    pub id: String,
    pub provider: Provider,
    /// `owner/name`.
    pub repo: String,
    pub number: u32,
    pub title: String,
    /// The web page; the only thing `code_hosting_open` hands to the browser.
    pub url: String,
    pub author: String,
    pub author_avatar_url: Option<String>,
    pub draft: bool,
    pub additions: u32,
    pub deletions: u32,
    pub changed_files: u32,
    pub checks: ChecksState,
    pub review_decision: ReviewDecision,
    /// The last update the host saw, Unix milliseconds; the list is newest first.
    #[specta(type = Int53)]
    pub updated_at_ms: i64,
    /// The user's review was asked for.
    pub review_requested: bool,
    /// The user opened it.
    pub mine: bool,
}

/// What one poll returns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Queue {
    pub account: Account,
    /// Both lists merged, one row per pull request, newest first.
    pub pull_requests: Vec<PullRequest>,
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// A code host. Async because the real one waits on the network; the service keeps its own
/// reasoning synchronous and only awaits at the edge.
pub trait CodeHost: Send + Sync {
    /// The account and its queue for `token`.
    fn fetch(&self, token: String) -> BoxFuture<'_, Result<Queue, FetchError>>;
    /// For diagnostics.
    fn name(&self) -> &'static str;
}

impl std::fmt::Debug for dyn CodeHost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CodeHost")
            .field("name", &self.name())
            .finish()
    }
}

/// Why a pasted token was not sent anywhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TokenError {
    #[error("the token is empty")]
    Empty,
    /// Spaces, line breaks, non-ASCII: not a token, and not a valid header value.
    #[error("the token has characters a token cannot have")]
    Malformed,
}

/// The token as it is stored and sent: trimmed and checked to be a header value. Never logs
/// its argument.
pub fn normalise_token(input: &str) -> Result<String, TokenError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(TokenError::Empty);
    }
    if trimmed.len() > MAX_TOKEN_CHARS
        || !trimmed
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && byte != b'"' && byte != b'\\')
    {
        return Err(TokenError::Malformed);
    }
    Ok(trimmed.to_owned())
}

/// The GitHub adapter. The HTTP client is built on first use so constructing the module (and
/// the app state in tests) touches nothing.
#[derive(Debug, Default)]
pub struct GitHub {
    client: OnceLock<Option<reqwest::Client>>,
}

impl GitHub {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn client(&self) -> Result<&reqwest::Client, FetchError> {
        self.client
            .get_or_init(|| {
                reqwest::Client::builder()
                    .user_agent(USER_AGENT)
                    .timeout(REQUEST_TIMEOUT)
                    .build()
                    .map_err(|error| {
                        tracing::warn!(%error, "code hosting http client unavailable");
                        error
                    })
                    .ok()
            })
            .as_ref()
            .ok_or(FetchError::Provider)
    }
}

impl CodeHost for GitHub {
    fn fetch(&self, token: String) -> BoxFuture<'_, Result<Queue, FetchError>> {
        Box::pin(async move {
            let body = serde_json::json!({
                "query": QUERY,
                "variables": {
                    "toReview": TO_REVIEW_SEARCH,
                    "mine": MINE_SEARCH,
                    "first": PAGE_SIZE,
                },
            });
            let response = self
                .client()?
                .post(GRAPHQL_ENDPOINT)
                .bearer_auth(token)
                .header(reqwest::header::ACCEPT, "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|error| classify(&error))?;
            let status = response.status();
            if status.as_u16() == 401 {
                return Err(FetchError::Unauthorized);
            }
            if status.as_u16() == 429 || (status.as_u16() == 403 && is_rate_limited(&response)) {
                return Err(FetchError::RateLimited);
            }
            if status.as_u16() == 403 {
                return Err(FetchError::Unauthorized);
            }
            if !status.is_success() {
                tracing::warn!(status = status.as_u16(), "code hosting query refused");
                return Err(FetchError::Provider);
            }
            if response
                .content_length()
                .is_some_and(|length| length > MAX_BODY_BYTES as u64)
            {
                return Err(FetchError::Provider);
            }
            let bytes = response.bytes().await.map_err(|error| classify(&error))?;
            if bytes.len() > MAX_BODY_BYTES {
                return Err(FetchError::Provider);
            }
            parse_queue(&String::from_utf8_lossy(&bytes))
        })
    }

    fn name(&self) -> &'static str {
        "github"
    }
}

/// GitHub answers a spent rate limit with 403 and `x-ratelimit-remaining: 0`, or with
/// `retry-after` for its secondary limits.
fn is_rate_limited(response: &reqwest::Response) -> bool {
    let headers = response.headers();
    headers.contains_key("retry-after")
        || headers
            .get("x-ratelimit-remaining")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.trim() == "0")
}

/// A transport failure is "offline"; anything the server said is "provider".
fn classify(error: &reqwest::Error) -> FetchError {
    if error.is_status() || error.is_decode() || error.is_body() {
        FetchError::Provider
    } else {
        FetchError::Offline
    }
}

#[derive(Deserialize)]
struct Envelope {
    data: Option<Data>,
    #[serde(default)]
    errors: Vec<GraphqlError>,
}

#[derive(Deserialize)]
struct GraphqlError {
    /// Only `type` is read: messages may name repositories, so they stay out of the log.
    #[serde(default, rename = "type")]
    kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Data {
    viewer: Viewer,
    to_review: SearchPage,
    mine: SearchPage,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Viewer {
    login: String,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct SearchPage {
    #[serde(default)]
    nodes: Vec<Option<Node>>,
}

/// A search hit. Issues cannot match `is:pr`, but the union type means a node may still be
/// something without these fields; such a node deserialises with `id: None` and is skipped.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    id: Option<String>,
    number: Option<u32>,
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    is_draft: bool,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    additions: u32,
    #[serde(default)]
    deletions: u32,
    #[serde(default)]
    changed_files: u32,
    review_decision: Option<String>,
    repository: Option<Repository>,
    author: Option<Actor>,
    commits: Option<Commits>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Repository {
    name_with_owner: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Actor {
    login: String,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct Commits {
    #[serde(default)]
    nodes: Vec<CommitNode>,
}

#[derive(Deserialize)]
struct CommitNode {
    commit: Option<Commit>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Commit {
    status_check_rollup: Option<Rollup>,
}

#[derive(Deserialize)]
struct Rollup {
    #[serde(default)]
    state: String,
}

/// A GraphQL response body as a queue. Pure, so the tests feed it fixtures.
pub fn parse_queue(json: &str) -> Result<Queue, FetchError> {
    let envelope: Envelope = serde_json::from_str(json).map_err(|error| {
        tracing::warn!(%error, "code hosting response is not the expected shape");
        FetchError::Provider
    })?;
    let Some(data) = envelope.data else {
        if envelope
            .errors
            .iter()
            .any(|error| error.kind == "FORBIDDEN" || error.kind == "UNAUTHORIZED")
        {
            return Err(FetchError::Unauthorized);
        }
        if envelope
            .errors
            .iter()
            .any(|error| error.kind == "RATE_LIMITED")
        {
            return Err(FetchError::RateLimited);
        }
        // Error kinds are enums, not content; messages may name repositories, so only the kinds
        // are logged.
        let kinds: Vec<&str> = envelope
            .errors
            .iter()
            .map(|error| {
                if error.kind.is_empty() {
                    "?"
                } else {
                    error.kind.as_str()
                }
            })
            .collect();
        tracing::warn!(
            ?kinds,
            count = envelope.errors.len(),
            "code hosting query failed"
        );
        return Err(FetchError::Provider);
    };
    // Partial data (a repository the token cannot read) still lists everything else; the
    // messages stay out of the log for the same reason as above.
    if !envelope.errors.is_empty() {
        tracing::debug!(
            count = envelope.errors.len(),
            "code hosting query answered with errors"
        );
    }
    let account = Account {
        provider: Provider::GitHub,
        login: data.viewer.login,
        avatar_url: data.viewer.avatar_url,
    };
    let mut pull_requests: Vec<PullRequest> = Vec::new();
    for (page, review_requested, mine) in [(data.to_review, true, false), (data.mine, false, true)]
    {
        for node in page.nodes.into_iter().flatten() {
            let Some(row) = to_pull_request(node, review_requested, mine) else {
                continue;
            };
            if let Some(existing) = pull_requests
                .iter_mut()
                .find(|existing| existing.id == row.id)
            {
                existing.review_requested |= review_requested;
                existing.mine |= mine;
            } else {
                pull_requests.push(row);
            }
        }
    }
    pull_requests.sort_by(|a, b| {
        b.updated_at_ms
            .cmp(&a.updated_at_ms)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(Queue {
        account,
        pull_requests,
    })
}

fn to_pull_request(node: Node, review_requested: bool, mine: bool) -> Option<PullRequest> {
    let id = node.id?;
    let number = node.number?;
    let repository = node.repository?;
    let (author, author_avatar_url) = node.author.map_or((String::new(), None), |actor| {
        (actor.login, actor.avatar_url)
    });
    let checks = node
        .commits
        .and_then(|commits| commits.nodes.into_iter().next())
        .and_then(|node| node.commit)
        .and_then(|commit| commit.status_check_rollup)
        .map_or(ChecksState::None, |rollup| checks_state(&rollup.state));
    Some(PullRequest {
        id,
        provider: Provider::GitHub,
        repo: repository.name_with_owner,
        number,
        title: node.title,
        url: node.url,
        author,
        author_avatar_url,
        draft: node.is_draft,
        additions: node.additions,
        deletions: node.deletions,
        changed_files: node.changed_files,
        checks,
        review_decision: review_decision(node.review_decision.as_deref()),
        updated_at_ms: parse_timestamp(&node.updated_at),
        review_requested,
        mine,
    })
}

/// GitHub's `StatusState` as the closed set the UI phrases.
#[must_use]
pub fn checks_state(state: &str) -> ChecksState {
    match state {
        "SUCCESS" => ChecksState::Success,
        "FAILURE" | "ERROR" => ChecksState::Failure,
        "PENDING" | "EXPECTED" => ChecksState::Pending,
        _ => ChecksState::None,
    }
}

#[must_use]
pub fn review_decision(decision: Option<&str>) -> ReviewDecision {
    match decision {
        Some("APPROVED") => ReviewDecision::Approved,
        Some("CHANGES_REQUESTED") => ReviewDecision::ChangesRequested,
        Some("REVIEW_REQUIRED") => ReviewDecision::ReviewRequired,
        _ => ReviewDecision::None,
    }
}

/// An RFC 3339 instant (`2026-09-26T10:15:00Z`) as Unix milliseconds; `0` for anything else,
/// which sorts such a row last rather than dropping it.
#[must_use]
pub fn parse_timestamp(text: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(text).map_or(0, |instant| instant.timestamp_millis())
}
