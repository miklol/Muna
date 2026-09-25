//! Injectable time source so scheduler tests are deterministic.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime};

pub trait Clock: Send + Sync {
    fn now(&self) -> Instant;

    /// Wall-clock time beside the monotonic reading. The two drift apart only when the
    /// machine slept (the monotonic clock may pause) or the wall clock was set; a timer that
    /// must survive sleep compares them (docs/modules/pomodoro.md).
    fn system_time(&self) -> SystemTime {
        SystemTime::now()
    }
}

/// Real monotonic clock.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

/// Manually advanced clock for tests. [`FakeClock::advance`] moves both readings;
/// [`FakeClock::sleep`] moves only the wall clock, like a machine whose monotonic clock paused.
#[derive(Debug)]
pub struct FakeClock {
    origin: Instant,
    wall_origin: SystemTime,
    elapsed_ms: AtomicU64,
    slept_ms: AtomicU64,
}

impl Default for FakeClock {
    fn default() -> Self {
        Self::new()
    }
}

impl FakeClock {
    #[must_use]
    pub fn new() -> Self {
        Self {
            origin: Instant::now(),
            wall_origin: SystemTime::now(),
            elapsed_ms: AtomicU64::new(0),
            slept_ms: AtomicU64::new(0),
        }
    }

    pub fn advance(&self, by: Duration) {
        let ms = u64::try_from(by.as_millis()).unwrap_or(u64::MAX);
        self.elapsed_ms.fetch_add(ms, Ordering::SeqCst);
    }

    /// Simulates a sleep: wall time passes, the monotonic reading stands still.
    pub fn sleep(&self, by: Duration) {
        let ms = u64::try_from(by.as_millis()).unwrap_or(u64::MAX);
        self.slept_ms.fetch_add(ms, Ordering::SeqCst);
    }
}

impl Clock for FakeClock {
    fn now(&self) -> Instant {
        self.origin + Duration::from_millis(self.elapsed_ms.load(Ordering::SeqCst))
    }

    fn system_time(&self) -> SystemTime {
        self.wall_origin
            + Duration::from_millis(
                self.elapsed_ms.load(Ordering::SeqCst) + self.slept_ms.load(Ordering::SeqCst),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fake_clock_only_moves_when_advanced() {
        let clock = FakeClock::new();
        let start = clock.now();
        assert_eq!(clock.now(), start);
        clock.advance(Duration::from_millis(1500));
        assert_eq!(clock.now() - start, Duration::from_millis(1500));
    }

    #[test]
    fn fake_sleep_moves_only_the_wall_clock() {
        let clock = FakeClock::new();
        let (start, wall_start) = (clock.now(), clock.system_time());
        clock.advance(Duration::from_secs(1));
        clock.sleep(Duration::from_secs(600));
        assert_eq!(clock.now() - start, Duration::from_secs(1));
        assert_eq!(
            clock.system_time().duration_since(wall_start).unwrap(),
            Duration::from_secs(601)
        );
    }
}
