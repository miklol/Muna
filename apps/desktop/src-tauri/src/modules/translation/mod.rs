//! The `translation` module backend (docs/modules/translation.md): text in, a streamed
//! translation out, from an OpenAI-compatible endpoint or an Ollama server the user chose.
//!
//! [`TranslationService`] is a reducer around the one asynchronous thing — the provider's
//! stream: `begin` checks the request and hands back a [`Job`], `deliver` passes each piece of
//! the answer on as a [`TranslationChunk`] while the request is still wanted, `finish` closes
//! it, and `cancel` forgets it so nothing more is emitted. [`TranslationService::run`] is the
//! loop that strings them together over a [`Translator`]; `tests/translation.rs` drives the
//! steps directly and the loop with a scripted translator (spike S2: five chunks, a cancel
//! after the second, no further chunk).
//!
//! Privacy (`.github/copilot-instructions.md`, "local-first & private"): nothing is sent until
//! `settings.modules.translation.enabled` is true, and the pane names the endpoint next to that
//! switch; the key lives in the credential vault under `translation.<provider>.key`, is read
//! for each request and is never logged or written anywhere else; the text and the answer are
//! content and stay out of the log — it gets the chunk count.

pub mod provider;
pub mod settings;

use std::collections::HashMap;
use std::sync::Arc;

use muna_core::Settings;
use muna_platform::Platform;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use provider::{
    Chunks, Decoder, Delta, HttpTranslator, Key, KeyError, MAX_KEY_CHARS, MAX_OUTPUT_CHARS,
    MAX_TEXT_CHARS, Request, TranslateError, Translator, Wire, check_endpoint, normalise_key,
    system_prompt,
};
pub use settings::{AUTO, Provider, TranslationSettings};

pub const ID: &str = "translation";

/// Identifies one translation for the life of the process; the UI matches chunks to the
/// request it made with it.
pub type RequestId = u32;

/// What the pane shows beside the settings document (docs/modules/translation.md).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TranslationSnapshot {
    pub enabled: bool,
    pub provider: Provider,
    /// Where requests go: the setting or the provider's default, as the consent line names it.
    pub endpoint: String,
    /// The model asked for: the setting or the provider's default.
    pub model: String,
    /// A key is saved for `provider`. The key itself never comes back.
    pub has_key: bool,
    /// `provider` refuses a request without a key.
    pub needs_key: bool,
    /// Translations in flight.
    pub active: u32,
}

/// A piece of a translation, or its end (docs/modules/translation.md acceptance criteria:
/// "streaming tokens render progressively").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TranslationChunk {
    pub request_id: RequestId,
    /// More of the translation; empty on the final chunk.
    pub text: String,
    /// The last chunk of this request: nothing follows.
    pub done: bool,
    /// Set on a final chunk when the request did not finish properly.
    pub error: Option<TranslateError>,
}

/// What the panel sends. Blank languages mean the ones in the settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TranslateRequest {
    pub text: String,
    /// A BCP-47 tag, [`AUTO`], or `None` for the setting.
    pub source: Option<String>,
    /// A BCP-47 tag, or `None` for the setting.
    pub target: Option<String>,
}

/// Where the module reports chunks and changes; the shell bridges both to Tauri events.
pub trait TranslationSink: Send + Sync {
    fn chunk(&self, chunk: &TranslationChunk);
    fn changed(&self, snapshot: &TranslationSnapshot);
}

/// One translation the loop should run: the id the UI got and what the provider gets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Job {
    pub id: RequestId,
    pub request: Request,
}

struct Active {
    /// Characters delivered so far; the stream is cut past [`MAX_OUTPUT_CHARS`].
    chars: usize,
    chunks: u32,
}

struct Inner {
    settings: TranslationSettings,
    next_id: RequestId,
    active: HashMap<RequestId, Active>,
}

pub struct TranslationService {
    platform: Arc<dyn Platform>,
    translator: Arc<dyn Translator>,
    inner: Mutex<Inner>,
    sink: Mutex<Option<Arc<dyn TranslationSink>>>,
}

impl std::fmt::Debug for TranslationService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let inner = self.inner.lock();
        f.debug_struct("TranslationService")
            .field("enabled", &inner.settings.enabled)
            .field("provider", &inner.settings.provider)
            .field("active", &inner.active.len())
            .field("translator", &self.translator.name())
            .finish_non_exhaustive()
    }
}

