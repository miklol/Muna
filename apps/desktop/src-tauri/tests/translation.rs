//! The `translation` module against `FakePlatform` and a scripted translator
//! (docs/modules/translation.md acceptance criteria, docs/build-plan/m5-ship.md E1d and spike
//! S2). Integration tests because the `muna` lib cannot host unit tests (Common Controls
//! manifest on Tauri-linked tests).
//!
//! The service is a reducer around the provider's stream: the tests call `begin`, `deliver`,
//! `finish` and `cancel` in place of the loop, and run the loop itself over a translator that
//! streams scripted pieces — with a hook between them, so spike S2 cancels after the second of
//! five and checks that nothing more comes out. No test opens a socket.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use muna_core::{Clock, FakeClock, Hub, Settings, Store};
use muna_lib::modules::translation::provider::{
    BoxFuture, Request, decode_ndjson_line, decode_sse_line, is_local_host, language_name,
    request_body, route,
};
use muna_lib::modules::translation::{
    AUTO, Chunks, Decoder, Delta, ID, Job, Key, KeyError, MAX_KEY_CHARS, MAX_OUTPUT_CHARS,
    MAX_TEXT_CHARS, TranslateError, TranslateRequest, TranslationChunk, TranslationProvider,
    TranslationService, TranslationSettings, TranslationSink, TranslationSnapshot, Translator,
    Wire, check_endpoint, normalise_key, system_prompt,
};
use muna_lib::modules::{ModuleServices, Surface, backends};
use muna_platform::{FakePlatform, Platform};
use parking_lot::Mutex;

const KEY: &str = "sk-example-0123456789abcdefghijklmnopqrstuvwxyz";

/// What the translator streams, or why it does not open.
#[derive(Clone)]
enum Script {
    Stream(Vec<Delta>),
    Refuse(TranslateError),
}

type Hook = Arc<dyn Fn(usize) + Send + Sync>;

/// A translator that never makes a request: the answer is scripted, every request is recorded
/// (so the tests can check what would have been sent, and that nothing was), and a hook runs
/// after each piece is handed out — where spike S2 cancels.
struct ScriptedTranslator {
    script: Mutex<Script>,
    requests: Mutex<Vec<Request>>,
    hook: Mutex<Option<Hook>>,
}

impl ScriptedTranslator {
    fn new(script: Script) -> Self {
        Self {
            script: Mutex::new(script),
            requests: Mutex::new(Vec::new()),
            hook: Mutex::new(None),
        }
    }

    fn set_hook(&self, hook: impl Fn(usize) + Send + Sync + 'static) {
        *self.hook.lock() = Some(Arc::new(hook));
    }
}

impl Translator for ScriptedTranslator {
    fn open(&self, request: Request) -> BoxFuture<'_, Result<Box<dyn Chunks>, TranslateError>> {
        self.requests.lock().push(request);
        let script = self.script.lock().clone();
        let hook = self.hook.lock().clone();
        Box::pin(async move {
            match script {
                Script::Refuse(error) => Err(error),
                Script::Stream(deltas) => Ok(Box::new(ScriptedChunks {
                    deltas: deltas.into_iter().collect(),
                    handed: 0,
                    hook,
                }) as Box<dyn Chunks>),
            }
        })
    }

    fn name(&self) -> &'static str {
        "scripted"
    }
}

struct ScriptedChunks {
    deltas: std::collections::VecDeque<Delta>,
    handed: usize,
    hook: Option<Hook>,
}

impl Chunks for ScriptedChunks {
    fn next(&mut self) -> BoxFuture<'_, Option<Delta>> {
        Box::pin(async move {
            // The hook runs after the previous piece was delivered, before the next is read.
            if self.handed > 0
                && let Some(hook) = &self.hook
            {
                hook(self.handed);
            }
            let delta = self.deltas.pop_front();
            if delta.is_some() {
                self.handed += 1;
            }
            delta
        })
    }
}

#[derive(Default)]
struct Recorder {
    chunks: Mutex<Vec<TranslationChunk>>,
    snapshots: Mutex<Vec<TranslationSnapshot>>,
}

