//! System Media Transport Controls sessions (docs/modules/media.md, docs/04 "Media"): one
//! `GlobalSystemMediaTransportControlsSessionManager` whose sessions are mirrored into
//! [`MediaSession`] snapshots and republished as [`PlatformEvent::MediaSessionsChanged`] on
//! every change the OS reports.
//!
//! All `WinRT` work happens on one worker thread. Event handlers fire on thread-pool threads
//! and only post a message; the worker re-reads the affected session, joins the async calls
//! (media properties, thumbnail stream) and publishes. Managers go stale (cppwinrt #1310), so
//! the worker re-requests one on `SessionsChanged`, on [`Media::refresh`] and every
//! [`REFRESH_INTERVAL`], re-registering every handler.
//!
//! Positions are normalised at snapshot time: the app's last reported position advanced by the
//! age of its `LastUpdatedTime` while playing, so consumers interpolate from arrival.

use std::collections::HashMap;
use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use tokio::sync::broadcast;
use tracing::{debug, warn};
use windows::Foundation::{IReference, TypedEventHandler};
use windows::Media::Control::{
    CurrentSessionChangedEventArgs, GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    MediaPropertiesChangedEventArgs, PlaybackInfoChangedEventArgs, SessionsChangedEventArgs,
    TimelinePropertiesChangedEventArgs,
};
use windows::Media::MediaPlaybackAutoRepeatMode;
use windows::core::HSTRING;

use super::os_error;
use super::winrt::{UNIX_EPOCH_TICKS, read_image};
use crate::error::{PlatformError, PlatformResult};
use crate::events::PlatformEvent;
use crate::types::{
    MediaCommand, MediaControls, MediaSession, PlaybackStatus, RepeatMode, Thumbnail,
};

/// Periodic manager re-request (docs/04 "Staleness": every 60 s).
const REFRESH_INTERVAL: Duration = Duration::from_secs(60);
/// Thumbnails larger than this are ignored (a misbehaving app, not artwork).
const MAX_THUMBNAIL_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug)]
enum Msg {
    /// Re-request the manager and re-read every session.
    Rebuild,
    /// One session reported a change; `properties` says the media properties (and possibly
    /// the thumbnail) are among them.
    SessionChanged {
        key: String,
        properties: bool,
    },
    Command {
        key: String,
        command: MediaCommand,
    },
    Stop,
}

#[derive(Debug, Default)]
struct Snapshot {
    sessions: Vec<MediaSession>,
    thumbnails: HashMap<String, Thumbnail>,
}

#[derive(Debug)]
struct Shared {
    snapshot: Mutex<Snapshot>,
    events: broadcast::Sender<PlatformEvent>,
    inbox: mpsc::Sender<Msg>,
}

/// Owns the worker; dropping it stops the thread at its next message.
#[derive(Debug)]
pub(super) struct Watcher {
    shared: Arc<Shared>,
    _worker: JoinHandle<()>,
}

impl Watcher {
    pub(super) fn start(events: broadcast::Sender<PlatformEvent>) -> PlatformResult<Self> {
        let (inbox, outbox) = mpsc::channel();
        let shared = Arc::new(Shared {
            snapshot: Mutex::new(Snapshot::default()),
            events,
            inbox,
        });
        let worker = std::thread::Builder::new()
            .name("muna-platform-media".into())
            .spawn({
                let shared = Arc::clone(&shared);
                move || run_worker(&shared, &outbox)
            })
            .map_err(|_| PlatformError::Unsupported("media worker thread"))?;
        Ok(Self {
            shared,
            _worker: worker,
        })
    }

    pub(super) fn sessions(&self) -> Vec<MediaSession> {
        self.shared.snapshot.lock().sessions.clone()
    }

    pub(super) fn thumbnail(&self, key: &str) -> PlatformResult<Option<Thumbnail>> {
        let snapshot = self.shared.snapshot.lock();
        if !snapshot.sessions.iter().any(|s| s.source_app_id == key) {
            return Err(PlatformError::NotFound(format!("media session {key}")));
        }
        Ok(snapshot.thumbnails.get(key).cloned())
    }

    pub(super) fn send(&self, key: &str, command: MediaCommand) -> PlatformResult<()> {
        if !self
            .shared
            .snapshot
            .lock()
            .sessions
            .iter()
            .any(|s| s.source_app_id == key)
        {
            return Err(PlatformError::NotFound(format!("media session {key}")));
        }
        self.shared
            .inbox
            .send(Msg::Command {
                key: key.to_owned(),
                command,
            })
            .map_err(|_| PlatformError::Unsupported("media worker stopped"))
    }

