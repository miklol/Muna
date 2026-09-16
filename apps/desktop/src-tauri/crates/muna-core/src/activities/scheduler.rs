//! The scheduler proper: priority, focus, tie rotation, the wide burst, notices with their
//! queue, and the suspend switch used while a panel is open (docs/modules/live-activities.md
//! "Scheduler"; S8 in docs/09-testing-qa.md).
//!
//! Single-threaded state — [`super::Hub`] wraps it in a mutex and owns the notifications.

use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use specta::Type;

use super::{Activity, Notice, StripContent, TIE_ROTATION, WIDE_FORM_HOLD};
use crate::clock::{Clock, SystemClock};

#[derive(Debug, Clone)]
struct HeldActivity {
    activity: Activity,
    published_at: Instant,
    /// The wide form shows until this instant, set whenever the text changes.
    wide_until: Option<Instant>,
}

#[derive(Debug, Clone)]
struct HeldNotice {
    notice: Notice,
    until: Instant,
}

/// Which equal-priority activities are taking turns, and where the turn is.
#[derive(Debug, Clone, Default)]
struct Rotation {
    members: Vec<String>,
    offset: usize,
    since: Option<Instant>,
}

/// An activity plus the user state the scheduler keeps for it (the expanded list).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityState {
    pub activity: Activity,
    pub focused: bool,
}

pub struct Scheduler {
    clock: Arc<dyn Clock>,
    activities: Vec<HeldActivity>,
    focused: Option<String>,
    current_notice: Option<HeldNotice>,
    /// Notices waiting for the strip: highest priority first, arrival order among equals.
    queued: Vec<Notice>,
    /// While a panel is open the strip is hidden: notices queue instead of playing.
    suspended: bool,
    rotation: Rotation,
}

