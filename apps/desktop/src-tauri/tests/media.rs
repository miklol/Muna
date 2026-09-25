//! The `media` module against `FakePlatform` (docs/modules/media.md, docs/build-plan/
//! m2-media-hud.md E1 exit criteria). Integration tests because the `muna` lib cannot host
//! unit tests (Common Controls manifest on Tauri-linked tests).

use std::sync::Arc;

use muna_core::{
    Glyph, Hub, Leading, StripContent, StripMessage, SystemClock, Trailing, activities::priority,
};
use muna_lib::modules::media::{ACTIVITY_ID, MediaService, MediaSink, MediaState};
use muna_platform::{
    FakePlatform, MediaCommand, MediaSession, Platform, PlatformError, PlaybackStatus, RepeatMode,
};
use parking_lot::Mutex;

/// 1×1 opaque PNG (`#3060c0`), the smallest real artwork (bytes verified with zlib).
const PNG_BLUE: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x78, 0xDA, 0x63, 0x30, 0x48, 0x38, 0x00,
    0x00, 0x02, 0x14, 0x01, 0x51, 0x44, 0x4E, 0x7F, 0xF2, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82,
];

#[derive(Default)]
struct Recorder {
    states: Mutex<Vec<MediaState>>,
    art: Mutex<Vec<Option<String>>>,
}

impl MediaSink for Recorder {
    fn state_changed(&self, state: &MediaState) {
        self.states.lock().push(state.clone());
    }

    fn art_changed(&self, art: Option<&muna_core::Artwork>) {
        self.art.lock().push(art.map(|a| a.key.clone()));
    }
}

struct Rig {
    platform: Arc<FakePlatform>,
    hub: Arc<Hub>,
    service: Arc<MediaService>,
    recorder: Arc<Recorder>,
}

fn rig() -> Rig {
    let platform = Arc::new(FakePlatform::new());
    let hub = Arc::new(Hub::new(Arc::new(SystemClock)));
    let service = Arc::new(MediaService::new(
        Arc::clone(&platform) as Arc<dyn muna_platform::Platform>,
        Arc::clone(&hub),
        None,
    ));
    let recorder = Arc::new(Recorder::default());
    service.set_sink(Arc::clone(&recorder) as Arc<dyn MediaSink>);
    Rig {
        platform,
        hub,
        service,
        recorder,
    }
}

fn session(app: &str, title: &str, status: PlaybackStatus) -> MediaSession {
    MediaSession {
        artist: "Artist".into(),
        status,
        ..MediaSession::new(app, title)
    }
}

fn playing(app: &str, title: &str) -> MediaSession {
    session(app, title, PlaybackStatus::Playing)
}

fn paused(app: &str, title: &str) -> MediaSession {
    session(app, title, PlaybackStatus::Paused)
}

/// Feeds a snapshot the way the backend does: observe, then fetch any artwork inline.
fn feed(rig: &Rig, sessions: Vec<MediaSession>) {
    let observation = rig.service.observe(sessions);
    if let Some(request) = observation.fetch_art {
        rig.service.load_art(&request);
    }
}

fn shown_activity(hub: &Hub) -> Option<muna_core::Activity> {
    match hub.current() {
        StripContent::Activity { activity, .. } => Some(activity),
        _ => None,
    }
}

// --- strip activity -----------------------------------------------------------------------

#[test]
fn nothing_playing_publishes_nothing() {
    let rig = rig();
    feed(&rig, Vec::new());
    assert_eq!(rig.hub.current(), StripContent::Idle);
    assert!(rig.service.snapshot().state.active.is_none());
    assert!(
        rig.recorder.states.lock().is_empty(),
        "no event for an unchanged empty state"
    );
}