    pub(super) fn refresh(&self) -> PlatformResult<()> {
        self.shared
            .inbox
            .send(Msg::Rebuild)
            .map_err(|_| PlatformError::Unsupported("media worker stopped"))
    }
}

impl Drop for Watcher {
    fn drop(&mut self) {
        let _ = self.shared.inbox.send(Msg::Stop);
    }
}

/// A session the worker mirrors, with the handler tokens to remove when it goes away.
struct Tracked {
    session: Session,
    tokens: [i64; 3],
    /// Media properties are async and cost an IPC round trip; they are cached until the app
    /// says they changed.
    title: String,
    artist: String,
    album: Option<String>,
    art_hash: Option<u64>,
    art_version: u32,
}

impl Tracked {
    fn unhook(&self) {
        let [properties, playback, timeline] = self.tokens;
        let _ = self.session.RemoveMediaPropertiesChanged(properties);
        let _ = self.session.RemovePlaybackInfoChanged(playback);
        let _ = self.session.RemoveTimelinePropertiesChanged(timeline);
    }
}

struct Worker<'a> {
    shared: &'a Arc<Shared>,
    manager: Option<(Manager, [i64; 2])>,
    tracked: Vec<(String, Tracked)>,
}

fn run_worker(shared: &Arc<Shared>, outbox: &mpsc::Receiver<Msg>) {
    let mut worker = Worker {
        shared,
        manager: None,
        tracked: Vec::new(),
    };
    worker.rebuild();
    loop {
        match outbox.recv_timeout(REFRESH_INTERVAL) {
            Ok(Msg::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Ok(Msg::Rebuild) | Err(mpsc::RecvTimeoutError::Timeout) => worker.rebuild(),
            Ok(Msg::SessionChanged { key, properties }) => worker.session_changed(&key, properties),
            Ok(Msg::Command { key, command }) => worker.command(&key, command),
        }
    }
    worker.unhook_all();
}

impl Worker<'_> {
    fn unhook_all(&mut self) {
        if let Some((manager, [sessions, current])) = self.manager.take() {
            let _ = manager.RemoveSessionsChanged(sessions);
            let _ = manager.RemoveCurrentSessionChanged(current);
        }
        for (_, tracked) in self.tracked.drain(..) {
            tracked.unhook();
        }
    }

    /// Requests a fresh manager, re-registers everything and publishes the resulting list.
    fn rebuild(&mut self) {
        let previous: HashMap<String, Tracked> = {
            self.unhook_all();
            std::mem::take(&mut self.tracked).into_iter().collect()
        };
        match self.request_manager(previous) {
            Ok(()) => self.publish(),
            Err(error) => {
                warn!(%error, "media session manager unavailable");
                self.tracked.clear();
                self.publish();
            }
        }
    }

    fn request_manager(&mut self, mut previous: HashMap<String, Tracked>) -> PlatformResult<()> {
        let manager = Manager::RequestAsync()
            .and_then(|op| op.join())
            .map_err(|e| {
                os_error(
                    "GlobalSystemMediaTransportControlsSessionManager.RequestAsync",
                    &e,
                )
            })?;
        let on_sessions = {
            let inbox = self.shared.inbox.clone();
            TypedEventHandler::<Manager, SessionsChangedEventArgs>::new(move |_, _| {
                let _ = inbox.send(Msg::Rebuild);
                Ok(())
            })
        };
        let on_current = {
            let inbox = self.shared.inbox.clone();
            TypedEventHandler::<Manager, CurrentSessionChangedEventArgs>::new(move |_, _| {
                let _ = inbox.send(Msg::Rebuild);
                Ok(())
            })
        };
        let sessions_token = manager
            .SessionsChanged(&on_sessions)
            .map_err(|e| os_error("SessionManager.SessionsChanged", &e))?;
        let current_token = manager
            .CurrentSessionChanged(&on_current)
            .map_err(|e| os_error("SessionManager.CurrentSessionChanged", &e))?;
        self.manager = Some((manager.clone(), [sessions_token, current_token]));

        let list = manager
            .GetSessions()
            .map_err(|e| os_error("SessionManager.GetSessions", &e))?;
        let count = list.Size().map_err(|e| os_error("IVectorView.Size", &e))?;
        for index in 0..count {
            let Ok(session) = list.GetAt(index) else {
                continue;
            };
            let Ok(app) = session.SourceAppUserModelId() else {
                continue;
            };
            let key = unique_key(&app.to_string_lossy(), &self.tracked);
            match self.track(&key, session, previous.remove(&key)) {
                Ok(tracked) => self.tracked.push((key, tracked)),
                Err(error) => debug!(%error, "media session could not be read"),
            }
        }
        // Sessions that vanished keep no handlers behind.
        for (_, stale) in previous {
            stale.unhook();
        }
        Ok(())
    }

    /// Hooks one session's change events and reads its properties (reusing the cached ones
    /// when the same app was tracked before the rebuild).
    fn track(
        &self,
        key: &str,
        session: Session,
        previous: Option<Tracked>,
    ) -> windows::core::Result<Tracked> {
        let hook = |properties: bool| {
            let inbox = self.shared.inbox.clone();
            let key = key.to_owned();
            move || {
                let _ = inbox.send(Msg::SessionChanged {
                    key: key.clone(),
                    properties,
                });
            }
        };
        let on_properties = {
            let notify = hook(true);
            TypedEventHandler::<Session, MediaPropertiesChangedEventArgs>::new(move |_, _| {
                notify();
                Ok(())
            })
        };
        let on_playback = {
            let notify = hook(false);
            TypedEventHandler::<Session, PlaybackInfoChangedEventArgs>::new(move |_, _| {
                notify();
                Ok(())
            })
        };
        let on_timeline = {
            let notify = hook(false);
            TypedEventHandler::<Session, TimelinePropertiesChangedEventArgs>::new(move |_, _| {
                notify();
                Ok(())
            })
        };
        let tokens = [
            session.MediaPropertiesChanged(&on_properties)?,
            session.PlaybackInfoChanged(&on_playback)?,
            session.TimelinePropertiesChanged(&on_timeline)?,
        ];
        let mut tracked = match previous {
            Some(previous) => Tracked {
                session,
                tokens,
                title: previous.title,
                artist: previous.artist,
                album: previous.album,
                art_hash: previous.art_hash,
                art_version: previous.art_version,
            },
            None => Tracked {
                session,
                tokens,
                title: String::new(),
                artist: String::new(),
                album: None,
                art_hash: None,
                art_version: 0,
            },
        };
        // A fresh manager may carry new properties for a known app; always re-read them once.
        self.read_properties(key, &mut tracked);
        Ok(tracked)
    }

    fn session_changed(&mut self, key: &str, properties: bool) {
        if properties {
            let Some(index) = self.tracked.iter().position(|(k, _)| k == key) else {
                return;
            };
            let (key, mut tracked) = self.tracked.remove(index);
            self.read_properties(&key, &mut tracked);
            self.tracked.insert(index, (key, tracked));
        }
        self.publish();
    }

    /// Joins `TryGetMediaPropertiesAsync` and, when the thumbnail bytes differ from the last
    /// read, stores them and bumps the version.
    fn read_properties(&self, key: &str, tracked: &mut Tracked) {
        let properties = match tracked
            .session
            .TryGetMediaPropertiesAsync()
            .and_then(|op| op.join())
        {
            Ok(properties) => properties,
            Err(error) => {
                debug!(%error, "TryGetMediaPropertiesAsync failed");
                return;
            }
        };
        tracked.title = properties.Title().map(|s| hstring(&s)).unwrap_or_default();
        tracked.artist = properties.Artist().map(|s| hstring(&s)).unwrap_or_default();
        tracked.album = properties
            .AlbumTitle()
            .map(|s| hstring(&s))
            .ok()
            .filter(|album| !album.is_empty());

        let thumbnail =
            properties
                .Thumbnail()
                .ok()
                .and_then(|reference| match read_thumbnail(&reference) {
                    Ok(thumbnail) => thumbnail,
                    Err(error) => {
                        debug!(%error, "thumbnail stream could not be read");
                        None
                    }
                });
        let mut snapshot = self.shared.snapshot.lock();
        if let Some(thumbnail) = thumbnail {
            let hash = fnv1a(&thumbnail.bytes);
            if tracked.art_hash != Some(hash) {
                tracked.art_hash = Some(hash);
                tracked.art_version = tracked.art_version.wrapping_add(1).max(1);
                snapshot.thumbnails.insert(key.to_owned(), thumbnail);
            }
        } else {
            if tracked.art_hash.take().is_some() {
                snapshot.thumbnails.remove(key);
            }
            tracked.art_version = 0;
        }
    }

    fn command(&self, key: &str, command: MediaCommand) {
        let Some((_, tracked)) = self.tracked.iter().find(|(k, _)| k == key) else {
            debug!(?command, "media command for a session that is gone");
            return;
        };
        let session = &tracked.session;
        let result = match command {
            MediaCommand::Play => session.TryPlayAsync().and_then(|op| op.join()),
            MediaCommand::Pause => session.TryPauseAsync().and_then(|op| op.join()),
            MediaCommand::TogglePlayPause => {
                session.TryTogglePlayPauseAsync().and_then(|op| op.join())
            }
            MediaCommand::Next => session.TrySkipNextAsync().and_then(|op| op.join()),
            MediaCommand::Previous => session.TrySkipPreviousAsync().and_then(|op| op.join()),
            MediaCommand::SetShuffle { enabled } => session
                .TryChangeShuffleActiveAsync(enabled)
                .and_then(|op| op.join()),
            MediaCommand::SetRepeat { mode } => session
                .TryChangeAutoRepeatModeAsync(match mode {
                    RepeatMode::None => MediaPlaybackAutoRepeatMode::None,
                    RepeatMode::Track => MediaPlaybackAutoRepeatMode::Track,
                    RepeatMode::List => MediaPlaybackAutoRepeatMode::List,
                })
                .and_then(|op| op.join()),
            MediaCommand::Seek { position_ms } => session
                .TryChangePlaybackPositionAsync(i64::from(position_ms) * 10_000)
                .and_then(|op| op.join()),
        };
        match result {
            Ok(true) => {}
            Ok(false) => debug!(?command, "media command refused by the app"),
            Err(error) => debug!(?command, %error, "media command failed"),
        }
    }

    /// Re-reads the cheap, synchronous parts of every session and publishes when the list
    /// differs from the last one.
    fn publish(&self) {
        let current = self
            .manager
            .as_ref()
            .and_then(|(manager, _)| manager.GetCurrentSession().ok())
            .and_then(|session| session.SourceAppUserModelId().ok())
            .map(|app| app.to_string_lossy());
        let now_ticks = now_universal_ticks();
        let mut sessions = Vec::with_capacity(self.tracked.len());
        // The OS's current session is matched by app id: the first tracked session of that
        // app takes the flag when a browser opened several.
        let mut current_taken = false;
        for (key, tracked) in &self.tracked {
            let mut session = snapshot_of(key, tracked, now_ticks);
            if !current_taken
                && current
                    .as_deref()
                    .is_some_and(|app| key == app || key.starts_with(&format!("{app}#")))
            {
                session.is_current = true;
                current_taken = true;
            }
            sessions.push(session);
        }
        let changed = {
            let mut snapshot = self.shared.snapshot.lock();
            let live: Vec<&String> = self.tracked.iter().map(|(key, _)| key).collect();
            snapshot.thumbnails.retain(|key, _| live.contains(&key));
            if snapshot.sessions == sessions {
                false
            } else {
                snapshot.sessions.clone_from(&sessions);
                true
            }
        };
        if changed {
            let _ = self
                .shared
                .events
                .send(PlatformEvent::MediaSessionsChanged(sessions));
        }
    }
}

