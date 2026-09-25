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
pub use traits::{
    AppBar, Audio, Autostart, Bluetooth, Brightness, Foreground, Media, Monitors, Platform, Power,
    SystemOsd, Windowing,
};
pub use types::{
    AudioDevice, AutostartMechanism, BatteryState, BluetoothDevice, BrightnessKind,
    BrightnessMonitor, ForegroundWindow, MediaCommand, MediaControls, MediaSession, MonitorInfo,
    OsdState, PlaybackStatus, PowerSource, Rect, RepeatMode, Thumbnail, UserNotificationState,
    WindowHandle,
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

/// Command-line switch the app passes to its own executable to run as the system-OSD
/// watchdog (`muna.exe --watchdog <pid>`, docs/modules/hud.md "Crash safety").
pub const OSD_WATCHDOG_ARG: &str = "--watchdog";

/// Runs the system-OSD watchdog: blocks until `parent_pid` exits, undoes any flyout
/// suppression and returns the process exit code. A no-op that returns `0` off Windows.
#[must_use]
pub fn run_osd_watchdog(parent_pid: u32) -> i32 {
    #[cfg(windows)]
    {
        windows::undocumented::flyout::run_watchdog(parent_pid)
    }
    #[cfg(not(windows))]
    {
        let _ = parent_pid;
        0
    }
}
