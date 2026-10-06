//! The location test, kept out of the lib's unit-test binary on purpose (#89).
//!
//! Where Windows has not been told yet whether apps may use location — every fresh CI runner —
//! asking for a fix shows `PickerHost`'s "Let Windows and apps access your location?". Nobody
//! answers it, and it stays up well after this test returns, dimming the desktop
//! (`Shell_SystemDim`) and taking every click. Cargo runs a package's lib unit tests before
//! its integration tests, so the tests there that inject input (`windows::pump` S3) have
//! finished before this one can raise the prompt, and no test binary that runs later injects
//! input. Keep tests that can raise a system prompt here, and tests that inject input out.

#![cfg(windows)]

use muna_platform::windows::WindowsPlatform;
use muna_platform::{Location, PlatformError};

/// Talks to the real OS; only meaningful on the nightly lab machine. Bounded by the
/// implementation's own deadlines however the broker behaves, so a machine with no usable
/// source still finishes. Expect a full minute where the prompt is shown, since nobody answers
/// it; where location is already decided, the answer comes in about 10 ms.
#[test]
#[cfg_attr(
    not(feature = "platform-tests"),
    ignore = "requires a real Windows session"
)]
fn position_answers_or_says_why_not() {
    match WindowsPlatform::new().position() {
        Ok(fix) => {
            assert!((-90.0..=90.0).contains(&fix.latitude));
            assert!((-180.0..=180.0).contains(&fix.longitude));
        }
        Err(
            PlatformError::AccessDenied(_)
            | PlatformError::Unsupported(_)
            | PlatformError::Os { .. },
        ) => {}
        Err(other) => panic!("unexpected error: {other}"),
    }
}
