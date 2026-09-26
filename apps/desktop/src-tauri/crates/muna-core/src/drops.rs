//! Drop sessions (docs/modules/drop-actions.md): what an OLE drag over a notch window carries,
//! kept in Rust from *enter* until the Drop actions module runs an action on it or the UI
//! cancels. The UI only ever sees a session id plus names and kinds, never a path
//! (docs/03-architecture.md "UI never touches the OS"; paths are also personal data).
//!
//! One live session per window label: a new *enter* on the same window replaces whatever the
//! previous drag left behind (a missed *leave*, a drop the UI never resolved), so the registry
//! is bounded by the number of notch windows.
//!
//! The registry also knows when a drag *out* of the notch is in flight ([`DropSessions::
//! self_drag`]): the same OLE drag raises inbound events when it passes back over the notch,
//! and the shell ignores those instead of re-adding a Shelf item to itself
//! (docs/modules/shelf.md). A flag is enough because one drag runs at a time; the inbound
//! events cannot tell a drag apart by its data since wry exposes paths only.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use parking_lot::Mutex;

/// Identifies one drag from *enter* to its action; unique for the life of the process.
pub type DropSessionId = u32;

/// One drag's payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DropSession {
    pub id: DropSessionId,
    /// The notch window the drag is over.
    pub label: String,
    pub paths: Vec<PathBuf>,
    /// `true` once the button was released over the window and an action may run.
    pub dropped: bool,
}

#[derive(Debug, Default)]
struct Inner {
    sessions: Vec<DropSession>,
    next_id: DropSessionId,
}

/// The registry the shell writes and the module reads.
#[derive(Debug, Default)]
pub struct DropSessions {
    inner: Mutex<Inner>,
    self_drags: AtomicUsize,
}

/// Marks a drag out of the notch as in flight until dropped (see [`DropSessions::self_drag`]).
#[derive(Debug)]
pub struct SelfDrag {
    registry: Arc<DropSessions>,
}

impl Drop for SelfDrag {
    fn drop(&mut self) {
        self.registry.self_drags.fetch_sub(1, Ordering::AcqRel);
    }
}

impl DropSessions {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// A drag out of a notch window is starting; hold the guard for as long as it runs. Inbound
    /// drag events are to be ignored meanwhile ([`Self::self_drag_active`]).
    #[must_use]
    pub fn self_drag(self: &Arc<Self>) -> SelfDrag {
        self.self_drags.fetch_add(1, Ordering::AcqRel);
        SelfDrag {
            registry: Arc::clone(self),
        }
    }

    /// `true` while a drag out of the notch is in flight.
    #[must_use]
    pub fn self_drag_active(&self) -> bool {
        self.self_drags.load(Ordering::Acquire) > 0
    }

    /// A drag entered `label` carrying `paths`; forgets any earlier session for that window.
    pub fn begin(&self, label: &str, paths: Vec<PathBuf>) -> DropSessionId {
        let mut inner = self.inner.lock();
        inner.sessions.retain(|session| session.label != label);
        inner.next_id = inner.next_id.wrapping_add(1).max(1);
        let id = inner.next_id;
        inner.sessions.push(DropSession {
            id,
            label: label.to_owned(),
            paths,
            dropped: false,
        });
        id
    }

    /// The button was released over the window. `paths` replaces the payload when the drop
    /// reports one (it is the authoritative list); returns `false` for an unknown session.
    pub fn mark_dropped(&self, id: DropSessionId, paths: Option<Vec<PathBuf>>) -> bool {
        let mut inner = self.inner.lock();
        let Some(session) = inner.sessions.iter_mut().find(|s| s.id == id) else {
            return false;
        };
        session.dropped = true;
        if let Some(paths) = paths.filter(|paths| !paths.is_empty()) {
            session.paths = paths;
        }
        true
    }

    /// The live session over `label`, if any.
    #[must_use]
    pub fn current(&self, label: &str) -> Option<DropSessionId> {
        self.inner
            .lock()
            .sessions
            .iter()
            .find(|s| s.label == label)
            .map(|s| s.id)
    }

