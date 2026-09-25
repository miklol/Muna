//! The `media` module backend (docs/modules/media.md): now-playing from the OS's media
//! sessions, artwork prepared by `muna-core::artwork`, one strip activity, and transport
//! commands with a watchdog.
//!
//! [`MediaService`] is the shared object: the backend feeds it platform events, the IPC
//! commands query and drive it, and it tells a [`MediaSink`] (the Tauri event bridge in
//! production, a recorder in tests) whenever the UI has something new to render. Everything
//! that reasons about sessions is synchronous and free of Tauri so `tests/media.rs` can drive
//! it with the fake platform; the backend only adds the event loop and the timers.

pub mod scoring;
pub mod settings;
pub mod tracker;

use std::sync::Arc;
use std::time::Duration;

use muna_core::{ArtCache, Artwork, Hub, Settings, artwork};
use muna_platform::{MediaCommand, MediaSession, Platform, PlatformError, PlatformEvent};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use settings::{MediaSettings, Visualiser};
pub use tracker::{ACTIVITY_ID, ArtRequest, MediaState, MediaTracker, Observation};

pub const ID: &str = "media";

/// Tracks kept on disk. Pass-through PNG art from Spotify measures 115–320 KB per entry on
/// hardware, so this is ≈ 30 MB at worst (docs/modules/media.md).
pub const ART_CACHE_ENTRIES: usize = 100;
/// How long a transport command may go unacknowledged (no new snapshot from that app) before
/// the module asks the platform to rebuild its session list (docs/modules/media.md,
/// "Command watchdog").
pub const COMMAND_TIMEOUT: Duration = Duration::from_millis(2000);

/// What `get_media_snapshot` returns: the state plus the pixels, so a window that just opened
/// needs one round trip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MediaSnapshot {
    pub state: MediaState,
    pub art: Option<Artwork>,
}

/// Where the module reports changes; the shell bridges it to Tauri events.
pub trait MediaSink: Send + Sync {
    fn state_changed(&self, state: &MediaState);
    fn art_changed(&self, art: Option<&Artwork>);
}

pub struct MediaService {
    platform: Arc<dyn Platform>,
    hub: Arc<Hub>,
    tracker: Mutex<MediaTracker>,
    cache: Option<ArtCache>,
    sink: Mutex<Option<Arc<dyn MediaSink>>>,
}

impl std::fmt::Debug for MediaService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MediaService")
            .field("platform", &self.platform.name())
            .field("cache", &self.cache.as_ref().map(ArtCache::dir))
            .finish_non_exhaustive()
    }
}