impl TranslationSink for Recorder {
    fn chunk(&self, chunk: &TranslationChunk) {
        self.chunks.lock().push(chunk.clone());
    }

    fn changed(&self, snapshot: &TranslationSnapshot) {
        self.snapshots.lock().push(snapshot.clone());
    }
}

struct Rig {
    platform: Arc<FakePlatform>,
    translator: Arc<ScriptedTranslator>,
    service: Arc<TranslationService>,
    recorder: Arc<Recorder>,
}

impl Rig {
    fn new(script: Script) -> Self {
        let platform = Arc::new(FakePlatform::new());
        let translator = Arc::new(ScriptedTranslator::new(script));
        let service = Arc::new(TranslationService::new(
            Arc::clone(&platform) as Arc<dyn Platform>,
            Arc::clone(&translator) as Arc<dyn Translator>,
        ));
        let recorder = Arc::new(Recorder::default());
        service.set_sink(Arc::clone(&recorder) as Arc<dyn TranslationSink>);
        Self {
            platform,
            translator,
            service,
            recorder,
        }
    }

    /// A rig with the module on and a key in the vault, ready to translate.
    fn ready(script: Script) -> Self {
        let rig = Self::new(script);
        rig.apply(&enabled());
        rig.service.set_key(KEY).unwrap();
        rig.recorder.chunks.lock().clear();
        rig.recorder.snapshots.lock().clear();
        rig
    }

    fn apply(&self, settings: &TranslationSettings) {
        self.service.apply_settings(&document(settings));
    }

    fn chunks_for(&self, id: u32) -> Vec<TranslationChunk> {
        self.recorder
            .chunks
            .lock()
            .iter()
            .filter(|chunk| chunk.request_id == id)
            .cloned()
            .collect()
    }

    fn begin(&self, text: &str) -> Job {
        self.service
            .begin(TranslateRequest {
                text: text.to_owned(),
                source: None,
                target: None,
            })
            .expect("begins")
    }
}

fn document(settings: &TranslationSettings) -> Settings {
    let mut document = Settings::default();
    settings.write(&mut document).unwrap();
    document
}

fn enabled() -> TranslationSettings {
    TranslationSettings {
        enabled: true,
        target: "de".to_owned(),
        ..TranslationSettings::default()
    }
}

fn five_pieces() -> Script {
    Script::Stream(vec![
        Delta::Text("Guten".to_owned()),
        Delta::Text(" Morgen".to_owned()),
        Delta::Text(",".to_owned()),
        Delta::Text(" Welt".to_owned()),
        Delta::Text(".".to_owned()),
        Delta::Done,
    ])
}

fn texts(chunks: &[TranslationChunk]) -> String {
    chunks.iter().map(|chunk| chunk.text.as_str()).collect()
}

// --- registry and settings -----------------------------------------------------------------

#[test]
fn registry_has_the_module_with_a_panel_and_a_widget() {
    let platform: Arc<dyn Platform> = Arc::new(FakePlatform::new());
    let clock = Arc::new(FakeClock::new());
    let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
    let store = Arc::new(Store::open_in_memory().unwrap());
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
        .expect("translation is registered");
    assert_eq!(backend.capabilities(), &[Surface::Panel, Surface::Widget]);
    let snapshot = services.translation.snapshot();
    assert!(!snapshot.enabled, "off until the user turns it on");
    assert_eq!(snapshot.provider, TranslationProvider::OpenAi);
    assert_eq!(snapshot.endpoint, "https://api.openai.com/v1");
    assert_eq!(snapshot.model, "gpt-4o-mini");
    assert!(!snapshot.has_key);
    assert!(snapshot.needs_key);
    assert_eq!(snapshot.active, 0);
}