#[test]
fn a_playing_session_becomes_the_now_playing_activity() {
    let rig = rig();
    feed(&rig, vec![playing("Spotify.exe", "Song")]);

    let activity = shown_activity(&rig.hub).expect("activity shown");
    assert_eq!(activity.id, ACTIVITY_ID);
    assert_eq!(activity.module, "media");
    assert_eq!(activity.priority, priority::MEDIA_PLAYING);
    assert_eq!(
        activity.leading,
        Some(Leading::Icon {
            glyph: Glyph::Music,
            tint: None
        }),
        "no art yet: the music glyph stands in"
    );
    assert_eq!(
        activity.trailing,
        Some(Trailing::Waveform { playing: true })
    );
    assert_eq!(
        activity.wide,
        Some(StripMessage::NowPlaying {
            title: "Song".into(),
            artist: "Artist".into()
        })
    );
    let states = rig.recorder.states.lock();
    assert_eq!(states.len(), 1);
    assert_eq!(
        states[0].active.as_ref().map(|s| s.title.as_str()),
        Some("Song")
    );
}

#[test]
fn pausing_lowers_the_priority_and_shows_the_play_glyph() {
    let rig = rig();
    feed(&rig, vec![playing("Spotify.exe", "Song")]);
    feed(&rig, vec![paused("Spotify.exe", "Song")]);

    let activity = shown_activity(&rig.hub).expect("activity shown");
    assert_eq!(activity.priority, priority::MEDIA_PAUSED);
    assert_eq!(
        activity.trailing,
        Some(Trailing::Icon {
            glyph: Glyph::Play,
            tint: None
        })
    );
}

#[test]
fn a_stopped_or_vanished_session_retracts_the_activity() {
    let rig = rig();
    feed(&rig, vec![playing("Spotify.exe", "Song")]);
    feed(
        &rig,
        vec![session("Spotify.exe", "Song", PlaybackStatus::Stopped)],
    );
    assert_eq!(
        rig.hub.current(),
        StripContent::Idle,
        "stopped sessions leave the strip"
    );
    assert!(
        rig.service.snapshot().state.active.is_some(),
        "but the app still shows in the picker"
    );

    feed(&rig, Vec::new());
    assert_eq!(rig.hub.current(), StripContent::Idle);
    assert!(rig.service.snapshot().state.active.is_none());
}

#[test]
fn position_ticks_do_not_republish() {
    let rig = rig();
    feed(&rig, vec![playing("Spotify.exe", "Song")]);
    let before = rig.recorder.states.lock().len();
    let mut ticked = playing("Spotify.exe", "Song");
    ticked.position_ms = Some(5000);
    feed(&rig, vec![ticked]);
    // The state carries the position, so one state event; the activity is unchanged.
    assert_eq!(rig.recorder.states.lock().len(), before + 1);
    let shown = rig.hub.activities();
    assert_eq!(shown.len(), 1);
}

// --- scoring -------------------------------------------------------------------------------

#[test]
fn playing_beats_paused_regardless_of_order() {
    let rig = rig();
    feed(
        &rig,
        vec![paused("Spotify.exe", "Old"), playing("msedge.exe", "New")],
    );
    let active = rig.service.snapshot().state.active.unwrap();
    assert_eq!(active.source_app_id, "msedge.exe");
}

#[test]
fn among_playing_sessions_the_os_current_one_wins_then_the_most_recently_changed() {
    let rig = rig();
    let mut current = playing("Spotify.exe", "A");
    current.is_current = true;
    feed(&rig, vec![playing("msedge.exe", "B"), current.clone()]);
    assert_eq!(
        rig.service.snapshot().state.active.unwrap().source_app_id,
        "Spotify.exe"
    );

    // Neither current: the one whose content changed last wins.
    current.is_current = false;
    feed(&rig, vec![playing("msedge.exe", "B"), current.clone()]);
    feed(&rig, vec![playing("msedge.exe", "C"), current]);
    assert_eq!(
        rig.service.snapshot().state.active.unwrap().source_app_id,
        "msedge.exe",
        "the track change in Edge is the latest content change"
    );
}

#[test]
fn thirty_switches_between_two_apps_never_pick_the_wrong_one() {
    let rig = rig();
    let apps = ["Spotify.exe", "msedge.exe"];
    let mut wrong = 0;
    for i in 0..30 {
        let expected = apps[i % 2];
        let other = apps[(i + 1) % 2];
        feed(
            &rig,
            vec![
                paused(other, &format!("Track {i} on {other}")),
                playing(expected, &format!("Track {i} on {expected}")),
            ],
        );
        if rig.service.snapshot().state.active.unwrap().source_app_id != expected {
            wrong += 1;
        }
    }
    assert_eq!(wrong, 0);
}

