//! Where the translations come from (docs/modules/translation.md "Providers"): an
//! OpenAI-compatible chat endpoint or an Ollama server, both streaming, one adapter behind a
//! trait so the service is tested with scripted chunks and no network.
//!
//! Nothing here runs unless the user turned the module on: the service only calls the
//! translator from [`super::TranslationService::run`], after `begin` checked
//! `settings.modules.translation.enabled`. One request per translation asks the model to
//! translate and nothing else; the key goes in the `Authorization` header and nowhere else, and
//! neither the key nor the text is ever logged — the log gets the status code and the chunk
//! count.
//!
//! The two wire formats are decoded by [`Decoder`], a pure line splitter over the bytes as they
//! arrive: `text/event-stream` (`data: {json}` lines, `data: [DONE]`) for OpenAI-compatible
//! servers and NDJSON (one `{json}` per line, `"done": true` last) for Ollama. Spike S2 in
//! `tests/translation.rs` drives both with chunk boundaries in the middle of lines.

use std::fmt;
use std::future::Future;
use std::net::IpAddr;
use std::pin::Pin;
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use specta::Type;

use super::settings::{AUTO, TranslationProvider};

/// How long connecting and the first byte of the answer may take.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// The longest wait between two reads of the stream before the request counts as lost.
pub const READ_TIMEOUT: Duration = Duration::from_secs(45);
/// The most text one request may send. The panel is a quick translator, not a document tool.
pub const MAX_TEXT_CHARS: usize = 5_000;
/// The most text one answer may carry before the stream is cut; a translation is about as
/// long as its source.
pub const MAX_OUTPUT_CHARS: usize = 20_000;
/// The longest key kept. Hosted providers issue keys under 200 characters; some gateways issue
/// longer ones.
pub const MAX_KEY_CHARS: usize = 512;
/// The longest line the decoder keeps before giving up on the stream (a line that long is not
/// a delta).
pub const MAX_LINE_BYTES: usize = 256 * 1024;
/// How creative the model may be: not at all.
pub const TEMPERATURE: f32 = 0.2;

const USER_AGENT: &str = concat!(
    "Muna/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/miklol/Muna)"
);

/// Why a translation did not happen or did not finish. Never carries what the server said: the
/// UI has one sentence per case.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum TranslateError {
    /// The module is off: nothing leaves the machine.
    #[error("translation is off")]
    Disabled,
    /// Nothing to translate.
    #[error("there is no text to translate")]
    Empty,
    /// More than [`MAX_TEXT_CHARS`].
    #[error("the text is too long to translate at once")]
    TooLong,
    /// The provider needs a key and none is saved.
    #[error("the provider needs an api key")]
    NoKey,
    /// The endpoint is not an address requests may go to (not a URL, or plain `http` to a host
    /// outside the local network, which would send the key in the clear).
    #[error("the endpoint is not an address translations can go to")]
    Endpoint,
    /// The credential vault could not be read.
    #[error("the api key could not be read")]
    Vault,
    /// No connection, a DNS failure or a timeout.
    #[error("the provider could not be reached")]
    Offline,
    /// The provider refused the key (401 or 403).
    #[error("the provider did not accept the api key")]
    Unauthorized,
    /// The provider asked for a pause (429).
    #[error("the provider asked for a pause")]
    RateLimited,
    /// The provider does not have the model (404, or Ollama's "model not found").
    #[error("the provider does not have that model")]
    ModelMissing,
    /// The provider answered, but not with a translation (an error status, a shape this build
    /// does not understand, an answer longer than [`MAX_OUTPUT_CHARS`]).
    #[error("the provider answered with something unexpected")]
    Provider,
}

/// Why a pasted key was not kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum KeyError {
    #[error("the key is empty")]
    Empty,
    /// Spaces, line breaks, non-ASCII, or longer than [`MAX_KEY_CHARS`]: not a key, and not a
    /// valid header value.
    #[error("the key has characters a key cannot have")]
    Malformed,
    /// The credential vault refused it; nothing was kept.
    #[error("the key could not be stored")]
    Vault,
}