#[test]
fn settings_default_to_off_openai_auto_to_english() {
    let settings = TranslationSettings::from_document(&Settings::default());
    assert_eq!(settings, TranslationSettings::default());
    assert!(!settings.enabled);
    assert_eq!(settings.source, AUTO);
    assert_eq!(settings.target, "en");
    assert_eq!(settings.effective_endpoint(), "https://api.openai.com/v1");
    assert_eq!(settings.effective_model(), "gpt-4o-mini");
    assert_eq!(
        serde_json::to_value(&settings).unwrap(),
        serde_json::json!({
            "enabled": false,
            "provider": "openai",
            "endpoint": "",
            "model": "",
            "source": "auto",
            "target": "en",
        }),
        "the wire names match packages/contracts"
    );
    assert_eq!(
        serde_json::to_value(TranslationProvider::Ollama).unwrap(),
        serde_json::json!("ollama")
    );
}

#[test]
fn settings_round_trip_and_blank_fields_mean_the_provider_defaults() {
    let settings = TranslationSettings {
        enabled: true,
        provider: TranslationProvider::Ollama,
        endpoint: "  http://desk.local:11434/ ".to_owned(),
        model: "  ".to_owned(),
        source: "fr".to_owned(),
        target: "ja".to_owned(),
    };
    let parsed = TranslationSettings::from_document(&document(&settings));
    assert_eq!(parsed, settings);
    assert_eq!(parsed.effective_endpoint(), "http://desk.local:11434");
    assert_eq!(parsed.effective_model(), "llama3.2");
    assert_eq!(parsed.provider.key_entry(), "translation.ollama.key");
    assert!(!parsed.provider.needs_key());
}

#[test]
fn malformed_settings_fall_back_to_defaults_and_blank_tags_are_repaired() {
    let mut document = Settings::default();
    document
        .modules
        .insert(ID.to_owned(), serde_json::json!({ "enabled": "yes" }));
    assert_eq!(
        TranslationSettings::from_document(&document),
        TranslationSettings::default()
    );
    document.modules.insert(
        ID.to_owned(),
        serde_json::json!({ "enabled": true, "source": " ", "target": "", "extra": 1 }),
    );
    let parsed = TranslationSettings::from_document(&document);
    assert!(parsed.enabled);
    assert_eq!(parsed.source, AUTO);
    assert_eq!(parsed.target, "en");
}

// --- keys -----------------------------------------------------------------------------------

#[test]
fn keys_are_kept_in_the_vault_under_the_provider_entry_and_never_come_back() {
    let rig = Rig::new(five_pieces());
    let snapshot = rig.service.set_key(&format!("  {KEY}\n")).unwrap();
    assert!(snapshot.has_key);
    assert_eq!(
        rig.platform.secret("translation.openai.key").as_deref(),
        Some(KEY),
        "trimmed, under the OpenAI entry"
    );
    assert_eq!(rig.platform.secret_keys(), vec!["translation.openai.key"]);
    let snapshot = rig.service.clear_key().unwrap();
    assert!(!snapshot.has_key);
    assert!(rig.platform.secret_keys().is_empty());
    assert_eq!(
        rig.recorder.snapshots.lock().len(),
        2,
        "both changes were announced"
    );
}

#[test]
fn the_key_follows_the_provider() {
    let rig = Rig::new(five_pieces());
    rig.apply(&TranslationSettings {
        provider: TranslationProvider::Ollama,
        ..enabled()
    });
    rig.service.set_key("local-token").unwrap();
    assert_eq!(
        rig.platform.secret("translation.ollama.key").as_deref(),
        Some("local-token")
    );
    rig.apply(&enabled());
    assert!(
        !rig.service.snapshot().has_key,
        "the OpenAI entry is empty; the Ollama key stays where it is"
    );
    assert_eq!(
        rig.platform.secret("translation.ollama.key").as_deref(),
        Some("local-token")
    );
}

#[test]
fn malformed_keys_are_refused_before_the_vault() {
    let rig = Rig::new(five_pieces());
    assert_eq!(rig.service.set_key("   ").unwrap_err(), KeyError::Empty);
    assert_eq!(
        rig.service.set_key("sk with spaces").unwrap_err(),
        KeyError::Malformed
    );
    assert_eq!(
        rig.service.set_key("sk-\"quoted\"").unwrap_err(),
        KeyError::Malformed
    );
    assert_eq!(
        rig.service
            .set_key(&"k".repeat(MAX_KEY_CHARS + 1))
            .unwrap_err(),
        KeyError::Malformed
    );
    assert!(rig.platform.secret_keys().is_empty());
    assert_eq!(normalise_key(" ok-key ").unwrap(), "ok-key");
}

