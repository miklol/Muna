//! Decides what the closed strip shows (docs/02-prd.md "strip content", docs/03 scheduler).
//!
//! Modules publish **activities** (long-lived, e.g. now playing) and **notices** (short,
//! e.g. "headphones connected"). A notice always wins while it is held; otherwise the
//! highest-priority activity shows; otherwise the strip is idle. Ties resolve to the most
//! recently published item so a new activity is not hidden behind a stale one.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::clock::{Clock, SystemClock};

/// Long-lived strip content owned by a module.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub module: String,
    /// 0–100; higher wins. Module defaults live in docs/modules/*.md.
    pub priority: u8,
    /// Leading slot descriptor (`"image"`, `"icon:battery"`, …); the UI maps it to a view.
    pub leading: Option<String>,
    pub trailing: Option<String>,
    /// Optional text for the wide (expanded strip) layout.
    pub wide_text: Option<String>,
}

/// Short, self-dismissing strip content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub id: String,
    pub module: String,
    pub priority: u8,
    pub text: String,
    /// How long the notice holds the strip.
    pub hold_ms: u32,
}

/// What the closed strip renders right now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StripContent {
    Idle,
    Activity { activity: Activity },
    Notice { notice: Notice },
}

#[derive(Debug, Clone)]
struct Held<T> {
    item: T,
    published_at: Instant,
}

/// Single-threaded state; wrap in a mutex at the call site (the app does this in its
/// managed state).
pub struct Scheduler {
    clock: Arc<dyn Clock>,
    activities: Vec<Held<Activity>>,
    notice: Option<(Held<Notice>, Instant)>,
}

impl std::fmt::Debug for Scheduler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Scheduler")
            .field("activities", &self.activities.len())
            .field("has_notice", &self.notice.is_some())
            .finish_non_exhaustive()
    }
}

impl Default for Scheduler {
    fn default() -> Self {
        Self::new(Arc::new(SystemClock))
    }
}

impl Scheduler {
    #[must_use]
    pub fn new(clock: Arc<dyn Clock>) -> Self {
        Self {
            clock,
            activities: Vec::new(),
            notice: None,
        }
    }

    /// Publishes or updates an activity (matched by `id`).
    pub fn publish_activity(&mut self, activity: Activity) {
        let now = self.clock.now();
        self.activities.retain(|held| held.item.id != activity.id);
        self.activities.push(Held {
            item: activity,
            published_at: now,
        });
    }

    pub fn retract_activity(&mut self, id: &str) {
        self.activities.retain(|held| held.item.id != id);
    }

    /// Publishes a notice. A lower-priority notice never interrupts one that is still held.
    pub fn publish_notice(&mut self, notice: Notice) {
        let now = self.clock.now();
        self.expire_notice(now);
        if let Some((current, _)) = &self.notice
            && current.item.priority > notice.priority
        {
            return;
        }
        let until = now + Duration::from_millis(u64::from(notice.hold_ms));
        self.notice = Some((
            Held {
                item: notice,
                published_at: now,
            },
            until,
        ));
    }

    pub fn dismiss_notice(&mut self) {
        self.notice = None;
    }

    /// Current strip content. Expired notices are dropped as a side effect.
    pub fn current(&mut self) -> StripContent {
        let now = self.clock.now();
        self.expire_notice(now);
        if let Some((held, _)) = &self.notice {
            return StripContent::Notice {
                notice: held.item.clone(),
            };
        }
        self.activities
            .iter()
            .max_by(|a, b| {
                a.item
                    .priority
                    .cmp(&b.item.priority)
                    .then(a.published_at.cmp(&b.published_at))
            })
            .map_or(StripContent::Idle, |held| StripContent::Activity {
                activity: held.item.clone(),
            })
    }

    /// When the current notice expires, if any; the shell schedules its next tick from this
    /// instead of polling (performance budget: no timers while idle).
    #[must_use]
    pub fn next_deadline(&self) -> Option<Instant> {
        self.notice.as_ref().map(|(_, until)| *until)
    }

