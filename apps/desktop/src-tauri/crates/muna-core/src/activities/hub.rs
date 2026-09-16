//! The hub modules publish through. It owns the [`Scheduler`], notices when the strip content
//! changes and tells its sinks, and tracks which windows have a panel open so notices queue
//! while any strip is hidden (docs/modules/live-activities.md, ADR-0004).

use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Instant;

use parking_lot::Mutex;

use super::scheduler::{ActivityState, Scheduler};
use super::{Activity, Notice, StripContent};
use crate::clock::Clock;

/// Receives the strip content each time it changes (the Tauri glue emits it to every window).
pub trait StripSink: Send + Sync {
    fn strip_changed(&self, content: &StripContent);
}

/// Told whenever a call may have moved [`Hub::next_deadline`], so one timer task can re-arm.
pub trait Waker: Send + Sync {
    fn wake(&self);
}

pub struct Hub {
    scheduler: Mutex<Scheduler>,
    last: Mutex<Option<StripContent>>,
    sinks: Mutex<Vec<Arc<dyn StripSink>>>,
    waker: Mutex<Option<Arc<dyn Waker>>>,
    /// Windows whose panel is open; the strip is suspended while this is non-empty.
    suspended_by: Mutex<BTreeSet<String>>,
}

impl std::fmt::Debug for Hub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Hub")
            .field("scheduler", &*self.scheduler.lock())
            .field("sinks", &self.sinks.lock().len())
            .field("suspended_by", &*self.suspended_by.lock())
            .finish_non_exhaustive()
    }
}

impl Hub {
    #[must_use]
    pub fn new(clock: Arc<dyn Clock>) -> Self {
        Self {
            scheduler: Mutex::new(Scheduler::new(clock)),
            last: Mutex::new(None),
            sinks: Mutex::new(Vec::new()),
            waker: Mutex::new(None),
            suspended_by: Mutex::new(BTreeSet::new()),
        }
    }

    pub fn add_sink(&self, sink: Arc<dyn StripSink>) {
        self.sinks.lock().push(sink);
    }

    pub fn set_waker(&self, waker: Arc<dyn Waker>) {
        *self.waker.lock() = Some(waker);
    }

    // --- publishing -----------------------------------------------------------------------

    pub fn publish_activity(&self, activity: Activity) {
        self.scheduler.lock().publish_activity(activity);
        self.refresh();
    }

    pub fn retract_activity(&self, id: &str) {
        self.scheduler.lock().retract_activity(id);
        self.refresh();
    }

    pub fn publish_notice(&self, notice: Notice) {
        self.scheduler.lock().publish_notice(notice);
        self.refresh();
    }

    pub fn dismiss_notice(&self) {
        self.scheduler.lock().dismiss_notice();
        self.refresh();
    }

    pub fn set_focused(&self, id: &str, focused: bool) {
        self.scheduler.lock().set_focused(id, focused);
        self.refresh();
    }

    /// A window's panel opened (`suspended`) or closed. The scheduler is suspended while any
    /// window says so.
    pub fn set_suspended(&self, window: &str, suspended: bool) {
        let any = {
            let mut by = self.suspended_by.lock();
            if suspended {
                by.insert(window.to_owned());
            } else {
                by.remove(window);
            }
            !by.is_empty()
        };
        self.scheduler.lock().set_suspended(any);
        self.refresh();
    }

    /// Forgets a window that went away (monitor removed) so it cannot keep the strip suspended.
    pub fn forget_window(&self, window: &str) {
        self.set_suspended(window, false);
    }

    // --- reading --------------------------------------------------------------------------

    /// Re-evaluates the strip and notifies the sinks when the content changed. Returns the
    /// current content. Call it when a deadline passes.
    pub fn refresh(&self) -> StripContent {
        let content = self.scheduler.lock().current();
        let changed = {
            let mut last = self.last.lock();
            if last.as_ref() == Some(&content) {
                false
            } else {
                *last = Some(content.clone());
                true
            }
        };
        if changed {
            let sinks = self.sinks.lock().clone();
            for sink in sinks {
                sink.strip_changed(&content);
            }
        }
        let waker = self.waker.lock().clone();
        if let Some(waker) = waker {
            waker.wake();
        }
        content
    }