/// `Spotify.exe`, then `Spotify.exe#2` when the same app has a second session.
fn unique_key(app: &str, tracked: &[(String, Tracked)]) -> String {
    let mut key = app.to_owned();
    let mut n = 1;
    while tracked.iter().any(|(k, _)| *k == key) {
        n += 1;
        key = format!("{app}#{n}");
    }
    key
}

fn hstring(value: &HSTRING) -> String {
    value.to_string_lossy()
}

fn snapshot_of(key: &str, tracked: &Tracked, now_ticks: i64) -> MediaSession {
    let mut session = MediaSession::new(key, &tracked.title);
    session.artist.clone_from(&tracked.artist);
    session.album.clone_from(&tracked.album);
    session.art_version = tracked.art_version;

    if let Ok(playback) = tracked.session.GetPlaybackInfo() {
        session.status = playback
            .PlaybackStatus()
            .map_or(PlaybackStatus::Stopped, status_of);
        if let Ok(controls) = playback.Controls() {
            session.controls = MediaControls {
                play: controls.IsPlayEnabled().unwrap_or(false),
                pause: controls.IsPauseEnabled().unwrap_or(false),
                next: controls.IsNextEnabled().unwrap_or(false),
                previous: controls.IsPreviousEnabled().unwrap_or(false),
                seek: controls.IsPlaybackPositionEnabled().unwrap_or(false),
                shuffle: controls.IsShuffleEnabled().unwrap_or(false),
                repeat: controls.IsRepeatEnabled().unwrap_or(false),
            };
        }
        session.shuffle = playback
            .IsShuffleActive()
            .ok()
            .and_then(|value: IReference<bool>| value.Value().ok());
        session.repeat = playback
            .AutoRepeatMode()
            .ok()
            .and_then(|value: IReference<MediaPlaybackAutoRepeatMode>| value.Value().ok())
            .map(|mode| match mode {
                MediaPlaybackAutoRepeatMode::Track => RepeatMode::Track,
                MediaPlaybackAutoRepeatMode::List => RepeatMode::List,
                _ => RepeatMode::None,
            });
    }

    if let Ok(timeline) = tracked.session.GetTimelineProperties() {
        let start = timeline.StartTime().map_or(0, |t| t.Duration);
        let end = timeline.EndTime().map_or(0, |t| t.Duration);
        let position = timeline.Position().map_or(0, |t| t.Duration);
        let updated = timeline.LastUpdatedTime().map_or(0, |t| t.UniversalTime);
        let duration = end.saturating_sub(start);
        if duration > 0 {
            session.duration_ms = Some(ticks_to_ms(duration));
            let mut relative = position.saturating_sub(start);
            if session.status == PlaybackStatus::Playing && updated > 0 {
                relative = relative.saturating_add(now_ticks.saturating_sub(updated).max(0));
            }
            session.position_ms = Some(ticks_to_ms(relative.min(duration)));
        }
    }
    session
}

