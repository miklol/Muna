use crate::types::{BatteryState, BluetoothDevice, ForegroundWindow, MediaSession, MonitorInfo};

/// Push notifications from the platform layer. Consumers subscribe through
/// [`crate::Platform::subscribe`]; the channel is `tokio::sync::broadcast`, so slow consumers
/// lose the oldest events rather than blocking the OS callback threads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlatformEvent {
    /// The set of SMTC sessions changed or the current session's properties changed.
    MediaSessionsChanged(Vec<MediaSession>),
    /// Default render device volume (0–100) or mute changed.
    VolumeChanged { percent: u8, muted: bool },
    /// A Bluetooth device connected, disconnected or reported a new battery level.
    BluetoothChanged(BluetoothDevice),
    /// Battery level or power source changed.
    BatteryChanged(BatteryState),
    /// The foreground window changed (`EVENT_SYSTEM_FOREGROUND`).
    ForegroundChanged(ForegroundWindow),
    /// A window started (`EVENT_SYSTEM_MOVESIZESTART`) or finished (`EVENT_SYSTEM_MOVESIZEEND`)
    /// being moved or resized by the user; the notch peeks meanwhile.
    MoveSizeChanged { started: bool },
    /// Monitor topology or DPI changed (`WM_DISPLAYCHANGE`, `WM_DPICHANGED`).
    MonitorsChanged(Vec<MonitorInfo>),
    /// The session was locked or unlocked (`WTS_SESSION_LOCK` / `WTS_SESSION_UNLOCK`).
    SessionLockChanged { locked: bool },
}
