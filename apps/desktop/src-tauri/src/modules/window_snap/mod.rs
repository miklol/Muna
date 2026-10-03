//! Window snap module (docs/modules/window-snap.md): while another application's window is
//! dragged near the notch, the strip offers layout tiles; releasing over one places the
//! window there, frame-exact, on the monitor the notch belongs to.
//!
//! Division of labour: the shell owns the drag (platform `MoveSizeChanged` → a
//! [`SnapSessions`] entry, cursor samples → `SnapDrag*` events, no Peek while it lasts); the UI
//! owns the tiles and their hit test; this module owns the zones — which are offered, where
//! each one is on a monitor — and the placement through [`muna_platform::WindowPlacement`].
//! The UI names a session and a zone, never a window handle.
//!
//! Tauri-free so it runs under `cargo test` against `FakePlatform`; the backend registers the
//! *Snap* surface and nothing else.

pub mod settings;
pub mod zones;

use std::sync::Arc;
use std::time::Duration;

use muna_core::{Settings, SnapSessionId, SnapSessions};
use muna_platform::{MonitorInfo, Platform, PlatformError, Rect};
use parking_lot::Mutex;
pub use settings::{MAX_ZONES, SnapGrid, WindowSnapSettings};
pub use zones::{Placement, SnapZone, SnapZoneRef, cell_frame, zone_placement};

use super::{ModuleBackend, ModuleCtx, Surface};

/// Module id and settings namespace.
pub const ID: &str = "window-snap";
/// How long after a placement the frame is re-read and, if off, placed once more: Aero Snap
/// may maximise the window as the drag ends, and a per-monitor-DPI window resizes itself when
/// it crosses to a monitor with another scale (docs/build-plan/m4-power-tools.md "Risks").
pub const VERIFY_DELAY: Duration = Duration::from_millis(120);
/// Frame edges this far from the target count as placed (sub-pixel DWM rounding).
pub const VERIFY_TOLERANCE: i32 = 2;

#[derive(Debug, thiserror::Error)]
pub enum SnapError {
    #[error("no window drag with this session")]
    UnknownSession,
    #[error("this zone is not offered")]
    ZoneNotOffered,
    #[error("no monitor for this notch window")]
    UnknownMonitor,
    #[error(transparent)]
    Platform(#[from] PlatformError),
}

pub struct WindowSnapService {
    platform: Arc<dyn Platform>,
    sessions: Arc<SnapSessions>,
    settings: Mutex<WindowSnapSettings>,
    verify_delay: Duration,
}

impl std::fmt::Debug for WindowSnapService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WindowSnapService")
            .field("settings", &*self.settings.lock())
            .field("enabled", &self.sessions.is_enabled())
            .finish_non_exhaustive()
    }
}

impl WindowSnapService {
    #[must_use]
    pub fn new(platform: Arc<dyn Platform>) -> Self {
        Self {
            platform,
            sessions: Arc::new(SnapSessions::new()),
            settings: Mutex::new(WindowSnapSettings::default()),
            verify_delay: VERIFY_DELAY,
        }
    }

    /// Tests: no wait before the verification pass.
    #[must_use]
    pub fn with_verify_delay(mut self, delay: Duration) -> Self {
        self.verify_delay = delay;
        self
    }

    /// The registry the shell writes its drags into.
    #[must_use]
    pub fn sessions(&self) -> Arc<SnapSessions> {
        Arc::clone(&self.sessions)
    }

    /// Reads the namespace from a settings document and turns the shell's drag tracking on or
    /// off with `shell.disabledModules`.
    pub fn apply_settings(&self, settings: &Settings) {
        let disabled = settings
            .shell
            .disabled_modules
            .iter()
            .any(|module| module == ID);
        self.sessions.set_enabled(!disabled);
        *self.settings.lock() = WindowSnapSettings::from_document(settings);
    }

    #[must_use]
    pub fn settings(&self) -> WindowSnapSettings {
        self.settings.lock().clone()
    }

    /// Places the session's window into `zone` on the monitor `monitor_id` (the one the
    /// hovered notch window belongs to) and forgets the session. The work area is re-read at
    /// this moment so a taskbar or `AppBar` change since the drag began is honoured. Sleeps
    /// for the verification pass, so callers use a blocking thread.
    pub fn apply(
        &self,
        session: SnapSessionId,
        monitor_id: &str,
        zone: SnapZoneRef,
    ) -> Result<(), SnapError> {
        let session = self
            .sessions
            .take(session)
            .ok_or(SnapError::UnknownSession)?;
        let monitors = self.platform.monitors().all()?;
        let monitor = monitors
            .iter()
            .find(|m| m.id == monitor_id)
            .or_else(|| monitors.iter().find(|m| m.is_primary))
            .ok_or(SnapError::UnknownMonitor)?;
        let placement = resolve(&self.settings(), zone, monitor)?;
        let windows = self.platform.window_placement();
        match placement {
            Placement::Maximize => windows.maximize(session.window, monitor.work_area)?,
            Placement::Frame(target) => {
                windows.place(session.window, target)?;
                if !self.verify_delay.is_zero() {
                    std::thread::sleep(self.verify_delay);
                }
                match windows.frame_bounds(session.window) {
                    Ok(frame) if !within(frame, target, VERIFY_TOLERANCE) => {
                        tracing::info!(
                            session = session.id,
                            "snap re-applied after the frame moved"
                        );
                        windows.place(session.window, target)?;
                    }
                    Ok(_) => {}
                    Err(error) => tracing::warn!(%error, "frame check after snap failed"),
                }
            }
        }
        tracing::info!(session = session.id, zone = ?zone, monitor = %monitor.id, "window snapped");
        Ok(())
    }

    /// The drag ended outside every zone (or the UI gave up): forgets the session. `false`
    /// when it was already gone.
    pub fn cancel(&self, session: SnapSessionId) -> bool {
        self.sessions.remove(session)
    }
}

/// The placement `zone` asks for on `monitor`, if the settings offer it.
fn resolve(
    settings: &WindowSnapSettings,
    zone: SnapZoneRef,
    monitor: &MonitorInfo,
) -> Result<Placement, SnapError> {
    match zone {
        SnapZoneRef::BuiltIn(zone) => {
            if !settings.zones.contains(&zone) {
                return Err(SnapError::ZoneNotOffered);
            }
            Ok(zone_placement(zone, monitor.work_area))
        }
        SnapZoneRef::Cell { row, col } => {
            let grid = settings.grid.ok_or(SnapError::ZoneNotOffered)?;
            cell_frame(grid, row, col, monitor.work_area, monitor.dpi)
                .map(Placement::Frame)
                .ok_or(SnapError::ZoneNotOffered)
        }
    }
}

/// Every edge of `frame` within `tolerance` px of `target`'s.
fn within(frame: Rect, target: Rect, tolerance: i32) -> bool {
    let close = |a: i32, b: i32| (i64::from(a) - i64::from(b)).abs() <= i64::from(tolerance);
    close(frame.x, target.x)
        && close(frame.y, target.y)
        && close(
            frame.x.saturating_add_unsigned(frame.width),
            target.x.saturating_add_unsigned(target.width),
        )
        && close(
            frame.y.saturating_add_unsigned(frame.height),
            target.y.saturating_add_unsigned(target.height),
        )
}

#[derive(Debug)]
pub struct WindowSnapModule(pub Arc<WindowSnapService>);

impl ModuleBackend for WindowSnapModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Snap]
    }

    fn start(&self, _ctx: ModuleCtx) -> anyhow::Result<()> {
        Ok(())
    }
}