#[test]
fn a_vault_that_refuses_is_reported_and_nothing_is_kept() {
    let rig = Rig::new(five_pieces());
    rig.platform.set_secrets_unavailable(true);
    assert_eq!(rig.service.set_key(KEY).unwrap_err(), KeyError::Vault);
    assert_eq!(rig.service.clear_key().unwrap_err(), KeyError::Vault);
    rig.apply(&enabled());
    assert_eq!(
        rig.service
            .begin(TranslateRequest {
                text: "Hello".to_owned(),
                source: None,
                target: None,
            })
            .unwrap_err(),
        TranslateError::Vault
    );
}

// --- begin ----------------------------------------------------------------------------------

#[test]
fn nothing_is_sent_while_the_module_is_off() {
    let rig = Rig::new(five_pieces());
    rig.service.set_key(KEY).unwrap();
    let refused = rig.service.begin(TranslateRequest {
        text: "Hello".to_owned(),
        source: None,
        target: None,
    });
    assert_eq!(refused.unwrap_err(), TranslateError::Disabled);
    assert!(rig.translator.requests.lock().is_empty());
    assert!(rig.recorder.chunks.lock().is_empty());
}

#[test]
fn begin_checks_the_text_and_the_key() {
    let rig = Rig::new(five_pieces());
    rig.apply(&enabled());
    let attempt = |text: String| {
        rig.service.begin(TranslateRequest {
            text,
            source: None,
            target: None,
        })
    };
    assert_eq!(
        attempt("Hello".to_owned()).unwrap_err(),
        TranslateError::NoKey,
        "OpenAI without a key"
    );
    rig.service.set_key(KEY).unwrap();
    assert_eq!(
        attempt("  \n ".to_owned()).unwrap_err(),
        TranslateError::Empty
    );
    assert_eq!(
        attempt("x".repeat(MAX_TEXT_CHARS + 1)).unwrap_err(),
        TranslateError::TooLong
    );
    let job = attempt("x".repeat(MAX_TEXT_CHARS)).expect("exactly the limit is fine");
    assert_eq!(job.id, 1);
    assert!(rig.service.is_active(1));
}

#[test]
fn ollama_needs_no_key_and_the_request_carries_the_route_and_the_pair() {
    let rig = Rig::new(five_pieces());
    rig.apply(&TranslationSettings {
        provider: TranslationProvider::Ollama,
        endpoint: "http://127.0.0.1:11434/".to_owned(),
        model: "gemma3".to_owned(),
        source: AUTO.to_owned(),
        target: "es".to_owned(),
        ..enabled()
    });
    let job = rig
        .service
        .begin(TranslateRequest {
            text: " Good morning ".to_owned(),
            source: Some("en".to_owned()),
            target: Some(String::new()),
        })
        .unwrap();
    let request = &job.request;
    assert_eq!(request.provider, TranslationProvider::Ollama);
    assert_eq!(
        request.endpoint, "http://127.0.0.1:11434",
        "trailing slash dropped"
    );
    assert_eq!(request.model, "gemma3");
    assert!(request.key.is_none());
    assert_eq!(request.source, "en", "the panel's choice wins");
    assert_eq!(request.target, "es", "a blank choice means the setting");
    assert_eq!(request.text, "Good morning", "trimmed");
    assert_eq!(route(TranslationProvider::Ollama), "/api/chat");
    assert_eq!(route(TranslationProvider::OpenAi), "/chat/completions");
}

#[test]
fn a_plain_http_endpoint_outside_the_local_network_is_refused() {
    let rig = Rig::new(five_pieces());
    rig.apply(&TranslationSettings {
        endpoint: "http://api.example.com/v1".to_owned(),
        ..enabled()
    });
    rig.service.set_key(KEY).unwrap();
    assert_eq!(
        rig.service
            .begin(TranslateRequest {
                text: "Hello".to_owned(),
                source: None,
                target: None,
            })
            .unwrap_err(),
        TranslateError::Endpoint
    );
    assert!(rig.translator.requests.lock().is_empty());
}