    /// A copy of one session.
    #[must_use]
    pub fn get(&self, id: DropSessionId) -> Option<DropSession> {
        self.inner
            .lock()
            .sessions
            .iter()
            .find(|s| s.id == id)
            .cloned()
    }

    /// Removes and returns one session (the module takes it to run an action).
    pub fn take(&self, id: DropSessionId) -> Option<DropSession> {
        let mut inner = self.inner.lock();
        let index = inner.sessions.iter().position(|s| s.id == id)?;
        Some(inner.sessions.remove(index))
    }

    /// Forgets one session (the drag left, or the UI cancelled); `false` when unknown.
    pub fn remove(&self, id: DropSessionId) -> bool {
        let mut inner = self.inner.lock();
        let before = inner.sessions.len();
        inner.sessions.retain(|s| s.id != id);
        inner.sessions.len() != before
    }

    /// Forgets every session over `label` (the window went away).
    pub fn forget_window(&self, label: &str) {
        self.inner.lock().sessions.retain(|s| s.label != label);
    }

    /// Number of live sessions.
    #[must_use]
    pub fn len(&self) -> usize {
        self.inner.lock().sessions.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(names: &[&str]) -> Vec<PathBuf> {
        names.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn a_session_lives_from_enter_to_take() {
        let sessions = DropSessions::new();
        let id = sessions.begin("notch", paths(&["a.txt", "b.txt"]));
        assert_eq!(sessions.current("notch"), Some(id));
        assert!(!sessions.get(id).unwrap().dropped);
        assert!(sessions.mark_dropped(id, None));
        let taken = sessions.take(id).unwrap();
        assert!(taken.dropped);
        assert_eq!(taken.paths, paths(&["a.txt", "b.txt"]));
        assert!(sessions.is_empty());
        assert!(sessions.take(id).is_none());
    }

    #[test]
    fn a_drop_may_replace_the_payload_but_not_with_nothing() {
        let sessions = DropSessions::new();
        let id = sessions.begin("notch", paths(&["a.txt"]));
        assert!(sessions.mark_dropped(id, Some(paths(&[]))));
        assert_eq!(sessions.get(id).unwrap().paths, paths(&["a.txt"]));
        assert!(sessions.mark_dropped(id, Some(paths(&["c.txt"]))));
        assert_eq!(sessions.get(id).unwrap().paths, paths(&["c.txt"]));
        assert!(!sessions.mark_dropped(99, None));
    }

    #[test]
    fn a_new_enter_on_the_same_window_replaces_the_old_session() {
        let sessions = DropSessions::new();
        let first = sessions.begin("notch", paths(&["a.txt"]));
        let other = sessions.begin("notch-2", paths(&["z.txt"]));
        let second = sessions.begin("notch", paths(&["b.txt"]));
        assert_ne!(first, second);
        assert!(sessions.get(first).is_none());
        assert_eq!(sessions.current("notch"), Some(second));
        assert_eq!(sessions.current("notch-2"), Some(other));
        assert_eq!(sessions.len(), 2);
    }

    #[test]
    fn remove_and_forget_window_report_what_they_did() {
        let sessions = DropSessions::new();
        let id = sessions.begin("notch", paths(&["a.txt"]));
        sessions.begin("notch-2", paths(&["b.txt"]));
        assert!(sessions.remove(id));
        assert!(!sessions.remove(id));
        sessions.forget_window("notch-2");
        assert!(sessions.is_empty());
        assert_eq!(sessions.current("notch-2"), None);
    }

    #[test]
    fn ids_are_never_zero() {
        let sessions = DropSessions::new();
        assert!(sessions.begin("notch", Vec::new()) >= 1);
    }

    #[test]
    fn a_self_drag_is_active_while_its_guard_lives() {
        let sessions = Arc::new(DropSessions::new());
        assert!(!sessions.self_drag_active());
        let first = sessions.self_drag();
        let second = sessions.self_drag();
        assert!(sessions.self_drag_active());
        drop(first);
        assert!(sessions.self_drag_active());
        drop(second);
        assert!(!sessions.self_drag_active());
    }
}
