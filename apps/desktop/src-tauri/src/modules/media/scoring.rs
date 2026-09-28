//! Which session is "now playing" (docs/modules/media.md, docs/04 "Staleness": *score
//! sessions — playing > paused > last-changed*).
//!
//! The OS's own idea of the current session is the tie-breaker within a status class, because
//! it follows the app the user last touched; recency of the last content change (title, artist,
//! album or status) breaks the remaining ties, so a browser tab that just started wins over one
//! that has been paused for an hour. A pinned app always wins while it has a session.

use std::collections::HashMap;

use muna_platform::{MediaSession, PlaybackStatus};

/// The session to show, or `None` when there is none.
#[must_use]
#[allow(clippy::implicit_hasher)]
pub fn pick_active<'a>(
    sessions: &'a [MediaSession],
    pinned: Option<&str>,
    changed_at: &HashMap<String, u64>,
) -> Option<&'a MediaSession> {
    if let Some(pinned) = pinned
        && let Some(session) = sessions.iter().find(|s| s.source_app_id == pinned)
    {
        return Some(session);
    }
    let mut best: Option<(&MediaSession, (u8, bool, u64))> = None;
    for session in sessions {
        let rank = (
            status_rank(session.status),
            session.is_current,
            changed_at
                .get(&session.source_app_id)
                .copied()
                .unwrap_or_default(),
        );
        // Strictly greater keeps the earliest of equals: the platform lists sessions in the
        // OS's order, which is stable across snapshots.
        if best.is_none_or(|(_, current)| rank > current) {
            best = Some((session, rank));
        }
    }
    best.map(|(session, _)| session)
}

const fn status_rank(status: PlaybackStatus) -> u8 {
    match status {
        PlaybackStatus::Playing => 2,
        PlaybackStatus::Paused => 1,
        PlaybackStatus::Stopped => 0,
    }
}