impl std::fmt::Debug for Scheduler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Scheduler")
            .field("activities", &self.activities.len())
            .field("focused", &self.focused)
            .field("has_notice", &self.current_notice.is_some())
            .field("queued", &self.queued.len())
            .field("suspended", &self.suspended)
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
            focused: None,
            current_notice: None,
            queued: Vec::new(),
            suspended: false,
            rotation: Rotation::default(),
        }
    }

    // --- activities ---------------------------------------------------------------------

    /// Publishes or updates an activity (matched by `id`). A new activity, or one whose text
    /// changed, shows the wide form for [`WIDE_FORM_HOLD`] — the "track change" burst.
    pub fn publish_activity(&mut self, activity: Activity) {
        let now = self.clock.now();
        let has_text = activity.wide.is_some();
        match self
            .activities
            .iter_mut()
            .find(|held| held.activity.id == activity.id)
        {
            Some(held) => {
                if held.activity.wide != activity.wide {
                    held.wide_until = has_text.then_some(now + WIDE_FORM_HOLD);
                }
                held.activity = activity;
            }
            None => self.activities.push(HeldActivity {
                activity,
                published_at: now,
                wide_until: has_text.then_some(now + WIDE_FORM_HOLD),
            }),
        }
    }

    pub fn retract_activity(&mut self, id: &str) {
        self.activities.retain(|held| held.activity.id != id);
        if self.focused.as_deref() == Some(id) {
            self.focused = None;
        }
    }

    /// Pins (or unpins) an activity so it wins regardless of priority. Only one activity is
    /// focused at a time; focusing an unknown id is ignored.
    pub fn set_focused(&mut self, id: &str, focused: bool) {
        if focused {
            if self.activities.iter().any(|held| held.activity.id == id) {
                self.focused = Some(id.to_owned());
            }
        } else if self.focused.as_deref() == Some(id) {
            self.focused = None;
        }
    }

    /// Every activity with its focus flag, highest priority first, newest first among equals.
    #[must_use]
    pub fn activities(&self) -> Vec<ActivityState> {
        let mut held: Vec<&HeldActivity> = self.activities.iter().collect();
        held.sort_by(|a, b| {
            b.activity
                .priority
                .cmp(&a.activity.priority)
                .then(b.published_at.cmp(&a.published_at))
        });
        held.into_iter()
            .map(|held| ActivityState {
                activity: held.activity.clone(),
                focused: self.focused.as_deref() == Some(held.activity.id.as_str()),
            })
            .collect()
    }

    // --- notices ------------------------------------------------------------------------

    /// Publishes a notice. It plays now when the strip is free or the held notice is not more
    /// important; otherwise it queues and plays when its turn comes. Republishing an id
    /// restarts its hold (or updates it in the queue).
    pub fn publish_notice(&mut self, notice: Notice) {
        let now = self.clock.now();
        self.expire_notice(now);
        self.queued.retain(|queued| queued.id != notice.id);
        if self.suspended {
            self.enqueue(notice);
            return;
        }
        match &self.current_notice {
            Some(held) if held.notice.id != notice.id && held.notice.priority > notice.priority => {
                self.enqueue(notice);
            }
            // Equal or higher priority pre-empts; the interrupted notice was seen and is dropped.
            _ => self.start_notice(notice, now),
        }
    }

    /// Drops the held notice; the next queued one, if any, starts.
    pub fn dismiss_notice(&mut self) {
        self.current_notice = None;
        if !self.suspended {
            self.start_next_queued(self.clock.now());
        }
    }

    /// Hides or shows the strip from the scheduler's point of view. While suspended (a panel
    /// is open) notices queue and nothing is due; resuming plays the queue.
    pub fn set_suspended(&mut self, suspended: bool) {
        if self.suspended == suspended {
            return;
        }
        self.suspended = suspended;
        if !suspended {
            let now = self.clock.now();
            self.expire_notice(now);
            if self.current_notice.is_none() {
                self.start_next_queued(now);
            }
        }
    }

    #[must_use]
    pub fn is_suspended(&self) -> bool {
        self.suspended
    }

    fn enqueue(&mut self, notice: Notice) {
        let position = self
            .queued
            .iter()
            .position(|queued| queued.priority < notice.priority)
            .unwrap_or(self.queued.len());
        self.queued.insert(position, notice);
    }

    fn start_notice(&mut self, notice: Notice, now: Instant) {
        let until = now + notice.hold();
        self.current_notice = Some(HeldNotice { notice, until });
    }

    fn start_next_queued(&mut self, now: Instant) {
        if !self.queued.is_empty() {
            let notice = self.queued.remove(0);
            self.start_notice(notice, now);
        }
    }

    fn expire_notice(&mut self, now: Instant) {
        if let Some(held) = &self.current_notice
            && now >= held.until
        {
            self.current_notice = None;
            if !self.suspended {
                self.start_next_queued(now);
            }
        }
    }

    // --- resolution ---------------------------------------------------------------------

    /// What the strip shows now. Expired notices and finished rotations are advanced as a
    /// side effect, so call this from a timer at [`Self::next_deadline`].
    pub fn current(&mut self) -> StripContent {
        let now = self.clock.now();
        self.expire_notice(now);
        if !self.suspended
            && let Some(held) = &self.current_notice
        {
            return StripContent::Notice {
                notice: held.notice.clone(),
            };
        }
        let Some(index) = self.shown_activity(now) else {
            return StripContent::Idle;
        };
        let held = &self.activities[index];
        StripContent::Activity {
            activity: held.activity.clone(),
            wide: held.activity.wide.is_some() && held.wide_until.is_some_and(|until| now < until),
        }
    }

    /// When the content will change by itself, if ever; the shell arms one timer for it
    /// instead of polling (performance budget: no timers while idle). Nothing is due while
    /// suspended: the strip is hidden and resuming re-evaluates.
    #[must_use]
    pub fn next_deadline(&self) -> Option<Instant> {
        if self.suspended {
            return None;
        }
        if let Some(held) = &self.current_notice {
            return Some(held.until);
        }
        let now = self.clock.now();
        let mut deadline: Option<Instant> = None;
        let mut consider = |at: Instant| {
            if deadline.is_none_or(|current| at < current) {
                deadline = Some(at);
            }
        };
        if let Some(index) = self.peek_shown_activity(now) {
            let held = &self.activities[index];
            if let Some(until) = held.wide_until
                && held.activity.wide.is_some()
                && until > now
            {
                consider(until);
            }
        }
        if self.rotation.members.len() > 1
            && let Some(since) = self.rotation.since
        {
            consider(since + TIE_ROTATION);
        }
        deadline
    }

    /// Index of the activity the strip shows, advancing the tie rotation as time passes.
    fn shown_activity(&mut self, now: Instant) -> Option<usize> {
        if let Some(focused) = &self.focused
            && let Some(index) = self
                .activities
                .iter()
                .position(|held| &held.activity.id == focused)
        {
            self.rotation = Rotation::default();
            return Some(index);
        }
        let tied = self.tied_indices();
        match tied.len() {
            0 => {
                self.rotation = Rotation::default();
                None
            }
            1 => {
                self.rotation = Rotation::default();
                tied.first().copied()
            }
            count => {
                let members: Vec<String> = tied
                    .iter()
                    .map(|&index| self.activities[index].activity.id.clone())
                    .collect();
                if self.rotation.members != members {
                    // The set changed: start on the newest so a new activity is not hidden
                    // behind a stale one, and restart the 8 s turn.
                    self.rotation = Rotation {
                        members,
                        offset: count - 1,
                        since: Some(now),
                    };
                } else if let Some(since) = self.rotation.since {
                    let turns = usize::try_from(
                        now.saturating_duration_since(since).as_millis() / TIE_ROTATION.as_millis(),
                    )
                    .unwrap_or(0);
                    if turns > 0 {
                        self.rotation.offset = (self.rotation.offset + turns) % count;
                        self.rotation.since =
                            Some(since + TIE_ROTATION * u32::try_from(turns).unwrap_or(u32::MAX));
                    }
                }
                tied.get(self.rotation.offset % count).copied()
            }
        }
    }

    /// Like [`Self::shown_activity`] but without advancing anything.
    fn peek_shown_activity(&self, now: Instant) -> Option<usize> {
        if let Some(focused) = &self.focused
            && let Some(index) = self
                .activities
                .iter()
                .position(|held| &held.activity.id == focused)
        {
            return Some(index);
        }
        let tied = self.tied_indices();
        match tied.len() {
            0 => None,
            1 => tied.first().copied(),
            count => {
                let mut offset = self.rotation.offset;
                if let Some(since) = self.rotation.since {
                    let turns = usize::try_from(
                        now.saturating_duration_since(since).as_millis() / TIE_ROTATION.as_millis(),
                    )
                    .unwrap_or(0);
                    offset = (offset + turns) % count;
                }
                tied.get(offset % count).copied()
            }
        }
    }

    /// Indices of the activities sharing the highest priority, oldest first.
    fn tied_indices(&self) -> Vec<usize> {
        let Some(top) = self
            .activities
            .iter()
            .map(|held| held.activity.priority)
            .max()
        else {
            return Vec::new();
        };
        let mut tied: Vec<usize> = (0..self.activities.len())
            .filter(|&index| self.activities[index].activity.priority == top)
            .collect();
        tied.sort_by_key(|&index| self.activities[index].published_at);
        tied
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::activities::{Glyph, Leading, NOTICE_HOLD, StripMessage, Trailing};
    use crate::clock::FakeClock;

    fn activity(id: &str, priority: u8) -> Activity {
        Activity {
            id: id.into(),
            module: "test".into(),
            priority,
            leading: None,
            trailing: None,
            wide: None,
        }
    }

    fn wide_activity(id: &str, priority: u8, text: &str) -> Activity {
        Activity {
            wide: Some(StripMessage::Text { value: text.into() }),
            ..activity(id, priority)
        }
    }

    fn notice(id: &str, priority: u8, hold_ms: u32) -> Notice {
        Notice {
            id: id.into(),
            module: "test".into(),
            priority,
            leading: Some(Leading::Icon {
                glyph: Glyph::Bell,
                tint: None,
            }),
            trailing: Some(Trailing::Text { value: id.into() }),
            wide: None,
            hold_ms,
        }
    }

    fn scheduler() -> (Arc<FakeClock>, Scheduler) {
        let clock = Arc::new(FakeClock::new());
        (clock.clone(), Scheduler::new(clock))
    }

    fn shown_id(s: &mut Scheduler) -> Option<String> {
        s.current().item_id().map(str::to_owned)
    }

    fn is_wide(s: &mut Scheduler) -> bool {
        matches!(s.current(), StripContent::Activity { wide: true, .. })
    }

    #[test]
    fn idle_when_nothing_is_published() {
        let (_, mut s) = scheduler();
        assert_eq!(s.current(), StripContent::Idle);
        assert_eq!(s.next_deadline(), None);
    }

    #[test]
    fn highest_priority_activity_wins() {
        let (_, mut s) = scheduler();
        s.publish_activity(activity("timer", 40));
        s.publish_activity(activity("media", 60));
        assert_eq!(shown_id(&mut s).as_deref(), Some("media"));
        s.retract_activity("media");
        assert_eq!(shown_id(&mut s).as_deref(), Some("timer"));
    }

    #[test]
    fn republishing_updates_in_place_without_reordering() {
        let (_, mut s) = scheduler();
        s.publish_activity(activity("media", 60));
        let mut updated = activity("media", 60);
        updated.trailing = Some(Trailing::Progress { percent: 10 });
        s.publish_activity(updated.clone());
        assert_eq!(
            s.current(),
            StripContent::Activity {
                activity: updated,
                wide: false
            }
        );
        assert_eq!(s.activities().len(), 1);
    }

    #[test]
    fn focused_activity_beats_priority_until_unfocused_or_retracted() {
        let (_, mut s) = scheduler();
        s.publish_activity(activity("pomodoro", 70));
        s.publish_activity(activity("media", 60));
        assert_eq!(shown_id(&mut s).as_deref(), Some("pomodoro"));

        s.set_focused("media", true);
        assert_eq!(shown_id(&mut s).as_deref(), Some("media"));
        assert!(
            s.activities()
                .iter()
                .any(|a| a.activity.id == "media" && a.focused)
        );

        s.set_focused("media", false);
        assert_eq!(shown_id(&mut s).as_deref(), Some("pomodoro"));

        s.set_focused("media", true);
        s.retract_activity("media");
        assert_eq!(shown_id(&mut s).as_deref(), Some("pomodoro"));
        assert!(s.activities().iter().all(|a| !a.focused));

        s.set_focused("unknown", true);
        assert_eq!(shown_id(&mut s).as_deref(), Some("pomodoro"));
    }

    #[test]
    fn ties_start_on_the_newest_and_rotate_every_eight_seconds() {
        let (clock, mut s) = scheduler();
        s.publish_activity(activity("a", 60));
        clock.advance(Duration::from_millis(10));
        s.publish_activity(activity("b", 60));
        assert_eq!(shown_id(&mut s).as_deref(), Some("b"));
        assert_eq!(s.next_deadline(), Some(clock.now() + TIE_ROTATION));

        clock.advance(TIE_ROTATION.saturating_sub(Duration::from_millis(1)));
        assert_eq!(shown_id(&mut s).as_deref(), Some("b"));
        clock.advance(Duration::from_millis(1));
        assert_eq!(shown_id(&mut s).as_deref(), Some("a"));
        clock.advance(TIE_ROTATION);
        assert_eq!(shown_id(&mut s).as_deref(), Some("b"));

        // A third member restarts the turn on the newcomer.
        s.publish_activity(activity("c", 60));
        assert_eq!(shown_id(&mut s).as_deref(), Some("c"));
        clock.advance(TIE_ROTATION);
        assert_eq!(shown_id(&mut s).as_deref(), Some("a"));

        // Breaking the tie stops the rotation and its deadline.
        s.retract_activity("a");
        s.retract_activity("c");
        assert_eq!(shown_id(&mut s).as_deref(), Some("b"));
        assert_eq!(s.next_deadline(), None);
    }

    #[test]
    fn new_text_shows_the_wide_form_for_two_and_a_half_seconds() {
        let (clock, mut s) = scheduler();
        s.publish_activity(wide_activity("media", 60, "Song one"));
        assert!(is_wide(&mut s));
        assert_eq!(s.next_deadline(), Some(clock.now() + WIDE_FORM_HOLD));

        clock.advance(WIDE_FORM_HOLD);
        assert!(!is_wide(&mut s));
        assert_eq!(s.next_deadline(), None);

        // Same text again: no burst. New text: burst.
        s.publish_activity(wide_activity("media", 60, "Song one"));
        assert!(!is_wide(&mut s));
        s.publish_activity(wide_activity("media", 60, "Song two"));
        assert!(is_wide(&mut s));

        // Dropping the text ends the burst at once.
        s.publish_activity(activity("media", 60));
        assert!(!is_wide(&mut s));
    }

    #[test]
    fn notice_preempts_activities_until_it_expires() {
        let (clock, mut s) = scheduler();
        s.publish_activity(activity("media", 60));
        s.publish_notice(notice("bt", 85, 0));
        assert_eq!(shown_id(&mut s).as_deref(), Some("bt"));
        assert_eq!(s.next_deadline(), Some(clock.now() + NOTICE_HOLD));

        clock.advance(NOTICE_HOLD.saturating_sub(Duration::from_millis(1)));
        assert_eq!(shown_id(&mut s).as_deref(), Some("bt"));
        clock.advance(Duration::from_millis(1));
        assert_eq!(shown_id(&mut s).as_deref(), Some("media"));
        assert_eq!(s.next_deadline(), None);
    }

    #[test]
    fn a_less_important_notice_waits_its_turn() {
        let (clock, mut s) = scheduler();
        s.publish_notice(notice("high", 90, 2000));
        s.publish_notice(notice("low", 10, 2000));
        assert_eq!(shown_id(&mut s).as_deref(), Some("high"));

        clock.advance(Duration::from_millis(2000));
        assert_eq!(shown_id(&mut s).as_deref(), Some("low"));
        assert_eq!(
            s.next_deadline(),
            Some(clock.now() + Duration::from_millis(2000))
        );
        clock.advance(Duration::from_millis(2000));
        assert_eq!(s.current(), StripContent::Idle);
    }

    #[test]
    fn queued_notices_play_by_priority_then_arrival() {
        let (clock, mut s) = scheduler();
        s.publish_notice(notice("first", 90, 1000));
        s.publish_notice(notice("late-low", 10, 1000));
        s.publish_notice(notice("mid-a", 50, 1000));
        s.publish_notice(notice("mid-b", 50, 1000));
        let mut order = Vec::new();
        for _ in 0..4 {
            order.push(shown_id(&mut s).unwrap());
            clock.advance(Duration::from_millis(1000));
        }
        assert_eq!(order, ["first", "mid-a", "mid-b", "late-low"]);
    }

    #[test]
    fn equal_priority_notice_replaces_the_current_one_and_same_id_restarts_the_hold() {
        let (clock, mut s) = scheduler();
        s.publish_notice(notice("a", 50, 2000));
        s.publish_notice(notice("b", 50, 2000));
        assert_eq!(shown_id(&mut s).as_deref(), Some("b"));

        clock.advance(Duration::from_millis(1500));
        s.publish_notice(notice("b", 50, 2000));
        assert_eq!(
            s.next_deadline(),
            Some(clock.now() + Duration::from_millis(2000))
        );
    }

    #[test]
    fn dismiss_drops_the_notice_and_starts_the_next() {
        let (_, mut s) = scheduler();
        s.publish_notice(notice("a", 50, 2000));
        s.publish_notice(notice("b", 10, 2000));
        s.dismiss_notice();
        assert_eq!(shown_id(&mut s).as_deref(), Some("b"));
        s.dismiss_notice();
        assert_eq!(s.current(), StripContent::Idle);
    }

    #[test]
    fn notices_queue_while_suspended_and_play_after_resume() {
        // S8: a live activity arrives while Expanded → queued, shown after collapse.
        let (clock, mut s) = scheduler();
        s.publish_activity(activity("media", 60));
        s.set_suspended(true);
        assert!(s.is_suspended());
        s.publish_notice(notice("bt", 85, 0));
        assert_eq!(shown_id(&mut s).as_deref(), Some("media"));
        assert_eq!(s.next_deadline(), None);

        clock.advance(Duration::from_secs(60));
        s.set_suspended(false);
        assert_eq!(shown_id(&mut s).as_deref(), Some("bt"));
        assert_eq!(s.next_deadline(), Some(clock.now() + NOTICE_HOLD));
    }

    #[test]
    fn a_notice_held_when_the_panel_opens_keeps_expiring() {
        let (clock, mut s) = scheduler();
        s.publish_notice(notice("bt", 85, 1000));
        s.set_suspended(true);
        assert_eq!(s.current(), StripContent::Idle);
        clock.advance(Duration::from_millis(1000));
        s.set_suspended(false);
        assert_eq!(s.current(), StripContent::Idle);
    }

    #[test]
    fn activities_list_is_priority_then_newest_first() {
        let (clock, mut s) = scheduler();
        s.publish_activity(activity("old", 60));
        clock.advance(Duration::from_millis(1));
        s.publish_activity(activity("new", 60));
        s.publish_activity(activity("top", 90));
        let ids: Vec<String> = s
            .activities()
            .into_iter()
            .map(|state| state.activity.id)
            .collect();
        assert_eq!(ids, ["top", "new", "old"]);
    }
}
