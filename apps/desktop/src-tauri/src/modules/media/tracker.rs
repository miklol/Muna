//! Reduces platform snapshots to the media module's state: the active session, its artwork
//! and the strip activity (docs/modules/media.md "States"). Pure — no Tauri, no OS — so the
//! integration tests in `tests/media.rs` drive it with the fake platform.

use std::collections::HashMap;

use muna_core::activities::priority;
use muna_core::{Activity, Artwork, Glyph, Leading, StripMessage, Trailing, artwork};
use muna_platform::{MediaSession, PlaybackStatus};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::scoring::pick_active;
use super::settings::{MediaSettings, Visualiser};

/// The one strip activity this module owns.
pub const ACTIVITY_ID: &str = "media:now-playing";
pub const MODULE: &str = "media";

/// What the UI needs besides pixels; `MediaStateChanged` carries it on every change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    /// The session the module shows, after scoring and pinning.
    pub active: Option<MediaSession>,
    /// Every session the OS reports, for the app picker.
    pub sessions: Vec<MediaSession>,
    /// `source_app_id` the user pinned; `None` follows the scoring.
    pub pinned: Option<String>,
    /// Key of the artwork that applies to `active` (`MediaArtChanged` carries the pixels).
    pub art_key: Option<String>,
}

/// Artwork the module should fetch from the platform and prepare.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtRequest {
    pub source_app_id: String,
    pub art_version: u32,
    /// [`artwork::art_key`] of the track, for the cache.
    pub key: String,
}

/// What one snapshot changed.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Observation {
    /// [`MediaTracker::state`] differs from before.
    pub state_changed: bool,
    /// The strip activity differs from before (publish or retract it).
    pub activity_changed: bool,
    /// The displayed artwork no longer applies.
    pub art_cleared: bool,
    pub fetch_art: Option<ArtRequest>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ArtSlot {
    source_app_id: String,
    art_version: u32,
    artwork: Artwork,
}

#[derive(Debug, Default)]
pub struct MediaTracker {
    sessions: Vec<MediaSession>,
    /// Monotonic count of snapshots seen; `changed_at` values are ticks.
    tick: u64,
    /// Tick of the last *content* change (title, artist, album, status) per session.
    changed_at: HashMap<String, u64>,
    pinned: Option<String>,
    active: Option<String>,
    art: Option<ArtSlot>,
    /// `(source_app_id, art_version)` requested and not yet delivered.
    pending_art: Option<(String, u32)>,
    /// Strip presentation switches from `settings.modules.media`.
    adaptive_colours: bool,
    visualiser: Visualiser,
}

impl MediaTracker {
    #[must_use]
    pub fn new() -> Self {
        Self {
            adaptive_colours: true,
            ..Self::default()
        }
    }

    /// Number of snapshots observed so far; the command watchdog compares it before and after.
    #[must_use]
    pub fn tick(&self) -> u64 {
        self.tick
    }

    #[must_use]
    pub fn active(&self) -> Option<&MediaSession> {
        let key = self.active.as_deref()?;
        self.sessions.iter().find(|s| s.source_app_id == key)
    }

    #[must_use]
    pub fn artwork(&self) -> Option<&Artwork> {
        self.art.as_ref().map(|slot| &slot.artwork)
    }

    #[must_use]
    pub fn state(&self) -> MediaState {
        MediaState {
            active: self.active().cloned(),
            sessions: self.sessions.clone(),
            pinned: self.pinned.clone(),
            art_key: self.art.as_ref().map(|slot| slot.artwork.key.clone()),
        }
    }

    /// Absorbs a platform snapshot.
    pub fn observe(&mut self, sessions: Vec<MediaSession>) -> Observation {
        let before = self.state();
        let before_activity = self.activity();
        self.tick += 1;
        for session in &sessions {
            let previous = self
                .sessions
                .iter()
                .find(|s| s.source_app_id == session.source_app_id);
            if previous.is_none_or(|p| content_differs(p, session)) {
                self.changed_at
                    .insert(session.source_app_id.clone(), self.tick);
            }
        }
        self.changed_at
            .retain(|key, _| sessions.iter().any(|s| s.source_app_id == *key));
        self.sessions = sessions;
        self.reevaluate(&before, before_activity.as_ref())
    }

    /// Pins one app (or follows the scoring again with `None`).
    pub fn set_pinned(&mut self, pinned: Option<String>) -> Observation {
        let before = self.state();
        let before_activity = self.activity();
        self.pinned = pinned;
        self.reevaluate(&before, before_activity.as_ref())
    }

    #[must_use]
    pub fn pinned(&self) -> Option<&str> {
        self.pinned.as_deref()
    }

