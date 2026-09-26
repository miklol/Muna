//! Where feed text comes from (docs/modules/calendar.md "ICS subscriptions"): one HTTPS `GET`
//! per source per refresh, behind a trait so the service is tested with scripted bodies and
//! no network.
//!
//! Nothing here runs unless the user added a source: the address is the only thing sent, and
//! it goes only to the host the user typed. `webcal://` — what "Subscribe" links hand out — is
//! read as `https://`.

use std::future::Future;
use std::pin::Pin;
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use specta::Type;

/// How long one request may take before it counts as offline.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// The largest feed read; a personal calendar is tens of kilobytes, a busy shared one a few
/// megabytes.
pub const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;

const USER_AGENT: &str = concat!(
    "Muna/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/miklol/Muna)"
);

/// Why a refresh did not produce a feed. Never carries what the server said: the UI has one
/// sentence per case.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum FeedError {
    /// No connection, a DNS failure or a timeout: the cached events stand with their time.
    #[error("the calendar could not be reached")]
    Offline,
    /// The server refused (401, 403, 404, 410): the link expired or was revoked.
    #[error("the calendar refused the link")]
    Refused,
    /// The server answered with something that is not a calendar (a login page, an error
    /// status, an oversized body).
    #[error("the calendar answered with something unexpected")]
    Invalid,
    /// The address is not in this device's vault (the settings came from another machine, or
    /// the vault entry was removed); the source must be added again.
    #[error("the calendar's address is not on this device")]
    MissingLink,
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// A feed source. Async because the real one waits on the network; the service keeps its own
/// reasoning synchronous and only awaits at the edge.
pub trait IcsFetcher: Send + Sync {
    /// The feed body for an `http(s)` address that already passed [`normalise_url`].
    fn fetch(&self, url: String) -> BoxFuture<'_, Result<String, FeedError>>;
    /// For diagnostics.
    fn name(&self) -> &'static str;
}

impl std::fmt::Debug for dyn IcsFetcher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IcsFetcher")
            .field("name", &self.name())
            .finish()
    }
}

/// Why a typed address was not accepted as a source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum UrlError {
    /// Not a URL at all.
    #[error("the address is not a link")]
    Malformed,
    /// A scheme other than `http`, `https` or `webcal`.
    #[error("only web links are accepted")]
    Scheme,
    /// The link carries a user name or password; those are not kept.
    #[error("links with a user name or password are not accepted")]
    Credentials,
}

/// The address as it is kept and fetched: trimmed, `webcal` read as `https`, the fragment
/// dropped. Returns the address and its host.
pub fn normalise_url(input: &str) -> Result<(String, String), UrlError> {
    let trimmed = input.trim();
    // `Url::set_scheme` refuses to turn a non-special scheme into a special one, so the
    // `webcal` prefix is rewritten before parsing.
    let rewritten = ["webcals://", "webcal://"].iter().find_map(|prefix| {
        trimmed
            .get(..prefix.len())
            .filter(|head| head.eq_ignore_ascii_case(prefix))
            .map(|_| format!("https://{}", &trimmed[prefix.len()..]))
    });
    let mut url = tauri::Url::parse(rewritten.as_deref().unwrap_or(trimmed))
        .map_err(|_| UrlError::Malformed)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(UrlError::Scheme);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(UrlError::Credentials);
    }
    let host = url.host_str().ok_or(UrlError::Malformed)?.to_owned();
    url.set_fragment(None);
    Ok((url.to_string(), host))
}

/// The HTTPS fetcher. The client is built on first use so constructing the module (and the
/// app state in tests) touches nothing.
#[derive(Debug, Default)]
pub struct HttpIcsFetcher {
    client: OnceLock<Option<reqwest::Client>>,
}

impl HttpIcsFetcher {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn client(&self) -> Result<&reqwest::Client, FeedError> {
        self.client
            .get_or_init(|| {
                reqwest::Client::builder()
                    .user_agent(USER_AGENT)
                    .timeout(REQUEST_TIMEOUT)
                    .build()
                    .map_err(|error| {
                        tracing::warn!(%error, "calendar http client unavailable");
                        error
                    })
                    .ok()
            })
            .as_ref()
            .ok_or(FeedError::Invalid)
    }
}

impl IcsFetcher for HttpIcsFetcher {
    fn fetch(&self, url: String) -> BoxFuture<'_, Result<String, FeedError>> {
        Box::pin(async move {
            let response = self
                .client()?
                .get(&url)
                .header(
                    reqwest::header::ACCEPT,
                    "text/calendar, text/plain;q=0.8, */*;q=0.1",
                )
                .send()
                .await
                .map_err(|error| classify(&error))?;
            let status = response.status();
            if matches!(status.as_u16(), 401 | 403 | 404 | 410) {
                return Err(FeedError::Refused);
            }
            if !status.is_success() {
                return Err(FeedError::Invalid);
            }
            if response
                .content_length()
                .is_some_and(|length| length > MAX_BODY_BYTES as u64)
            {
                return Err(FeedError::Invalid);
            }
            let body = response.bytes().await.map_err(|error| classify(&error))?;
            if body.len() > MAX_BODY_BYTES {
                return Err(FeedError::Invalid);
            }
            let text = String::from_utf8_lossy(&body).into_owned();
            if !looks_like_calendar(&text) {
                return Err(FeedError::Invalid);
            }
            Ok(text)
        })
    }

    fn name(&self) -> &'static str {
        "https"
    }
}

/// A transport failure is "offline"; anything the server said is "invalid".
fn classify(error: &reqwest::Error) -> FeedError {
    if error.is_status() || error.is_decode() || error.is_body() {
        FeedError::Invalid
    } else {
        FeedError::Offline
    }
}

/// Whether a body is an iCalendar object rather than, say, a sign-in page.
#[must_use]
pub fn looks_like_calendar(text: &str) -> bool {
    text.trim_start_matches('\u{feff}')
        .trim_start()
        .get(..15)
        .is_some_and(|head| head.eq_ignore_ascii_case("BEGIN:VCALENDAR"))
}
