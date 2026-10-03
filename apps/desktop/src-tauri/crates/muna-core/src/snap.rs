//! Snap sessions (docs/modules/window-snap.md): one drag of another application's window,
//! from `MOVESIZESTART` until the Window snap module places it or the UI lets it go. The shell
//! writes the registry from the platform's window events; the module reads it when the UI
//! names a zone at release. The UI only ever sees a session id, never a window handle.
//!
//! One drag runs at a time, so a new session replaces whatever the previous drag left behind
//! (a release the UI never resolved). The registry also carries the module's on/off switch:
//! the shell asks it before it starts a session, so a disabled module costs nothing per drag
//! (docs/modules/window-snap.md "zones never appear when disabled").

use std::sync::atomic::{AtomicBool, Ordering};

use parking_lot::Mutex;

/// Identifies one window drag; unique for the life of the process.
pub type SnapSessionId = u32;

/// A native window handle as the platform reports it (`HWND` on Windows).
pub type SnapWindow = isize;

/// One drag as the module needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapSession {
    pub id: SnapSessionId,
    /// The window being dragged.
    pub window: SnapWindow,
    /// The notch window whose zones the cursor is over, while it is over one.
    pub label: Option<String>,
    /// `true` once `MOVESIZEEND` arrived and a zone may be applied.
    pub ended: bool,
}

#[derive(Debug, Default)]
struct Inner {
    current: Option<SnapSession>,
    next_id: SnapSessionId,
}

/// The registry the shell writes and the module reads.
#[derive(Debug, Default)]
pub struct SnapSessions {
    inner: Mutex<Inner>,
    enabled: AtomicBool,
}

impl SnapSessions {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether the module is on; the shell starts no session while it is off.
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Release);
    }

    #[must_use]
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    /// `window` started being dragged; forgets any earlier session.
    pub fn begin(&self, window: SnapWindow) -> SnapSessionId {
        let mut inner = self.inner.lock();
        inner.next_id = inner.next_id.wrapping_add(1).max(1);
        let id = inner.next_id;
        inner.current = Some(SnapSession {
            id,
            window,
            label: None,
            ended: false,
        });
        id
    }

    /// The cursor is over the notch window `label` (or over none): remembered so the module
    /// can check the zone belongs to the window the UI hovered.
    pub fn set_label(&self, id: SnapSessionId, label: Option<String>) -> bool {
        let mut inner = self.inner.lock();
        match inner.current.as_mut().filter(|s| s.id == id) {
            Some(session) => {
                session.label = label;
                true
            }
            None => false,
        }
    }

    /// The drag ended (`MOVESIZEEND`); `false` for an unknown session.
    pub fn mark_ended(&self, id: SnapSessionId) -> bool {
        let mut inner = self.inner.lock();
        match inner.current.as_mut().filter(|s| s.id == id) {
            Some(session) => {
                session.ended = true;
                true
            }
            None => false,
        }
    }

    /// The live session, if any.
    #[must_use]
    pub fn current(&self) -> Option<SnapSession> {
        self.inner.lock().current.clone()
    }

    /// Removes and returns one session (the module takes it to place the window).
    pub fn take(&self, id: SnapSessionId) -> Option<SnapSession> {
        let mut inner = self.inner.lock();
        if inner.current.as_ref().is_some_and(|s| s.id == id) {
            inner.current.take()
        } else {
            None
        }
    }

    /// Forgets one session (released outside every zone); `false` when unknown.
    pub fn remove(&self, id: SnapSessionId) -> bool {
        self.take(id).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_lives_from_start_to_take() {
        let sessions = SnapSessions::new();
        let id = sessions.begin(0x40);
        assert!(id >= 1);
        let current = sessions.current().unwrap();
        assert_eq!(current.window, 0x40);
        assert_eq!(current.label, None);
        assert!(!current.ended);
        assert!(sessions.set_label(id, Some("notch".to_owned())));
        assert!(sessions.mark_ended(id));
        let taken = sessions.take(id).unwrap();
        assert_eq!(taken.label.as_deref(), Some("notch"));
        assert!(taken.ended);
        assert!(sessions.current().is_none());
        assert!(sessions.take(id).is_none());
    }

    #[test]
    fn a_new_drag_replaces_the_old_session() {
        let sessions = SnapSessions::new();
        let first = sessions.begin(0x40);
        let second = sessions.begin(0x41);
        assert_ne!(first, second);
        assert!(!sessions.mark_ended(first));
        assert!(!sessions.set_label(first, None));
        assert_eq!(sessions.current().unwrap().window, 0x41);
        assert!(!sessions.remove(first));
        assert!(sessions.remove(second));
        assert!(sessions.current().is_none());
    }

    #[test]
    fn the_switch_starts_off() {
        let sessions = SnapSessions::new();
        assert!(!sessions.is_enabled());
        sessions.set_enabled(true);
        assert!(sessions.is_enabled());
    }
}