    /// Applies the module's settings: the preferred app becomes the pin and the strip
    /// presentation switches take effect on the next activity.
    pub fn set_settings(&mut self, settings: &MediaSettings) -> Observation {
        let before = self.state();
        let before_activity = self.activity();
        self.pinned.clone_from(&settings.preferred_app);
        self.adaptive_colours = settings.adaptive_colours;
        self.visualiser = settings.visualiser;
        self.reevaluate(&before, before_activity.as_ref())
    }

    /// Delivers prepared artwork; ignored when it no longer matches the active session.
    /// Returns whether the display changed.
    pub fn set_art(&mut self, source_app_id: &str, art_version: u32, artwork: Artwork) -> bool {
        if self.pending_art.as_ref() == Some(&(source_app_id.to_owned(), art_version)) {
            self.pending_art = None;
        }
        let applies = self
            .active()
            .is_some_and(|s| s.source_app_id == source_app_id && s.art_version == art_version);
        if !applies {
            return false;
        }
        let slot = ArtSlot {
            source_app_id: source_app_id.to_owned(),
            art_version,
            artwork,
        };
        if self.art.as_ref() == Some(&slot) {
            return false;
        }
        self.art = Some(slot);
        true
    }

    /// The fetch for `request` failed; forget it so the next version is requested again.
    pub fn art_failed(&mut self, request: &ArtRequest) {
        if self.pending_art.as_ref() == Some(&(request.source_app_id.clone(), request.art_version))
        {
            self.pending_art = None;
        }
    }

    fn reevaluate(
        &mut self,
        before: &MediaState,
        before_activity: Option<&Activity>,
    ) -> Observation {
        self.active = pick_active(&self.sessions, self.pinned.as_deref(), &self.changed_at)
            .map(|s| s.source_app_id.clone());

        let mut observation = Observation::default();
        match self.active().cloned() {
            None => {
                observation.art_cleared = self.art.take().is_some();
                self.pending_art = None;
            }
            Some(active) => {
                if self
                    .art
                    .as_ref()
                    .is_some_and(|slot| slot.source_app_id != active.source_app_id)
                {
                    self.art = None;
                    observation.art_cleared = true;
                }
                // Art version 0 for the app that just changed track: keep the previous picture
                // until the late thumbnail lands (docs/modules/media.md, "no flash").
                let wanted = (active.source_app_id.clone(), active.art_version);
                let have = self
                    .art
                    .as_ref()
                    .is_some_and(|slot| slot.art_version == active.art_version);
                if active.art_version > 0 && !have && self.pending_art.as_ref() != Some(&wanted) {
                    self.pending_art = Some(wanted);
                    observation.fetch_art = Some(ArtRequest {
                        source_app_id: active.source_app_id.clone(),
                        art_version: active.art_version,
                        key: artwork::art_key(
                            &active.title,
                            &active.artist,
                            active.album.as_deref(),
                        ),
                    });
                }
            }
        }
        observation.state_changed = self.state() != *before;
        observation.activity_changed = self.activity().as_ref() != before_activity;
        observation
    }

    /// The strip activity for the active session; `None` retracts it (nothing playing or a
    /// stopped session: docs/modules/media.md "No session → hidden from strip").
    #[must_use]
    pub fn activity(&self) -> Option<Activity> {
        let session = self.active()?;
        let priority = match session.status {
            PlaybackStatus::Playing => priority::MEDIA_PLAYING,
            PlaybackStatus::Paused => priority::MEDIA_PAUSED,
            PlaybackStatus::Stopped => return None,
        };
        let leading = match self.artwork() {
            Some(art) => Leading::Image {
                src: art.src.clone(),
                // The dominant swatch tints the halo (docs/05-design-system.md: the palette
                // tints surfaces, never text); off with adaptive colours.
                glow: self
                    .adaptive_colours
                    .then(|| art.palette.first().cloned())
                    .flatten(),
            },
            None => Leading::Icon {
                glyph: Glyph::Music,
                tint: None,
            },
        };
        let trailing = if session.status == PlaybackStatus::Playing {
            match self.visualiser {
                Visualiser::Bars => Some(Trailing::Waveform { playing: true }),
                Visualiser::Off => None,
            }
        } else {
            Some(Trailing::Icon {
                glyph: Glyph::Play,
                tint: None,
            })
        };
        let wide = (!session.title.is_empty()).then(|| StripMessage::NowPlaying {
            title: session.title.clone(),
            artist: session.artist.clone(),
        });
        Some(Activity {
            id: ACTIVITY_ID.into(),
            module: MODULE.into(),
            priority,
            leading: Some(leading),
            trailing,
            wide,
        })
    }
}

/// Whether the parts that mean "something happened" differ (positions tick all the time and
/// do not count).
fn content_differs(a: &MediaSession, b: &MediaSession) -> bool {
    a.title != b.title || a.artist != b.artist || a.album != b.album || a.status != b.status
}