#[test]
fn a_pinned_app_wins_while_it_has_a_session() {
    let rig = rig();
    feed(
        &rig,
        vec![playing("Spotify.exe", "A"), paused("msedge.exe", "B")],
    );
    rig.service.set_pinned(Some("msedge.exe".into()));
    let state = rig.service.snapshot().state;
    assert_eq!(state.pinned.as_deref(), Some("msedge.exe"));
    assert_eq!(state.active.unwrap().source_app_id, "msedge.exe");
    assert_eq!(
        shown_activity(&rig.hub).unwrap().priority,
        priority::MEDIA_PAUSED
    );

    // The pinned app disappears: fall back to the scoring, keep the pin.
    feed(&rig, vec![playing("Spotify.exe", "A")]);
    let state = rig.service.snapshot().state;
    assert_eq!(state.pinned.as_deref(), Some("msedge.exe"));
    assert_eq!(state.active.unwrap().source_app_id, "Spotify.exe");

    rig.service.set_pinned(None);
    assert!(rig.service.snapshot().state.pinned.is_none());
}

// --- artwork -------------------------------------------------------------------------------

#[test]
fn artwork_is_fetched_prepared_and_applied_when_a_version_arrives() {
    let rig = rig();
    rig.platform
        .set_media_sessions(vec![playing("Spotify.exe", "Song")]);
    feed(&rig, rig.platform.media().sessions().unwrap());
    assert!(
        rig.service.snapshot().art.is_none(),
        "art_version 0: no fetch"
    );

    rig.platform
        .set_media_thumbnail("Spotify.exe", PNG_BLUE.to_vec(), "image/png");
    let with_art = rig.platform.media().sessions().unwrap();
    assert_eq!(with_art[0].art_version, 1);
    feed(&rig, with_art);

    let snapshot = rig.service.snapshot();
    let art = snapshot.art.expect("artwork applied");
    assert!(art.src.starts_with("data:image/png;base64,"));
    assert_eq!(art.palette.len(), 3);
    assert_eq!(snapshot.state.art_key.as_deref(), Some(art.key.as_str()));
    assert_eq!(
        shown_activity(&rig.hub).unwrap().leading,
        Some(Leading::Image { src: art.src })
    );
    assert_eq!(rig.recorder.art.lock().last(), Some(&Some(art.key)));
}

#[test]
fn artwork_is_kept_across_a_track_change_until_the_new_picture_lands() {
    let rig = rig();
    rig.platform
        .set_media_sessions(vec![playing("Spotify.exe", "One")]);
    rig.platform
        .set_media_thumbnail("Spotify.exe", PNG_BLUE.to_vec(), "image/png");
    feed(&rig, rig.platform.media().sessions().unwrap());
    let first_key = rig.service.snapshot().art.unwrap().key;

    // Track change, same app, thumbnail not yet re-delivered (version unchanged).
    let mut next = playing("Spotify.exe", "Two");
    next.art_version = 1;
    feed(&rig, vec![next.clone()]);
    assert_eq!(
        rig.service.snapshot().art.map(|a| a.key),
        Some(first_key.clone()),
        "no flash: the previous picture stays"
    );
    assert!(
        rig.recorder.art.lock().iter().all(Option::is_some),
        "art was never cleared"
    );

    // The late thumbnail arrives as a new version.
    rig.platform.set_media_sessions(vec![next]);
    rig.platform
        .set_media_thumbnail("Spotify.exe", PNG_BLUE.to_vec(), "image/png");
    let sessions = rig.platform.media().sessions().unwrap();
    assert_eq!(sessions[0].art_version, 2);
    feed(&rig, sessions);
    let key = rig.service.snapshot().art.unwrap().key;
    assert_ne!(key, first_key, "keyed by track, so a new entry");
}

