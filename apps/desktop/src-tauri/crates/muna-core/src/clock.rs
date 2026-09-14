//! Injectable time source so scheduler tests are deterministic.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

pub trait Clock: Send + Sync {
    fn now(&self) -> Instant;
}

/// Real monotonic clock.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

/// Manually advanced clock for tests.
#[derive(Debug)]
pub struct FakeClock {
    origin: Instant,
    elapsed_ms: AtomicU64,
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
            elapsed_ms: AtomicU64::new(0),
        }
    }

    pub fn advance(&self, by: Duration) {
        let ms = u64::try_from(by.as_millis()).unwrap_or(u64::MAX);
        self.elapsed_ms.fetch_add(ms, Ordering::SeqCst);
    }
}

impl Clock for FakeClock {
    fn now(&self) -> Instant {
        self.origin + Duration::from_millis(self.elapsed_ms.load(Ordering::SeqCst))
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
}