    fn expire_notice(&mut self, now: Instant) {
        if let Some((_, until)) = &self.notice
            && now >= *until
        {
            self.notice = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::FakeClock;

    fn activity(id: &str, priority: u8) -> Activity {
        Activity {
            id: id.into(),
            module: "test".into(),
            priority,
            leading: None,
            trailing: None,
            wide_text: None,
        }
    }

    fn notice(id: &str, priority: u8, hold_ms: u32) -> Notice {
        Notice {
            id: id.into(),
            module: "test".into(),
            priority,
            text: id.into(),
            hold_ms,
        }
    }

    fn scheduler() -> (Arc<FakeClock>, Scheduler) {
        let clock = Arc::new(FakeClock::new());
        (clock.clone(), Scheduler::new(clock))
    }

    #[test]
    fn idle_when_nothing_is_published() {
        let (_, mut s) = scheduler();
        assert_eq!(s.current(), StripContent::Idle);
        assert_eq!(s.next_deadline(), None);
    }

    #[test]
    fn highest_priority_activity_wins_and_ties_go_to_newest() {
        let (_, mut s) = scheduler();
        s.publish_activity(activity("timer", 40));
        s.publish_activity(activity("media", 60));
        assert!(
            matches!(s.current(), StripContent::Activity { activity } if activity.id == "media")
        );

        s.publish_activity(activity("calendar", 60));
        assert!(
            matches!(s.current(), StripContent::Activity { activity } if activity.id == "calendar")
        );

        s.retract_activity("calendar");
        s.retract_activity("media");
        assert!(
            matches!(s.current(), StripContent::Activity { activity } if activity.id == "timer")
        );
    }

    #[test]
    fn republishing_an_activity_updates_it_in_place() {
        let (_, mut s) = scheduler();
        s.publish_activity(activity("media", 60));
        let mut updated = activity("media", 60);
        updated.wide_text = Some("Song".into());
        s.publish_activity(updated.clone());
        assert_eq!(s.current(), StripContent::Activity { activity: updated });
    }

    #[test]
    fn notice_preempts_activities_until_it_expires() {
        let (clock, mut s) = scheduler();
        s.publish_activity(activity("media", 60));
        s.publish_notice(notice("bt", 80, 4000));
        assert!(matches!(s.current(), StripContent::Notice { .. }));
        assert_eq!(
            s.next_deadline(),
            Some(clock.now() + Duration::from_millis(4000))
        );

        clock.advance(Duration::from_millis(3999));
        assert!(matches!(s.current(), StripContent::Notice { .. }));

        clock.advance(Duration::from_millis(1));
        assert!(matches!(s.current(), StripContent::Activity { .. }));
        assert_eq!(s.next_deadline(), None);
    }

    #[test]
    fn lower_priority_notice_does_not_interrupt_a_held_one() {
        let (clock, mut s) = scheduler();
        s.publish_notice(notice("high", 90, 2000));
        s.publish_notice(notice("low", 10, 2000));
        assert!(matches!(s.current(), StripContent::Notice { notice } if notice.id == "high"));

        clock.advance(Duration::from_millis(2000));
        s.publish_notice(notice("low", 10, 2000));
        assert!(matches!(s.current(), StripContent::Notice { notice } if notice.id == "low"));
    }

    #[test]
    fn equal_priority_notice_replaces_the_current_one() {
        let (_, mut s) = scheduler();
        s.publish_notice(notice("a", 50, 2000));
        s.publish_notice(notice("b", 50, 2000));
        assert!(matches!(s.current(), StripContent::Notice { notice } if notice.id == "b"));
    }

    #[test]
    fn dismiss_clears_the_notice() {
        let (_, mut s) = scheduler();
        s.publish_notice(notice("a", 50, 2000));
        s.dismiss_notice();
        assert_eq!(s.current(), StripContent::Idle);
    }

    #[test]
    fn strip_content_serialises_with_a_kind_tag() {
        let json = serde_json::to_value(StripContent::Idle).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "idle" }));
        let json = serde_json::to_value(StripContent::Activity {
            activity: activity("media", 60),
        })
        .unwrap();
        assert_eq!(json["kind"], "activity");
        assert_eq!(json["activity"]["wideText"], serde_json::Value::Null);
    }
}
