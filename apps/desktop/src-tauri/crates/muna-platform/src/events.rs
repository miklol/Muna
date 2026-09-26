use crate::types::{
    BatteryState, BluetoothDevice, BluetoothRadioState, ForegroundWindow, MediaSession,
    MonitorInfo, WindowHandle,
};

/// Push notifications from the platform layer. Consumers subscribe through
/// [`crate::Platform::subscribe`]; the channel is `tokio::sync::broadcast`, so slow consumers
/// lose the oldest events rather than blocking the OS callback threads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlatformEvent {
    /// The set of SMTC sessions changed or the current session's properties changed.
    MediaSessionsChanged(Vec<MediaSession>),
    /// Default render device volume (0–100) or mute changed.
    VolumeChanged { percent: u8, muted: bool },
    /// The default capture device was muted or unmuted (docs/modules/hud.md, mic glyph).
    MicMuteChanged { muted: bool },
    /// A display's brightness changed, by Muna or by the OS (brightness keys on a laptop
    /// arrive as `WmiMonitorBrightnessEvent`).
    BrightnessChanged { monitor_id: String, percent: u8 },
    /// A Bluetooth device connected, disconnected or reported a new battery level.
    BluetoothChanged(BluetoothDevice),
    /// The Bluetooth radio was turned on or off, by Muna or by the OS (docs/modules/bluetooth.md).
    BluetoothRadioChanged(BluetoothRadioState),
    /// Battery level or power source changed.
    BatteryChanged(BatteryState),
    /// The foreground window changed (`EVENT_SYSTEM_FOREGROUND`).
    ForegroundChanged(ForegroundWindow),
    /// A window started (`EVENT_SYSTEM_MOVESIZESTART`) or finished (`EVENT_SYSTEM_MOVESIZEEND`)
    /// being moved or resized by the user; the notch peeks meanwhile, or shows the snap zones
    /// for `window` when the Window snap module wants the drag (docs/modules/window-snap.md).
    MoveSizeChanged {
        started: bool,
        /// The window being moved; `0` when the OS reported none.
        window: WindowHandle,
    },
    /// Monitor topology or DPI changed (`WM_DISPLAYCHANGE`, `WM_DPICHANGED`).
    MonitorsChanged(Vec<MonitorInfo>),
    /// The session was locked or unlocked (`WTS_SESSION_LOCK` / `WTS_SESSION_UNLOCK`).
    SessionLockChanged { locked: bool },
    /// The Action Center changed: a toast arrived, was dismissed or expired
    /// (`UserNotificationListener.NotificationChanged`; only with package identity, ADR-0003).
    /// Carries nothing: the module asks for the list, so content never crosses this channel.
    NotificationsChanged,
    /// A Windows focus session started or ended (`FocusSessionManager.IsFocusActiveChanged`,
    /// Windows 11 22H2+).
    FocusChanged { active: bool },
}