#[test]
fn endpoints_are_https_or_local_http() {
    assert!(check_endpoint("https://api.openai.com/v1").is_ok());
    assert!(check_endpoint("https://openrouter.ai/api/v1").is_ok());
    assert!(check_endpoint("http://127.0.0.1:11434").is_ok());
    assert!(check_endpoint("http://localhost:1234/v1").is_ok());
    assert!(check_endpoint("http://[::1]:11434").is_ok());
    assert!(check_endpoint("http://192.168.1.20:11434").is_ok());
    assert!(check_endpoint("http://10.0.0.5:8080/v1").is_ok());
    assert!(check_endpoint("http://desk.local:11434").is_ok());
    assert!(check_endpoint("http://nas:11434").is_ok());
    assert_eq!(
        check_endpoint("http://api.example.com/v1").unwrap_err(),
        TranslateError::Endpoint
    );
    assert_eq!(
        check_endpoint("http://8.8.8.8/v1").unwrap_err(),
        TranslateError::Endpoint
    );
    assert_eq!(
        check_endpoint("ftp://example.com").unwrap_err(),
        TranslateError::Endpoint
    );
    assert_eq!(
        check_endpoint("not a url").unwrap_err(),
        TranslateError::Endpoint
    );
    assert!(is_local_host("fe80::1"));
    assert!(is_local_host("home.home.arpa"));
    assert!(!is_local_host("example.com"));
}

#[test]
fn the_request_debug_never_shows_the_text_or_the_key() {
    let request = Request {
        provider: TranslationProvider::OpenAi,
        endpoint: "https://api.openai.com/v1".to_owned(),
        model: "gpt-4o-mini".to_owned(),
        key: Some(Key(KEY.to_owned())),
        source: AUTO.to_owned(),
        target: "de".to_owned(),
        text: "a private sentence".to_owned(),
    };
    let debug = format!("{request:?}");
    assert!(!debug.contains("private sentence"));
    assert!(!debug.contains(KEY));
    assert!(debug.contains("chars: 18"));
    assert_eq!(format!("{:?}", Key(KEY.to_owned())), "Key(…)");
}

// --- the stream -----------------------------------------------------------------------------

#[tokio::test]
async fn a_translation_streams_every_piece_then_a_final_chunk() {
    let rig = Rig::ready(five_pieces());
    let job = rig.begin("Good morning, world.");
    let id = job.id;
    rig.service.run(job).await;
    let chunks = rig.chunks_for(id);
    assert_eq!(chunks.len(), 6, "five pieces and the end");
    assert!(
        chunks[..5]
            .iter()
            .all(|chunk| !chunk.done && chunk.error.is_none())
    );
    assert_eq!(texts(&chunks[..5]), "Guten Morgen, Welt.");
    let last = chunks.last().unwrap();
    assert!(last.done);
    assert!(last.text.is_empty());
    assert_eq!(last.error, None);
    assert!(!rig.service.is_active(id));
    assert_eq!(rig.service.snapshot().active, 0);
    let sent = rig.translator.requests.lock();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].key, Some(Key(KEY.to_owned())));
    assert_eq!(sent[0].target, "de");
}