#[test]
fn switching_apps_clears_the_art_and_a_missing_thumbnail_is_harmless() {
    let rig = rig();
    rig.platform
        .set_media_sessions(vec![playing("Spotify.exe", "One")]);
    rig.platform
        .set_media_thumbnail("Spotify.exe", PNG_BLUE.to_vec(), "image/png");
    feed(&rig, rig.platform.media().sessions().unwrap());
    assert!(rig.service.snapshot().art.is_some());

    let mut edge = playing("msedge.exe", "Video");
    edge.art_version = 3; // claims art, but the fake has none for it
    feed(&rig, vec![edge]);
    let snapshot = rig.service.snapshot();
    assert!(snapshot.art.is_none());
    assert!(snapshot.state.art_key.is_none());
    assert_eq!(rig.recorder.art.lock().last(), Some(&None));
    assert_eq!(
        shown_activity(&rig.hub).unwrap().leading,
        Some(Leading::Icon {
            glyph: Glyph::Music,
            tint: None
        })
    );
}

#[test]
fn stale_artwork_for_a_session_that_moved_on_is_ignored() {
    let rig = rig();
    rig.platform
        .set_media_sessions(vec![playing("Spotify.exe", "One")]);
    rig.platform
        .set_media_thumbnail("Spotify.exe", PNG_BLUE.to_vec(), "image/png");
    let observation = rig
        .service
        .observe(rig.platform.media().sessions().unwrap());
    let request = observation.fetch_art.expect("fetch requested");

    // Before the fetch completes the user switches to another app.
    rig.service.observe(vec![playing("msedge.exe", "Video")]);
    rig.service.load_art(&request);
    assert!(
        rig.service.snapshot().art.is_none(),
        "late art for Spotify must not decorate Edge"
    );
}

// --- commands and the watchdog ------------------------------------------------------------

#[test]
fn commands_go_to_the_active_session_by_default() {
    let rig = rig();
    rig.platform
        .set_media_sessions(vec![playing("Spotify.exe", "Song")]);
    feed(&rig, rig.platform.media().sessions().unwrap());

    rig.service.send(None, MediaCommand::Pause).unwrap();
    rig.service
        .send(
            None,
            MediaCommand::SetRepeat {
                mode: RepeatMode::Track,
            },
        )
        .unwrap();
    let sent = rig.platform.sent_media_commands();
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0].0, "Spotify.exe");
    assert_eq!(sent[0].1, MediaCommand::Pause);
    assert_eq!(
        sent[1].1,
        MediaCommand::SetRepeat {
            mode: RepeatMode::Track
        }
    );

    assert!(matches!(
        rig.service.send(Some("nope.exe"), MediaCommand::Play),
        Err(PlatformError::NotFound(_))
    ));
}

#[test]
fn without_a_session_a_command_is_not_found() {
    let rig = rig();
    assert!(matches!(
        rig.service.send(None, MediaCommand::Play),
        Err(PlatformError::NotFound(_))
    ));
}

#[test]
fn the_watchdog_refreshes_only_when_no_snapshot_followed_the_command() {
    let rig = rig();
    rig.platform
        .set_media_sessions(vec![playing("Spotify.exe", "Song")]);
    feed(&rig, rig.platform.media().sessions().unwrap());

    // Acknowledged: a snapshot arrives before the timeout.
    let tick = rig.service.send(None, MediaCommand::Pause).unwrap();
    feed(&rig, vec![paused("Spotify.exe", "Song")]);
    assert!(!rig.service.watchdog(tick));
    assert_eq!(rig.platform.media_refreshes(), 0);

    // Silent: the app never answered.
    let tick = rig.service.send(None, MediaCommand::Play).unwrap();
    assert!(rig.service.watchdog(tick));
    assert_eq!(rig.platform.media_refreshes(), 1);
}

#[test]
fn sync_reads_the_platform_and_a_refresh_is_forwarded() {
    let rig = rig();
    rig.platform
        .set_media_sessions(vec![playing("Spotify.exe", "Song")]);
    rig.service.sync();
    assert_eq!(rig.service.snapshot().state.active.unwrap().title, "Song");
    rig.service.refresh().unwrap();
    assert_eq!(rig.platform.media_refreshes(), 1);
}
