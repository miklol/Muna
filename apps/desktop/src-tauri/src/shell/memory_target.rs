//! When to ask `WebView2` for a low memory usage target (docs/spikes/m0-window.md, W5:
//! `ICoreWebView2_19::MemoryUsageTargetLevel(Low)` purges caches and trims the working sets of
//! the browser and renderer processes). The trim is asked for only when nothing is moving: the
//! strip is still (bare, or a chip that does not animate on its own), the settings window is
//! not in use and the cursor has stayed outside every notch window for a while. It is lifted
//! the moment the cursor comes back inside the bounds — a quarter second before a hover can
//! reveal anything — or the strip changes, so no animation runs on a purged renderer. Pure
//! state; the manager applies the transitions.

use std::time::{Duration, Instant};

use super::hit_test::PollRate;

/// Idle time before the low target is requested.
pub const MEMORY_LOW_AFTER: Duration = Duration::from_secs(30);

/// Memory target of the app's webviews.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryTarget {
    Normal,
    Low,
}

/// Reasons to keep the webviews at the normal target regardless of the cursor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Hold {
    /// The strip keeps animating on its own (playing waveform, running timer, wide burst).
    StripContent,
    /// The settings window has focus.
    SettingsFocused,
}

/// Decides target transitions from the cursor poll's rate and the holds.
#[derive(Debug)]
pub struct MemoryTargetPolicy {
    current: MemoryTarget,
    idle_since: Option<Instant>,
    holds: Vec<Hold>,
}

impl Default for MemoryTargetPolicy {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryTargetPolicy {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            current: MemoryTarget::Normal,
            idle_since: None,
            holds: Vec::new(),
        }
    }

    #[must_use]
    pub const fn current(&self) -> MemoryTarget {
        self.current
    }

    /// Feeds one cursor poll result; returns the target to apply when it changes.
    pub fn observe(&mut self, rate: PollRate, now: Instant) -> Option<MemoryTarget> {
        if rate == PollRate::Active || !self.holds.is_empty() {
            return self.wake();
        }
        let since = *self.idle_since.get_or_insert(now);
        if now.duration_since(since) >= MEMORY_LOW_AFTER {
            self.switch(MemoryTarget::Low)
        } else {
            None
        }
    }

    /// Adds or removes a hold. Adding one restores the normal target at once; removing the
    /// last one restarts the idle clock at the next poll.
    pub fn set_hold(&mut self, hold: Hold, active: bool) -> Option<MemoryTarget> {
        if active {
            if !self.holds.contains(&hold) {
                self.holds.push(hold);
            }
            self.wake()
        } else {
            self.holds.retain(|h| *h != hold);
            None
        }
    }

    /// Something is about to animate (strip change, hotkey): back to normal and the idle clock
    /// restarts.
    pub fn wake(&mut self) -> Option<MemoryTarget> {
        self.idle_since = None;
        self.switch(MemoryTarget::Normal)
    }

    fn switch(&mut self, target: MemoryTarget) -> Option<MemoryTarget> {
        if self.current == target {
            return None;
        }
        self.current = target;
        Some(target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_keep_the_normal_target_and_restart_the_clock_when_released() {
        let start = Instant::now();
        let mut policy = MemoryTargetPolicy::new();
        assert_eq!(policy.set_hold(Hold::StripContent, true), None);
        assert_eq!(policy.observe(PollRate::Idle, start), None);
        assert_eq!(
            policy.observe(PollRate::Idle, start + MEMORY_LOW_AFTER * 2),
            None
        );
        assert_eq!(policy.set_hold(Hold::StripContent, false), None);
        // The clock only starts once the hold is gone.
        let released = start + MEMORY_LOW_AFTER * 2 + Duration::from_secs(1);
        assert_eq!(policy.observe(PollRate::Idle, released), None);
        assert_eq!(
            policy.observe(PollRate::Idle, released + Duration::from_secs(29)),
            None
        );
        assert_eq!(
            policy.observe(PollRate::Idle, released + MEMORY_LOW_AFTER),
            Some(MemoryTarget::Low)
        );
        // A hold arriving while low lifts it immediately; a second hold changes nothing.
        assert_eq!(
            policy.set_hold(Hold::SettingsFocused, true),
            Some(MemoryTarget::Normal)
        );
        assert_eq!(policy.set_hold(Hold::StripContent, true), None);
        assert_eq!(policy.set_hold(Hold::SettingsFocused, false), None);
        assert_eq!(
            policy.observe(PollRate::Idle, released + MEMORY_LOW_AFTER * 3),
            None,
            "the strip hold is still active"
        );
    }

    #[test]
    fn low_after_the_idle_period_and_only_once() {
        let start = Instant::now();
        let mut policy = MemoryTargetPolicy::new();
        assert_eq!(policy.observe(PollRate::Idle, start), None);
        assert_eq!(
            policy.observe(PollRate::Idle, start + Duration::from_millis(29_999)),
            None
        );
        assert_eq!(
            policy.observe(PollRate::Idle, start + MEMORY_LOW_AFTER),
            Some(MemoryTarget::Low)
        );
        assert_eq!(
            policy.observe(PollRate::Idle, start + MEMORY_LOW_AFTER * 2),
            None
        );
        assert_eq!(policy.current(), MemoryTarget::Low);
    }

    #[test]
    fn active_restores_normal_immediately_and_restarts_the_clock() {
        let start = Instant::now();
        let mut policy = MemoryTargetPolicy::new();
        policy.observe(PollRate::Idle, start);
        policy.observe(PollRate::Idle, start + MEMORY_LOW_AFTER);
        assert_eq!(
            policy.observe(
                PollRate::Active,
                start + MEMORY_LOW_AFTER + Duration::from_secs(1)
            ),
            Some(MemoryTarget::Normal)
        );
        assert_eq!(
            policy.observe(PollRate::Active, start + MEMORY_LOW_AFTER * 2),
            None
        );
        // Idle again: the full period must elapse once more.
        let again = start + MEMORY_LOW_AFTER * 3;
        assert_eq!(policy.observe(PollRate::Idle, again), None);
        assert_eq!(
            policy.observe(PollRate::Idle, again + Duration::from_secs(29)),
            None
        );
        assert_eq!(
            policy.observe(PollRate::Idle, again + MEMORY_LOW_AFTER),
            Some(MemoryTarget::Low)
        );
    }

    #[test]
    fn normal_is_never_requested_while_already_normal() {
        let start = Instant::now();
        let mut policy = MemoryTargetPolicy::new();
        assert_eq!(policy.observe(PollRate::Active, start), None);
        assert_eq!(policy.wake(), None);
        policy.observe(PollRate::Idle, start);
        policy.observe(PollRate::Idle, start + MEMORY_LOW_AFTER);
        assert_eq!(policy.wake(), Some(MemoryTarget::Normal));
        assert_eq!(policy.wake(), None);
    }
}