/// Spike S2 (docs/build-plan/m5-ship.md): five pieces, a cancel after the second, and no
/// further `TranslationChunk` — not even a final one.
#[tokio::test]
async fn spike_s2_a_cancel_after_the_second_piece_leaves_no_further_chunk() {
    let rig = Rig::ready(five_pieces());
    let job = rig.begin("Good morning, world.");
    let id = job.id;
    let service = Arc::clone(&rig.service);
    let cancelled = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&cancelled);
    rig.translator.set_hook(move |handed| {
        if handed == 2 {
            assert!(service.cancel(id), "the request was still active");
            count.fetch_add(1, Ordering::SeqCst);
        }
    });
    rig.service.run(job).await;
    assert_eq!(
        cancelled.load(Ordering::SeqCst),
        1,
        "cancelled exactly once"
    );
    let chunks = rig.chunks_for(id);
    assert_eq!(
        chunks.len(),
        2,
        "the two pieces before the cancel and nothing after"
    );
    assert_eq!(texts(&chunks), "Guten Morgen");
    assert!(chunks.iter().all(|chunk| !chunk.done));
    assert!(!rig.service.is_active(id));
    assert!(!rig.service.cancel(id), "nothing left to cancel");
    assert_eq!(rig.service.snapshot().active, 0);
}

#[tokio::test]
async fn a_cancel_before_the_stream_opens_drops_the_answer_entirely() {
    let rig = Rig::ready(five_pieces());
    let job = rig.begin("Good morning");
    let id = job.id;
    assert!(rig.service.cancel(id));
    rig.service.run(job).await;
    assert!(rig.chunks_for(id).is_empty());
    assert_eq!(
        rig.translator.requests.lock().len(),
        1,
        "the request had already gone out"
    );
}

#[tokio::test]
async fn a_refused_request_ends_with_one_final_chunk_naming_the_failure() {
    for error in [
        TranslateError::Unauthorized,
        TranslateError::RateLimited,
        TranslateError::ModelMissing,
        TranslateError::Offline,
        TranslateError::Provider,
    ] {
        let rig = Rig::ready(Script::Refuse(error));
        let job = rig.begin("Hello");
        let id = job.id;
        rig.service.run(job).await;
        let chunks = rig.chunks_for(id);
        assert_eq!(chunks.len(), 1, "{error:?}");
        assert!(chunks[0].done);
        assert_eq!(chunks[0].error, Some(error));
        assert!(!rig.service.is_active(id));
    }
}

#[tokio::test]
async fn a_failure_in_the_stream_keeps_the_pieces_so_far_and_names_it() {
    let rig = Rig::ready(Script::Stream(vec![
        Delta::Text("Guten".to_owned()),
        Delta::Failed(TranslateError::Provider),
        Delta::Text(" never".to_owned()),
    ]));
    let job = rig.begin("Good morning");
    let id = job.id;
    rig.service.run(job).await;
    let chunks = rig.chunks_for(id);
    assert_eq!(chunks.len(), 2);
    assert_eq!(chunks[0].text, "Guten");
    assert!(chunks[1].done);
    assert_eq!(chunks[1].error, Some(TranslateError::Provider));
}

#[tokio::test]
async fn a_stream_that_ends_without_done_is_finished_anyway() {
    let rig = Rig::ready(Script::Stream(vec![Delta::Text("Hallo".to_owned())]));
    let job = rig.begin("Hello");
    let id = job.id;
    rig.service.run(job).await;
    let chunks = rig.chunks_for(id);
    assert_eq!(chunks.len(), 2);
    assert!(chunks[1].done);
    assert_eq!(chunks[1].error, None);
}

#[test]
fn an_answer_over_the_size_limit_is_cut_with_a_failure() {
    let rig = Rig::ready(five_pieces());
    let job = rig.begin("Hello");
    let id = job.id;
    let piece = "x".repeat(MAX_OUTPUT_CHARS / 2);
    assert!(rig.service.deliver(id, &piece));
    assert!(
        rig.service.deliver(id, &piece),
        "exactly the limit still fits"
    );
    assert!(!rig.service.deliver(id, "y"), "one more is too much");
    let chunks = rig.chunks_for(id);
    assert_eq!(chunks.len(), 3);
    assert!(chunks[2].done);
    assert_eq!(chunks[2].error, Some(TranslateError::Provider));
    assert!(
        !rig.service.deliver(id, "z"),
        "finished requests take nothing"
    );
    assert_eq!(rig.chunks_for(id).len(), 3);
}