    /// The content as of the last evaluation, without side effects (for a window that mounts
    /// late). Falls back to a fresh evaluation the first time.
    pub fn current(&self) -> StripContent {
        let last = self.last.lock().clone();
        last.unwrap_or_else(|| self.refresh())
    }

    #[must_use]
    pub fn activities(&self) -> Vec<ActivityState> {
        self.scheduler.lock().activities()
    }

    #[must_use]
    pub fn next_deadline(&self) -> Option<Instant> {
        self.scheduler.lock().next_deadline()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::activities::{NOTICE_HOLD, StripMessage};
    use crate::clock::FakeClock;

    #[derive(Default)]
    struct Recorder {
        seen: Mutex<Vec<StripContent>>,
    }

    impl StripSink for Recorder {
        fn strip_changed(&self, content: &StripContent) {
            self.seen.lock().push(content.clone());
        }
    }

    #[derive(Default)]
    struct Counter(AtomicUsize);

    impl Waker for Counter {
        fn wake(&self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    fn notice(id: &str) -> Notice {
        Notice {
            id: id.into(),
            module: "test".into(),
            priority: 50,
            leading: None,
            trailing: None,
            wide: Some(StripMessage::Text { value: id.into() }),
            hold_ms: 0,
        }
    }

    fn setup() -> (Arc<FakeClock>, Hub, Arc<Recorder>, Arc<Counter>) {
        let clock = Arc::new(FakeClock::new());
        let hub = Hub::new(clock.clone());
        let recorder = Arc::new(Recorder::default());
        let counter = Arc::new(Counter::default());
        hub.add_sink(recorder.clone());
        hub.set_waker(counter.clone());
        (clock, hub, recorder, counter)
    }

    #[test]
    fn sinks_hear_each_change_once_and_the_waker_every_call() {
        let (clock, hub, recorder, counter) = setup();
        hub.publish_notice(notice("a"));
        hub.publish_notice(notice("a"));
        assert_eq!(recorder.seen.lock().len(), 1);
        assert_eq!(counter.0.load(Ordering::SeqCst), 2);
        assert_eq!(hub.next_deadline(), Some(clock.now() + NOTICE_HOLD));

        clock.advance(NOTICE_HOLD);
        assert_eq!(hub.refresh(), StripContent::Idle);
        assert_eq!(recorder.seen.lock().len(), 2);
        assert_eq!(hub.next_deadline(), None);
    }

    #[test]
    fn suspension_is_the_union_of_open_panels() {
        let (_, hub, recorder, _) = setup();
        hub.set_suspended("notch-1", true);
        hub.set_suspended("notch-2", true);
        hub.publish_notice(notice("queued"));
        assert_eq!(hub.current(), StripContent::Idle);

        hub.set_suspended("notch-1", false);
        assert_eq!(hub.current(), StripContent::Idle);
        hub.forget_window("notch-2");
        assert!(matches!(hub.current(), StripContent::Notice { notice } if notice.id == "queued"));
        // Two announcements: the initial Idle (first evaluation) and the notice; the
        // intermediate calls that changed nothing stayed silent.
        assert_eq!(recorder.seen.lock().len(), 2);
    }

    #[test]
    fn current_evaluates_once_when_nothing_was_announced_yet() {
        let (_, hub, recorder, _) = setup();
        assert_eq!(hub.current(), StripContent::Idle);
        assert_eq!(hub.current(), StripContent::Idle);
        // The first evaluation announces the initial content so late windows and the log agree.
        assert_eq!(recorder.seen.lock().len(), 1);
    }

    #[test]
    fn debug_output_is_compact() {
        let (_, hub, _, _) = setup();
        let text = format!("{hub:?}");
        assert!(text.contains("Hub"));
        assert!(!text.contains("published_at"));
    }
}