/// The key as it is stored and sent: trimmed and checked to be a header value. Never logs its
/// argument.
pub fn normalise_key(input: &str) -> Result<String, KeyError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(KeyError::Empty);
    }
    if trimmed.len() > MAX_KEY_CHARS
        || !trimmed
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && byte != b'"' && byte != b'\\')
    {
        return Err(KeyError::Malformed);
    }
    Ok(trimmed.to_owned())
}

/// A key on its way to the provider. Its `Debug` says nothing, so a logged [`Request`] cannot
/// leak it.
#[derive(Clone, PartialEq, Eq)]
pub struct Key(pub String);

impl fmt::Debug for Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Key(…)")
    }
}

/// One translation as the translator receives it. `Debug` prints the shape and the sizes,
/// never the text or the key.
#[derive(Clone, PartialEq, Eq)]
pub struct Request {
    pub provider: TranslationProvider,
    /// The API base, already checked by [`check_endpoint`].
    pub endpoint: String,
    pub model: String,
    pub key: Option<Key>,
    /// A BCP-47 tag or [`AUTO`].
    pub source: String,
    /// A BCP-47 tag.
    pub target: String,
    pub text: String,
}

impl fmt::Debug for Request {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Request")
            .field("provider", &self.provider)
            .field("endpoint", &self.endpoint)
            .field("model", &self.model)
            .field("key", &self.key.as_ref().map(|_| "…"))
            .field("source", &self.source)
            .field("target", &self.target)
            .field("chars", &self.text.chars().count())
            .finish()
    }
}

/// A piece of the answer as the decoder reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delta {
    /// More of the translation.
    Text(String),
    /// The provider is finished.
    Done,
    /// The provider reported a failure in the stream.
    Failed(TranslateError),
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// The answer as it streams in. `None` once the stream ends; the caller treats a stream that
/// ends without a [`Delta::Done`] as done anyway.
pub trait Chunks: Send {
    fn next(&mut self) -> BoxFuture<'_, Option<Delta>>;
}

/// A translation provider. Async because the real one waits on the network; the service keeps
/// its own reasoning synchronous and only awaits at the edge.
pub trait Translator: Send + Sync {
    /// Sends `request` and returns the answer's stream once the provider accepted it.
    fn open(&self, request: Request) -> BoxFuture<'_, Result<Box<dyn Chunks>, TranslateError>>;
    /// For diagnostics.
    fn name(&self) -> &'static str;
}

impl fmt::Debug for dyn Translator {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Translator")
            .field("name", &self.name())
            .finish()
    }
}

/// The instruction that makes a chat model a translator and nothing else
/// (docs/modules/translation.md: "System prompt enforces translate only").
#[must_use]
pub fn system_prompt(source: &str, target: &str) -> String {
    let target = language_name(target);
    let from = if source == AUTO {
        String::new()
    } else {
        format!(" from {}", language_name(source))
    };
    format!(
        "You are a translation engine. Translate the user's message{from} into {target}. \
         Reply with the translation only: no quotes, no notes, no explanations, no preamble. \
         Keep the line breaks, formatting, names and numbers as they are. If the message is \
         already in {target}, return it unchanged."
    )
}

/// The English name of a language tag for the prompt; models follow names better than tags.
/// Tags outside the table are passed through as they are.
#[must_use]
pub fn language_name(tag: &str) -> String {
    let base = tag
        .split(['-', '_'])
        .next()
        .unwrap_or(tag)
        .to_ascii_lowercase();
    let name = match tag.to_ascii_lowercase().as_str() {
        "zh-hant" | "zh-tw" | "zh-hk" => Some("Traditional Chinese"),
        "zh-hans" | "zh-cn" => Some("Simplified Chinese"),
        "pt-br" => Some("Brazilian Portuguese"),
        "pt-pt" => Some("European Portuguese"),
        "en-gb" => Some("British English"),
        "en-us" => Some("American English"),
        _ => None,
    };
    let name = name.or(match base.as_str() {
        "ar" => Some("Arabic"),
        "bn" => Some("Bengali"),
        "cs" => Some("Czech"),
        "da" => Some("Danish"),
        "de" => Some("German"),
        "el" => Some("Greek"),
        "en" => Some("English"),
        "es" => Some("Spanish"),
        "fa" => Some("Persian"),
        "fi" => Some("Finnish"),
        "fr" => Some("French"),
        "he" => Some("Hebrew"),
        "hi" => Some("Hindi"),
        "hu" => Some("Hungarian"),
        "id" => Some("Indonesian"),
        "it" => Some("Italian"),
        "ja" => Some("Japanese"),
        "ko" => Some("Korean"),
        "nl" => Some("Dutch"),
        "no" | "nb" => Some("Norwegian"),
        "pl" => Some("Polish"),
        "pt" => Some("Portuguese"),
        "ro" => Some("Romanian"),
        "ru" => Some("Russian"),
        "sv" => Some("Swedish"),
        "th" => Some("Thai"),
        "tr" => Some("Turkish"),
        "uk" => Some("Ukrainian"),
        "vi" => Some("Vietnamese"),
        "zh" => Some("Chinese"),
        _ => None,
    });
    name.map_or_else(|| tag.to_owned(), str::to_owned)
}