#[test]
fn requests_get_distinct_ids_and_run_side_by_side() {
    let rig = Rig::ready(five_pieces());
    let first = rig.begin("one");
    let second = rig.begin("two");
    assert_ne!(first.id, second.id);
    assert_eq!(rig.service.snapshot().active, 2);
    assert!(rig.service.deliver(second.id, "zwei"));
    rig.service.finish(first.id, Ok(()));
    assert!(rig.service.is_active(second.id));
    assert_eq!(rig.chunks_for(first.id).len(), 1);
    assert_eq!(rig.chunks_for(second.id).len(), 1);
    rig.service.finish(second.id, Ok(()));
    assert_eq!(rig.service.snapshot().active, 0);
}

#[test]
fn a_route_change_drops_what_is_in_flight_but_a_language_change_does_not() {
    let rig = Rig::ready(five_pieces());
    let job = rig.begin("Hello");
    rig.apply(&TranslationSettings {
        target: "fr".to_owned(),
        ..enabled()
    });
    assert!(
        rig.service.is_active(job.id),
        "the pair is the panel's business"
    );
    rig.apply(&TranslationSettings {
        model: "gpt-4.1".to_owned(),
        target: "fr".to_owned(),
        ..enabled()
    });
    assert!(
        !rig.service.is_active(job.id),
        "the answer would be from the old model"
    );
    assert!(rig.chunks_for(job.id).is_empty(), "dropped without a chunk");
    let job = rig.begin("Hello again");
    rig.apply(&TranslationSettings {
        enabled: false,
        ..enabled()
    });
    assert!(!rig.service.is_active(job.id), "off drops it too");
    rig.service.finish(job.id, Ok(()));
    assert!(
        rig.chunks_for(job.id).is_empty(),
        "finishing a dropped request says nothing"
    );
}

// --- the prompt and the body -----------------------------------------------------------------

#[test]
fn the_prompt_asks_for_the_translation_and_nothing_else() {
    let prompt = system_prompt(AUTO, "de");
    assert!(prompt.contains("into German"));
    assert!(!prompt.contains(" from "), "auto-detect names no source");
    assert!(prompt.contains("translation only"));
    let prompt = system_prompt("en-GB", "zh-Hant");
    assert!(prompt.contains("from British English into Traditional Chinese"));
    assert_eq!(language_name("pt-BR"), "Brazilian Portuguese");
    assert_eq!(language_name("nb"), "Norwegian");
    assert_eq!(language_name("tlh"), "tlh", "unknown tags pass through");
}

#[test]
fn the_body_streams_and_carries_the_prompt_for_each_provider() {
    let mut request = Request {
        provider: TranslationProvider::OpenAi,
        endpoint: "https://api.openai.com/v1".to_owned(),
        model: "gpt-4o-mini".to_owned(),
        key: Some(Key(KEY.to_owned())),
        source: "en".to_owned(),
        target: "de".to_owned(),
        text: "Hello".to_owned(),
    };
    let body = request_body(&request);
    assert_eq!(body["model"], "gpt-4o-mini");
    assert_eq!(body["stream"], true);
    assert_eq!(body["messages"][0]["role"], "system");
    assert_eq!(body["messages"][1]["content"], "Hello");
    assert!(body["options"].is_null());
    assert!(
        !body.to_string().contains(KEY),
        "the key goes in the header, never the body"
    );
    request.provider = TranslationProvider::Ollama;
    request.model = "llama3.2".to_owned();
    let body = request_body(&request);
    assert_eq!(body["model"], "llama3.2");
    assert_eq!(body["stream"], true);
    assert!(body["options"]["temperature"].is_number());
    assert!(body["temperature"].is_null());
}

// --- the decoders ----------------------------------------------------------------------------

