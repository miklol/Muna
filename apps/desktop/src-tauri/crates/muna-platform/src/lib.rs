//! Platform services for Muna.
//!
//! Every Windows API the app touches sits behind a trait in [`traits`]; the app and every
//! module backend only ever see `Arc<dyn Platform>`. Tests use [`fake::FakePlatform`], which
//! implements every trait with scripted events. The real implementation lives in
//! [`windows`] and is compiled only on Windows (see ADR-0001, docs/04-windows-platform-apis.md).
//!
//! Rules (`.github/copilot-instructions.md`): `unsafe` only inside this crate's `windows`
//! module with a `// SAFETY:` comment, and every Win32 call checks its result.

pub mod error;
pub mod events;
pub mod fake;
pub mod traits;
pub mod types;

#[cfg(windows)]
pub mod windows;

pub use error::{PlatformError, PlatformResult};
pub use events::PlatformEvent;
pub use fake::{FakePlatform, WindowingCall};
pub use traits::{Audio, Bluetooth, Foreground, Media, Monitors, Platform, Power, Windowing};
pub use types::{
    AudioDevice, BatteryState, BluetoothDevice, ForegroundWindow, MediaCommand, MediaSession,
    MonitorInfo, PlaybackStatus, PowerSource, Rect, UserNotificationState, WindowHandle,
};

/// Constructs the platform implementation for the current build.
///
/// On Windows this is the real implementation; elsewhere (CI runners, docs builds) it is the
/// fake, so the crate always compiles and the app can still start headless.
#[must_use]
pub fn default_platform() -> std::sync::Arc<dyn Platform> {
    #[cfg(windows)]
    {
        std::sync::Arc::new(windows::WindowsPlatform::new())
    }
    #[cfg(not(windows))]
    {
        std::sync::Arc::new(FakePlatform::new())
    }
}