fn status_of(status: Status) -> PlaybackStatus {
    match status {
        Status::Playing | Status::Changing => PlaybackStatus::Playing,
        Status::Paused => PlaybackStatus::Paused,
        _ => PlaybackStatus::Stopped,
    }
}

/// 100 ns ticks → whole milliseconds, saturating at the `u32` range (≈ 49 days).
fn ticks_to_ms(ticks: i64) -> u32 {
    u32::try_from(ticks.max(0) / 10_000).unwrap_or(u32::MAX)
}

/// The current time on the `DateTime.UniversalTime` scale (100 ns ticks since 1601).
fn now_universal_ticks() -> i64 {
    let since_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let ticks = i64::try_from(since_epoch.as_nanos() / 100).unwrap_or(i64::MAX);
    ticks.saturating_add(UNIX_EPOCH_TICKS)
}

/// Reads the whole thumbnail stream. `Ok(None)` for empty or oversized streams.
fn read_thumbnail(
    reference: &windows::Storage::Streams::IRandomAccessStreamReference,
) -> windows::core::Result<Option<Thumbnail>> {
    read_image(reference, MAX_THUMBNAIL_BYTES)
}

/// Stable 64-bit FNV-1a, enough to notice that artwork bytes changed.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticks_convert_to_milliseconds_and_saturate() {
        assert_eq!(ticks_to_ms(0), 0);
        assert_eq!(ticks_to_ms(10_000), 1);
        assert_eq!(ticks_to_ms(-5), 0);
        assert_eq!(ticks_to_ms(i64::MAX), u32::MAX);
    }

    #[test]
    fn the_universal_clock_is_after_2020() {
        // 2020-01-01 on the 1601 scale.
        assert!(now_universal_ticks() > 132_223_104_000_000_000);
    }

    #[test]
    fn duplicate_apps_get_numbered_keys() {
        // No `Tracked` can be built without a live session; an empty list is the base case.
        assert_eq!(unique_key("Spotify.exe", &[]), "Spotify.exe");
    }

    #[test]
    fn fnv_distinguishes_inputs() {
        assert_ne!(fnv1a(b"a"), fnv1a(b"b"));
        assert_eq!(fnv1a(b"art"), fnv1a(b"art"));
    }

    #[test]
    fn status_mapping_treats_changing_as_playing() {
        assert_eq!(status_of(Status::Changing), PlaybackStatus::Playing);
        assert_eq!(status_of(Status::Closed), PlaybackStatus::Stopped);
        assert_eq!(status_of(Status::Paused), PlaybackStatus::Paused);
    }
}