/// Checks that `endpoint` is an address translations may go to and returns it parsed:
/// `https` anywhere, `http` only to a host on this machine or the local network — a plain
/// `http` request to the internet would carry the key and the text in the clear.
pub fn check_endpoint(endpoint: &str) -> Result<reqwest::Url, TranslateError> {
    let url = reqwest::Url::parse(endpoint).map_err(|_| TranslateError::Endpoint)?;
    let host = url.host_str().ok_or(TranslateError::Endpoint)?;
    match url.scheme() {
        "https" => Ok(url),
        "http" if is_local_host(host) => Ok(url),
        _ => Err(TranslateError::Endpoint),
    }
}

/// `localhost`, `*.local`, `*.lan`, a bare host name, or a loopback / private / link-local
/// address.
#[must_use]
pub fn is_local_host(host: &str) -> bool {
    let host = host.trim_matches(['[', ']']);
    if let Ok(address) = host.parse::<IpAddr>() {
        return match address {
            IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
            IpAddr::V6(v6) => {
                v6.is_loopback()
                    || v6.is_unique_local()
                    || v6.is_unicast_link_local()
                    || v6
                        .to_ipv4_mapped()
                        .is_some_and(|v4| v4.is_loopback() || v4.is_private() || v4.is_link_local())
            }
        };
    }
    let lower = host.to_ascii_lowercase();
    if lower == "localhost" || !lower.contains('.') || lower.ends_with(".home.arpa") {
        return true;
    }
    matches!(
        lower.rsplit_once('.'),
        Some((_, "localhost" | "local" | "lan"))
    )
}

/// The two wire formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wire {
    /// `text/event-stream`: `data: {json}` lines, blank-line separated, `data: [DONE]` last.
    Sse,
    /// One JSON object per line; the last has `"done": true`.
    Ndjson,
}

impl Wire {
    #[must_use]
    pub const fn for_provider(provider: TranslationProvider) -> Self {
        match provider {
            TranslationProvider::OpenAi => Self::Sse,
            TranslationProvider::Ollama => Self::Ndjson,
        }
    }
}

/// Turns the bytes of a streaming answer into [`Delta`]s, whatever the chunk boundaries.
#[derive(Debug)]
pub struct Decoder {
    wire: Wire,
    pending: Vec<u8>,
    done: bool,
}

impl Decoder {
    #[must_use]
    pub fn new(wire: Wire) -> Self {
        Self {
            wire,
            pending: Vec::new(),
            done: false,
        }
    }

    /// The deltas the complete lines in `bytes` (plus what was pending) carry, in order.
    /// After a [`Delta::Done`] or a [`Delta::Failed`], nothing more is produced.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Delta> {
        let mut deltas = Vec::new();
        if self.done {
            return deltas;
        }
        self.pending.extend_from_slice(bytes);
        let mut start = 0;
        while let Some(offset) = self.pending[start..].iter().position(|byte| *byte == b'\n') {
            let end = start + offset;
            let line = String::from_utf8_lossy(&self.pending[start..end]).into_owned();
            start = end + 1;
            if let Some(delta) = self.decode_line(line.trim_end_matches('\r')) {
                let stop = !matches!(delta, Delta::Text(_));
                deltas.push(delta);
                if stop {
                    self.done = true;
                    self.pending.clear();
                    return deltas;
                }
            }
        }
        self.pending.drain(..start);
        if self.pending.len() > MAX_LINE_BYTES {
            self.done = true;
            self.pending.clear();
            deltas.push(Delta::Failed(TranslateError::Provider));
        }
        deltas
    }

    /// The end of the stream: decodes a last line without a line break, if any.
    pub fn finish(&mut self) -> Vec<Delta> {
        if self.done || self.pending.is_empty() {
            return Vec::new();
        }
        let line = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        self.done = true;
        self.decode_line(line.trim_end_matches('\r'))
            .into_iter()
            .collect()
    }

    fn decode_line(&self, line: &str) -> Option<Delta> {
        match self.wire {
            Wire::Sse => decode_sse_line(line),
            Wire::Ndjson => decode_ndjson_line(line),
        }
    }
}