impl TranslationService {
    #[must_use]
    pub fn new(platform: Arc<dyn Platform>, translator: Arc<dyn Translator>) -> Self {
        Self {
            platform,
            translator,
            inner: Mutex::new(Inner {
                settings: TranslationSettings::default(),
                next_id: 1,
                active: HashMap::new(),
            }),
            sink: Mutex::new(None),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn TranslationSink>) {
        *self.sink.lock() = Some(sink);
    }

    /// The service over the real HTTP adapter.
    #[must_use]
    pub fn with_http(platform: Arc<dyn Platform>) -> Self {
        Self::new(platform, Arc::new(HttpTranslator::new()))
    }

    #[must_use]
    pub fn settings(&self) -> TranslationSettings {
        self.inner.lock().settings.clone()
    }

    #[must_use]
    pub fn snapshot(&self) -> TranslationSnapshot {
        let inner = self.inner.lock();
        self.snapshot_of(&inner)
    }

    /// Applies `settings.modules.translation` (start-up and every settings change). A change
    /// of switch, provider, endpoint or model cancels what is in flight: the answer would be
    /// from the old place. The language pair changing does not; the panel decides that.
    pub fn apply_settings(&self, settings: &Settings) {
        let next = TranslationSettings::from_document(settings);
        let snapshot = {
            let mut inner = self.inner.lock();
            if inner.settings == next {
                return;
            }
            let previous = std::mem::replace(&mut inner.settings, next);
            let route_changed = previous.enabled != inner.settings.enabled
                || previous.provider != inner.settings.provider
                || previous.effective_endpoint() != inner.settings.effective_endpoint()
                || previous.effective_model() != inner.settings.effective_model();
            if route_changed && !inner.active.is_empty() {
                tracing::info!(
                    dropped = inner.active.len(),
                    "translation route changed; requests in flight dropped"
                );
                inner.active.clear();
            }
            self.snapshot_of(&inner)
        };
        self.changed(&snapshot);
    }

    /// Keeps `key` for the current provider in the credential vault. Never logs it.
    pub fn set_key(&self, key: &str) -> Result<TranslationSnapshot, KeyError> {
        let key = normalise_key(key)?;
        let entry = self.inner.lock().settings.provider.key_entry();
        self.platform.secrets().set(&entry, &key).map_err(|error| {
            tracing::warn!(%error, "translation key could not be stored");
            KeyError::Vault
        })?;
        tracing::info!(entry, "translation key saved");
        let snapshot = self.snapshot();
        self.changed(&snapshot);
        Ok(snapshot)
    }

    /// Forgets the current provider's key.
    pub fn clear_key(&self) -> Result<TranslationSnapshot, KeyError> {
        let entry = self.inner.lock().settings.provider.key_entry();
        self.platform.secrets().remove(&entry).map_err(|error| {
            tracing::warn!(%error, "translation key could not be removed");
            KeyError::Vault
        })?;
        tracing::info!(entry, "translation key removed");
        let snapshot = self.snapshot();
        self.changed(&snapshot);
        Ok(snapshot)
    }

    /// Checks `request` against the settings and the vault and registers it; the [`Job`] is
    /// what [`Self::run`] (or a test) feeds the translator. Refused while the module is off, so
    /// no surface can cause a request before the switch is on. The text is never logged.
    pub fn begin(&self, request: TranslateRequest) -> Result<Job, TranslateError> {
        let text = request.text.trim();
        if text.is_empty() {
            return Err(TranslateError::Empty);
        }
        if text.chars().count() > MAX_TEXT_CHARS {
            return Err(TranslateError::TooLong);
        }
        let settings = {
            let inner = self.inner.lock();
            if !inner.settings.enabled {
                return Err(TranslateError::Disabled);
            }
            inner.settings.clone()
        };
        let endpoint = settings.effective_endpoint();
        check_endpoint(&endpoint)?;
        let key = match self.platform.secrets().get(&settings.provider.key_entry()) {
            Ok(key) => key.map(Key),
            Err(error) => {
                tracing::warn!(%error, "translation vault unreadable");
                return Err(TranslateError::Vault);
            }
        };
        if key.is_none() && settings.provider.needs_key() {
            return Err(TranslateError::NoKey);
        }
        let model = settings.effective_model();
        let source = request
            .source
            .filter(|tag| !tag.trim().is_empty())
            .unwrap_or(settings.source);
        let target = request
            .target
            .filter(|tag| !tag.trim().is_empty())
            .unwrap_or(settings.target);
        let request = Request {
            provider: settings.provider,
            endpoint,
            model,
            key,
            source,
            target,
            text: text.to_owned(),
        };
        let (id, snapshot) = {
            let mut inner = self.inner.lock();
            if !inner.settings.enabled {
                return Err(TranslateError::Disabled);
            }
            let id = inner.next_id;
            inner.next_id = inner.next_id.wrapping_add(1).max(1);
            inner.active.insert(
                id,
                Active {
                    chars: 0,
                    chunks: 0,
                },
            );
            (id, self.snapshot_of(&inner))
        };
        tracing::debug!(
            id,
            chars = request.text.chars().count(),
            "translation begins"
        );
        self.changed(&snapshot);
        Ok(Job { id, request })
    }

    /// Passes a piece of the answer on. `false` when the request is no longer wanted (cancelled,
    /// finished, or over [`MAX_OUTPUT_CHARS`]) — the loop stops reading then.
    pub fn deliver(&self, id: RequestId, text: &str) -> bool {
        let cut = {
            let mut inner = self.inner.lock();
            let Some(active) = inner.active.get_mut(&id) else {
                return false;
            };
            active.chars += text.chars().count();
            active.chunks += 1;
            active.chars > MAX_OUTPUT_CHARS
        };
        if cut {
            tracing::warn!(id, "translation answer over the size limit; cut");
            self.finish(id, Err(TranslateError::Provider));
            return false;
        }
        self.emit(&TranslationChunk {
            request_id: id,
            text: text.to_owned(),
            done: false,
            error: None,
        });
        true
    }

    /// Closes the request with a final chunk, if it is still wanted.
    pub fn finish(&self, id: RequestId, result: Result<(), TranslateError>) {
        let snapshot = {
            let mut inner = self.inner.lock();
            let Some(active) = inner.active.remove(&id) else {
                tracing::debug!(id, "translation finished after it was dropped");
                return;
            };
            match &result {
                Ok(()) => tracing::info!(id, chunks = active.chunks, "translation finished"),
                Err(error) => {
                    tracing::info!(id, chunks = active.chunks, %error, "translation failed");
                }
            }
            self.snapshot_of(&inner)
        };
        self.emit(&TranslationChunk {
            request_id: id,
            text: String::new(),
            done: true,
            error: result.err(),
        });
        self.changed(&snapshot);
    }

    /// Forgets the request: no further chunk is emitted for it, not even a final one — the
    /// caller asked, so it knows. `false` when there was nothing to cancel.
    pub fn cancel(&self, id: RequestId) -> bool {
        let snapshot = {
            let mut inner = self.inner.lock();
            if inner.active.remove(&id).is_none() {
                return false;
            }
            self.snapshot_of(&inner)
        };
        tracing::debug!(id, "translation cancelled");
        self.changed(&snapshot);
        true
    }

    /// Whether `id` is still wanted.
    #[must_use]
    pub fn is_active(&self, id: RequestId) -> bool {
        self.inner.lock().active.contains_key(&id)
    }

    /// Runs `job` to its end over the translator: opens the stream, delivers each piece while
    /// the request is wanted, then finishes. A cancel in the middle stops the reading at the
    /// next piece.
    pub async fn run(&self, job: Job) {
        let id = job.id;
        let mut chunks = match self.translator.open(job.request).await {
            Ok(chunks) => chunks,
            Err(error) => {
                self.finish(id, Err(error));
                return;
            }
        };
        if !self.is_active(id) {
            return;
        }
        loop {
            match chunks.next().await {
                Some(Delta::Text(text)) => {
                    if !self.deliver(id, &text) {
                        return;
                    }
                }
                Some(Delta::Done) | None => {
                    self.finish(id, Ok(()));
                    return;
                }
                Some(Delta::Failed(error)) => {
                    self.finish(id, Err(error));
                    return;
                }
            }
        }
    }

    fn snapshot_of(&self, inner: &Inner) -> TranslationSnapshot {
        let provider = inner.settings.provider;
        let has_key = self
            .platform
            .secrets()
            .get(&provider.key_entry())
            .ok()
            .flatten()
            .is_some();
        TranslationSnapshot {
            enabled: inner.settings.enabled,
            provider,
            endpoint: inner.settings.effective_endpoint(),
            model: inner.settings.effective_model(),
            has_key,
            needs_key: provider.needs_key(),
            active: u32::try_from(inner.active.len()).unwrap_or(u32::MAX),
        }
    }

    fn emit(&self, chunk: &TranslationChunk) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.chunk(chunk);
        }
    }

    fn changed(&self, snapshot: &TranslationSnapshot) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.changed(snapshot);
        }
    }
}

/// The backend: nothing runs on its own — every request starts from the panel, through the
/// IPC layer, and ends with its stream.
#[derive(Debug, Clone)]
pub struct TranslationModule(pub Arc<TranslationService>);

impl ModuleBackend for TranslationModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Panel, Surface::Widget]
    }

    fn start(&self, _ctx: ModuleCtx) -> anyhow::Result<()> {
        Ok(())
    }
}