impl MediaService {
    /// `cache` is where prepared artwork is kept between launches; `None` keeps it in memory
    /// only (tests, tooling).
    #[must_use]
    pub fn new(platform: Arc<dyn Platform>, hub: Arc<Hub>, cache: Option<ArtCache>) -> Self {
        Self {
            platform,
            hub,
            tracker: Mutex::new(MediaTracker::new()),
            cache,
            sink: Mutex::new(None),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn MediaSink>) {
        *self.sink.lock() = Some(sink);
    }

    #[must_use]
    pub fn snapshot(&self) -> MediaSnapshot {
        let tracker = self.tracker.lock();
        MediaSnapshot {
            state: tracker.state(),
            art: tracker.artwork().cloned(),
        }
    }

    /// Reads the platform's current sessions (start-up and after a refresh).
    pub fn sync(&self) -> Observation {
        match self.platform.media().sessions() {
            Ok(sessions) => self.observe(sessions),
            Err(PlatformError::Unsupported(_)) => Observation::default(),
            Err(error) => {
                tracing::warn!(%error, "media sessions unavailable");
                Observation::default()
            }
        }
    }

    /// Absorbs one snapshot: strip activity, state event, artwork bookkeeping. The caller
    /// fetches `Observation::fetch_art` (see [`Self::load_art`]) because that is blocking I/O.
    pub fn observe(&self, sessions: Vec<MediaSession>) -> Observation {
        let (observation, activity, state) = {
            let mut tracker = self.tracker.lock();
            let observation = tracker.observe(sessions);
            (observation, tracker.activity(), tracker.state())
        };
        self.apply(&observation, activity, &state);
        observation
    }

    /// Pins one app (`None` follows the scoring again).
    pub fn set_pinned(&self, pinned: Option<String>) -> Observation {
        let (observation, activity, state) = {
            let mut tracker = self.tracker.lock();
            let observation = tracker.set_pinned(pinned);
            (observation, tracker.activity(), tracker.state())
        };
        self.apply(&observation, activity, &state);
        observation
    }

    /// The pinned app, if any.
    #[must_use]
    pub fn pinned(&self) -> Option<String> {
        self.tracker.lock().pinned().map(str::to_owned)
    }

    /// Applies `settings.modules.media` (start-up and every settings change): the preferred
    /// app is pinned and the strip presentation switches take effect.
    pub fn apply_settings(&self, settings: &Settings) -> Observation {
        let media = MediaSettings::from_document(settings);
        let (observation, activity, state) = {
            let mut tracker = self.tracker.lock();
            let observation = tracker.set_settings(&media);
            (observation, tracker.activity(), tracker.state())
        };
        self.apply(&observation, activity, &state);
        observation
    }

    /// Fetches, prepares and applies the artwork for `request`. Blocking (thumbnail stream,
    /// decode, disk cache): run it off the async runtime.
    pub fn load_art(&self, request: &ArtRequest) {
        let cached = self
            .cache
            .as_ref()
            .and_then(|cache| cache.get(&request.key));
        let art = match cached {
            Some(art) => Some(art),
            None => self.fetch_art(request),
        };
        let Some(art) = art else {
            self.tracker.lock().art_failed(request);
            return;
        };
        let (applied, activity) = {
            let mut tracker = self.tracker.lock();
            let applied = tracker.set_art(&request.source_app_id, request.art_version, art);
            (applied, tracker.activity())
        };
        if !applied {
            return;
        }
        let snapshot = self.snapshot();
        self.publish(activity);
        self.emit_state(&snapshot.state);
        if let Some(sink) = self.sink() {
            sink.art_changed(snapshot.art.as_ref());
        }
    }

    fn fetch_art(&self, request: &ArtRequest) -> Option<Artwork> {
        let thumbnail = match self.platform.media().thumbnail(&request.source_app_id) {
            Ok(Some(thumbnail)) => thumbnail,
            Ok(None) => return None,
            Err(error) => {
                tracing::debug!(%error, "media thumbnail unavailable");
                return None;
            }
        };
        match artwork::prepare(&request.key, &thumbnail.bytes, &thumbnail.content_type) {
            Ok(art) => {
                if let Some(cache) = &self.cache
                    && let Err(error) = cache.put(&art)
                {
                    tracing::debug!(%error, "artwork cache write failed");
                }
                Some(art)
            }
            Err(error) => {
                tracing::debug!(%error, "artwork could not be prepared");
                None
            }
        }
    }

    /// Sends a transport command to `source_app_id` (the active session when `None`) and
    /// returns the snapshot count the watchdog compares against ([`Self::watchdog`]).
    pub fn send(
        &self,
        source_app_id: Option<&str>,
        command: MediaCommand,
    ) -> Result<u64, PlatformError> {
        let (target, tick) = {
            let tracker = self.tracker.lock();
            let target = match source_app_id {
                Some(id) => Some(id.to_owned()),
                None => tracker.active().map(|s| s.source_app_id.clone()),
            };
            (target, tracker.tick())
        };
        let Some(target) = target else {
            return Err(PlatformError::NotFound("no media session".into()));
        };
        self.platform.media().send(&target, command)?;
        Ok(tick)
    }

    /// The second half of the command watchdog: when no snapshot arrived since `tick`, the app
    /// may have quietly dropped its session — ask the platform to rebuild. Returns whether it
    /// did.
    pub fn watchdog(&self, tick: u64) -> bool {
        if self.tracker.lock().tick() != tick {
            return false;
        }
        tracing::info!("media command unacknowledged; refreshing sessions");
        if let Err(error) = self.platform.media().refresh() {
            tracing::debug!(%error, "media refresh failed");
        }
        true
    }

    /// Asks the platform to rebuild its session list now (settings "Refresh").
    pub fn refresh(&self) -> Result<(), PlatformError> {
        self.platform.media().refresh()
    }

    fn apply(
        &self,
        observation: &Observation,
        activity: Option<muna_core::Activity>,
        state: &MediaState,
    ) {
        if observation.activity_changed {
            // App id and status only: titles and artists are content (docs/modules/media.md).
            // `unix_ms` gives the latency harness a sub-second clock (the log's own is 1 s).
            tracing::info!(
                app = state.active.as_ref().map(|s| s.source_app_id.as_str()),
                status = ?state.active.as_ref().map(|s| s.status),
                sessions = state.sessions.len(),
                art_version = state.active.as_ref().map_or(0, |s| s.art_version),
                unix_ms = unix_ms(),
                "now playing changed"
            );
            self.publish(activity);
        }
        if observation.state_changed {
            self.emit_state(state);
        }
        if observation.art_cleared
            && let Some(sink) = self.sink()
        {
            sink.art_changed(None);
        }
    }

    fn publish(&self, activity: Option<muna_core::Activity>) {
        match activity {
            Some(activity) => self.hub.publish_activity(activity),
            None => self.hub.retract_activity(ACTIVITY_ID),
        }
    }

    fn emit_state(&self, state: &MediaState) {
        if let Some(sink) = self.sink() {
            sink.state_changed(state);
        }
    }

    fn sink(&self) -> Option<Arc<dyn MediaSink>> {
        self.sink.lock().clone()
    }
}

/// Milliseconds since the Unix epoch, for log lines a harness correlates with its own clock.
fn unix_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

/// Spawns the fetch for an observation's artwork, if any.
pub fn schedule_art(service: &Arc<MediaService>, observation: &Observation) {
    if let Some(request) = observation.fetch_art.clone() {
        let service = Arc::clone(service);
        tauri::async_runtime::spawn_blocking(move || service.load_art(&request));
    }
}

/// Sends a command and arms the watchdog for it.
pub fn send_with_watchdog(
    service: &Arc<MediaService>,
    source_app_id: Option<&str>,
    command: MediaCommand,
) -> Result<(), PlatformError> {
    let tick = service.send(source_app_id, command)?;
    let service = Arc::clone(service);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(COMMAND_TIMEOUT).await;
        service.watchdog(tick);
    });
    Ok(())
}

/// The backend: seeds the service from the platform and forwards session events to it.
#[derive(Debug, Clone)]
pub struct MediaModule(pub Arc<MediaService>);

impl ModuleBackend for MediaModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Strip, Surface::Panel]
    }

    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()> {
        let service = Arc::clone(&self.0);
        let mut events = ctx.platform.subscribe();
        schedule_art(&service, &service.sync());
        tauri::async_runtime::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(PlatformEvent::MediaSessionsChanged(sessions)) => {
                        schedule_art(&service, &service.observe(sessions));
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "media events lagged; resyncing");
                        schedule_art(&service, &service.sync());
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        Ok(())
    }
}