#[test]
fn sse_lines_decode_to_deltas() {
    assert_eq!(
        decode_sse_line(r#"data: {"choices":[{"delta":{"content":"Gu"}}]}"#),
        Some(Delta::Text("Gu".to_owned()))
    );
    assert_eq!(
        decode_sse_line(r#"data:{"choices":[{"delta":{"role":"assistant","content":""}}]}"#),
        None,
        "the role event carries no text"
    );
    assert_eq!(
        decode_sse_line(r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}]}"#),
        None
    );
    assert_eq!(decode_sse_line("data: [DONE]"), Some(Delta::Done));
    assert_eq!(decode_sse_line(": keep-alive"), None);
    assert_eq!(decode_sse_line("event: message"), None);
    assert_eq!(decode_sse_line(""), None);
    assert_eq!(
        decode_sse_line(r#"data: {"error":{"message":"boom"}}"#),
        Some(Delta::Failed(TranslateError::Provider))
    );
    assert_eq!(
        decode_sse_line("data: not json"),
        Some(Delta::Failed(TranslateError::Provider))
    );
}

#[test]
fn ndjson_lines_decode_to_deltas() {
    assert_eq!(
        decode_ndjson_line(r#"{"message":{"role":"assistant","content":"Gu"},"done":false}"#),
        Some(Delta::Text("Gu".to_owned()))
    );
    assert_eq!(
        decode_ndjson_line(r#"{"message":{"role":"assistant","content":""},"done":true}"#),
        Some(Delta::Done)
    );
    assert_eq!(
        decode_ndjson_line(r#"{"message":{"content":"."},"done":true}"#),
        Some(Delta::Text(".".to_owned())),
        "a tail of text on the last line is still text"
    );
    assert_eq!(decode_ndjson_line("   "), None);
    assert_eq!(
        decode_ndjson_line(r#"{"error":"model 'nope' not found"}"#),
        Some(Delta::Failed(TranslateError::ModelMissing))
    );
    assert_eq!(
        decode_ndjson_line(r#"{"error":"something else"}"#),
        Some(Delta::Failed(TranslateError::Provider))
    );
    assert_eq!(
        decode_ndjson_line("{broken"),
        Some(Delta::Failed(TranslateError::Provider))
    );
}

#[test]
fn the_decoder_joins_lines_across_chunk_boundaries() {
    let mut decoder = Decoder::new(Wire::Sse);
    let stream = "data: {\"choices\":[{\"delta\":{\"content\":\"Gu\"}}]}\n\n\
                  data: {\"choices\":[{\"delta\":{\"content\":\"ten\"}}]}\r\n\r\n\
                  data: [DONE]\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"late\"}}]}\n";
    let mut deltas = Vec::new();
    // Seven bytes at a time: every line is split somewhere.
    for piece in stream.as_bytes().chunks(7) {
        deltas.extend(decoder.feed(piece));
    }
    deltas.extend(decoder.finish());
    assert_eq!(
        deltas,
        vec![
            Delta::Text("Gu".to_owned()),
            Delta::Text("ten".to_owned()),
            Delta::Done,
        ],
        "nothing after [DONE]"
    );
    assert_eq!(Wire::for_provider(TranslationProvider::OpenAi), Wire::Sse);
    assert_eq!(
        Wire::for_provider(TranslationProvider::Ollama),
        Wire::Ndjson
    );
}

#[test]
fn the_decoder_flushes_a_last_line_without_a_line_break() {
    let mut decoder = Decoder::new(Wire::Ndjson);
    let mut deltas = decoder.feed(br#"{"message":{"content":"Hal"},"done":false}"#);
    assert!(deltas.is_empty(), "no line break yet");
    deltas.extend(decoder.feed(b"\n"));
    deltas.extend(decoder.feed(br#"{"message":{"content":"lo"},"done":true}"#));
    deltas.extend(decoder.finish());
    assert_eq!(
        deltas,
        vec![Delta::Text("Hal".to_owned()), Delta::Text("lo".to_owned())]
    );
    assert!(decoder.finish().is_empty(), "finishing twice adds nothing");
}

#[test]
fn the_decoder_gives_up_on_an_endless_line() {
    let mut decoder = Decoder::new(Wire::Sse);
    let piece = vec![b'x'; 64 * 1024];
    let mut deltas = Vec::new();
    for _ in 0..5 {
        deltas.extend(decoder.feed(&piece));
    }
    assert_eq!(deltas, vec![Delta::Failed(TranslateError::Provider)]);
    assert!(decoder.feed(b"data: [DONE]\n").is_empty());
}