#[derive(Deserialize)]
struct SseEvent {
    #[serde(default)]
    choices: Vec<SseChoice>,
    error: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct SseChoice {
    #[serde(default)]
    delta: SseDelta,
}

#[derive(Deserialize, Default)]
struct SseDelta {
    content: Option<String>,
}

/// One `text/event-stream` line as an OpenAI-compatible server writes it. Comments, `event:`
/// and `id:` lines and blank separators carry nothing; `data: [DONE]` ends the stream; an
/// `error` object in the data is the server giving up.
#[must_use]
pub fn decode_sse_line(line: &str) -> Option<Delta> {
    let data = line.strip_prefix("data:")?.trim();
    if data.is_empty() {
        return None;
    }
    if data == "[DONE]" {
        return Some(Delta::Done);
    }
    let Ok(event) = serde_json::from_str::<SseEvent>(data) else {
        return Some(Delta::Failed(TranslateError::Provider));
    };
    if event.error.is_some() {
        return Some(Delta::Failed(TranslateError::Provider));
    }
    let choice = event.choices.into_iter().next()?;
    // A finish reason without content is the last event before `[DONE]`; `[DONE]` itself ends
    // the stream, and a server that never sends it ends it by closing.
    match choice.delta.content {
        Some(content) if !content.is_empty() => Some(Delta::Text(content)),
        _ => None,
    }
}

#[derive(Deserialize)]
struct OllamaEvent {
    message: Option<OllamaMessage>,
    #[serde(default)]
    done: bool,
    error: Option<String>,
}

#[derive(Deserialize)]
struct OllamaMessage {
    #[serde(default)]
    content: String,
}

/// One NDJSON line as Ollama writes it. The last line carries `done: true` with empty content;
/// a line with `error` is the server giving up (a missing model, most often).
#[must_use]
pub fn decode_ndjson_line(line: &str) -> Option<Delta> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let Ok(event) = serde_json::from_str::<OllamaEvent>(line) else {
        return Some(Delta::Failed(TranslateError::Provider));
    };
    if let Some(error) = event.error {
        return Some(Delta::Failed(if error.contains("not found") {
            TranslateError::ModelMissing
        } else {
            TranslateError::Provider
        }));
    }
    let content = event
        .message
        .map(|message| message.content)
        .unwrap_or_default();
    if event.done {
        // The last line may still carry a tail of text; the stream ends when `next` is called
        // again and the decoder has nothing more.
        return Some(if content.is_empty() {
            Delta::Done
        } else {
            Delta::Text(content)
        });
    }
    if content.is_empty() {
        None
    } else {
        Some(Delta::Text(content))
    }
}

/// The request body for `request`, as the provider's route expects it.
#[must_use]
pub fn request_body(request: &Request) -> serde_json::Value {
    let messages = serde_json::json!([
        { "role": "system", "content": system_prompt(&request.source, &request.target) },
        { "role": "user", "content": request.text },
    ]);
    match request.provider {
        TranslationProvider::OpenAi => serde_json::json!({
            "model": request.model,
            "stream": true,
            "temperature": TEMPERATURE,
            "messages": messages,
        }),
        TranslationProvider::Ollama => serde_json::json!({
            "model": request.model,
            "stream": true,
            "options": { "temperature": TEMPERATURE },
            "messages": messages,
        }),
    }
}

/// The route under the API base for `provider`.
#[must_use]
pub const fn route(provider: TranslationProvider) -> &'static str {
    match provider {
        TranslationProvider::OpenAi => "/chat/completions",
        TranslationProvider::Ollama => "/api/chat",
    }
}

/// The HTTP adapter for both providers. The clients are built on first use so constructing
/// the module (and the app state in tests) touches nothing. A local endpoint gets a client
/// that ignores the system proxy: a proxy on the way to `127.0.0.1` would swallow the request.
#[derive(Debug, Default)]
pub struct HttpTranslator {
    proxied: OnceLock<Option<reqwest::Client>>,
    direct: OnceLock<Option<reqwest::Client>>,
}

impl HttpTranslator {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn client(&self, local: bool) -> Result<&reqwest::Client, TranslateError> {
        let cell = if local { &self.direct } else { &self.proxied };
        cell.get_or_init(|| {
            let mut builder = reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .connect_timeout(CONNECT_TIMEOUT)
                .read_timeout(READ_TIMEOUT);
            if local {
                builder = builder.no_proxy();
            }
            builder
                .build()
                .map_err(|error| {
                    tracing::warn!(%error, "translation http client unavailable");
                    error
                })
                .ok()
        })
        .as_ref()
        .ok_or(TranslateError::Provider)
    }
}

impl Translator for HttpTranslator {
    fn open(&self, request: Request) -> BoxFuture<'_, Result<Box<dyn Chunks>, TranslateError>> {
        Box::pin(async move {
            let base = check_endpoint(&request.endpoint)?;
            let local = base.host_str().is_some_and(is_local_host);
            let url = format!(
                "{}{}",
                request.endpoint.trim_end_matches('/'),
                route(request.provider)
            );
            let mut builder = self
                .client(local)?
                .post(url)
                .header(
                    reqwest::header::ACCEPT,
                    match Wire::for_provider(request.provider) {
                        Wire::Sse => "text/event-stream",
                        Wire::Ndjson => "application/x-ndjson",
                    },
                )
                .json(&request_body(&request));
            if let Some(Key(key)) = &request.key {
                builder = builder.bearer_auth(key);
            }
            let response = builder.send().await.map_err(|error| classify(&error))?;
            let status = response.status().as_u16();
            match status {
                200..=299 => {}
                401 | 403 => return Err(TranslateError::Unauthorized),
                404 => return Err(TranslateError::ModelMissing),
                429 => return Err(TranslateError::RateLimited),
                _ => {
                    tracing::warn!(status, "translation request refused");
                    return Err(TranslateError::Provider);
                }
            }
            tracing::debug!(
                provider = request.provider.id(),
                status,
                "translation stream open"
            );
            Ok(Box::new(HttpChunks {
                response: Some(response),
                decoder: Decoder::new(Wire::for_provider(request.provider)),
                queue: std::collections::VecDeque::new(),
            }) as Box<dyn Chunks>)
        })
    }

    fn name(&self) -> &'static str {
        "http"
    }
}

/// A transport failure is "offline"; anything the server said is "provider".
fn classify(error: &reqwest::Error) -> TranslateError {
    if error.is_status() || error.is_decode() || error.is_body() {
        TranslateError::Provider
    } else {
        TranslateError::Offline
    }
}

struct HttpChunks {
    /// `None` once the body ended or failed.
    response: Option<reqwest::Response>,
    decoder: Decoder,
    /// Deltas decoded but not yet handed out (one network read may carry several lines).
    queue: std::collections::VecDeque<Delta>,
}

impl Chunks for HttpChunks {
    fn next(&mut self) -> BoxFuture<'_, Option<Delta>> {
        Box::pin(async move {
            loop {
                if let Some(delta) = self.queue.pop_front() {
                    return Some(delta);
                }
                let response = self.response.as_mut()?;
                match response.chunk().await {
                    Ok(Some(bytes)) => self.queue.extend(self.decoder.feed(&bytes)),
                    Ok(None) => {
                        self.response = None;
                        self.queue.extend(self.decoder.finish());
                    }
                    Err(error) => {
                        self.response = None;
                        tracing::debug!(%error, "translation stream ended early");
                        self.queue.push_back(Delta::Failed(classify(&error)));
                    }
                }
            }
        })
    }
}
