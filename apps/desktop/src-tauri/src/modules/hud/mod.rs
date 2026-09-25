//! The `hud` module backend (docs/modules/hud.md): volume, microphone and brightness levels
//! from the platform, one strip notice per change, the controls the HUD slider and the strip
//! wheel need, and the switch that hides the Windows flyout.
//!
//! [`HudService`] is the shared object: the backend feeds it platform events, the IPC commands
//! query and drive it, and it tells a [`HudSink`] (the Tauri event bridge in production, a
//! recorder in tests) whenever its state changed. Everything that reasons about levels is
//! synchronous and free of Tauri so `tests/hud.rs` can drive it with the fake platform; the
//! backend only adds the event loop.

pub mod settings;
pub mod tracker;

use std::sync::Arc;
use std::time::Duration;

use muna_core::{Hub, Notice, Settings};
use muna_platform::{OsdState, Platform, PlatformError, PlatformEvent};
use parking_lot::Mutex;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use settings::{HudSettings, ScrollOnStrip};
pub use tracker::{
    BRIGHTNESS_NOTICE_ID, HUD_HOLD_MS, HudState, HudTracker, MIC_NOTICE_ID, VOLUME_NOTICE_ID,
    VolumeLevel, volume_glyph,
};

pub const ID: &str = "hud";

/// Volume step for one wheel notch or arrow key (Windows' own step is 2).
pub const VOLUME_STEP: i8 = 2;

/// How long after a monitor hot-plug the brightness list is re-read: the platform's own probe
/// runs on the same event and needs a moment (docs/modules/hud.md, implementation notes).
const HOTPLUG_SETTLE: Duration = Duration::from_millis(1500);

/// Where the module reports changes; the shell bridges it to a Tauri event.
pub trait HudSink: Send + Sync {
    fn state_changed(&self, state: &HudState);
}

pub struct HudService {
    platform: Arc<dyn Platform>,
    hub: Arc<Hub>,
    tracker: Mutex<HudTracker>,
    /// The last suppression the settings asked for, so unchanged settings cost nothing.
    suppression: Mutex<Option<bool>>,
    sink: Mutex<Option<Arc<dyn HudSink>>>,
}

impl std::fmt::Debug for HudService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HudService")
            .field("platform", &self.platform.name())
            .finish_non_exhaustive()
    }
}

impl HudService {
    #[must_use]
    pub fn new(platform: Arc<dyn Platform>, hub: Arc<Hub>) -> Self {
        Self {
            platform,
            hub,
            tracker: Mutex::new(HudTracker::default()),
            suppression: Mutex::new(None),
            sink: Mutex::new(None),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn HudSink>) {
        *self.sink.lock() = Some(sink);
    }

    #[must_use]
    pub fn state(&self) -> HudState {
        self.tracker.lock().state()
    }

    /// Reads every level from the platform (start-up, after lag). Seeds the state; publishes
    /// no notice.
    pub fn sync(&self) {
        let volume = match (
            self.platform.audio().volume(),
            self.platform.audio().muted(),
        ) {
            (Ok(percent), Ok(muted)) => Some((percent, muted)),
            (Err(PlatformError::Unsupported(_) | PlatformError::NotFound(_)), _)
            | (_, Err(PlatformError::Unsupported(_) | PlatformError::NotFound(_))) => None,
            (Err(error), _) | (_, Err(error)) => {
                tracing::warn!(%error, "volume unavailable");
                None
            }
        };
        let mic = match self.platform.audio().mic_muted() {
            Ok(mic) => mic,
            Err(PlatformError::Unsupported(_) | PlatformError::NotFound(_)) => None,
            Err(error) => {
                tracing::warn!(%error, "microphone state unavailable");
                None
            }
        };
        let monitors = self.read_monitors();
        let osd = self.platform.system_osd().state();
        let changed = {
            let mut tracker = self.tracker.lock();
            let mut changed = match volume {
                Some((percent, muted)) => {
                    let before = tracker.state().volume;
                    // Seeding or re-seeding never shows the HUD; a level that moved while the
                    // events lagged is simply the new baseline.
                    let _ = tracker.observe_volume(percent, muted);
                    before != tracker.state().volume
                }
                None => tracker.clear_volume(),
            };
            let before = tracker.state().mic_muted;
            let _ = tracker.observe_mic(mic);
            changed |= before != mic;
            changed |= tracker.set_monitors(monitors);
            changed |= tracker.set_osd(osd);
            changed
        };
        if changed {
            self.emit_state();
        }
    }

    /// Re-reads the brightness monitors (hot-plug, unknown monitor in an event).
    pub fn sync_brightness(&self) {
        let monitors = self.read_monitors();
        if self.tracker.lock().set_monitors(monitors) {
            self.emit_state();
        }
    }

    fn read_monitors(&self) -> Vec<muna_platform::BrightnessMonitor> {
        match self.platform.brightness().monitors() {
            Ok(monitors) => monitors,
            Err(PlatformError::Unsupported(_)) => Vec::new(),
            Err(error) => {
                tracing::warn!(%error, "brightness monitors unavailable");
                Vec::new()
            }
        }
    }

    /// A platform volume event: the HUD shows when the level moved.
    pub fn observe_volume(&self, percent: u8, muted: bool) {
        let notice = self.tracker.lock().observe_volume(percent, muted);
        self.publish(notice);
        self.emit_state();
    }

    /// A platform microphone event.
    pub fn observe_mic(&self, muted: bool) {
        let notice = self.tracker.lock().observe_mic(Some(muted));
        self.publish(notice);
        self.emit_state();
    }

    /// A platform brightness event. An unknown monitor means the list is stale: re-read it and
    /// treat the level as its baseline.
    pub fn observe_brightness(&self, monitor_id: &str, percent: u8) {
        let result = self.tracker.lock().observe_brightness(monitor_id, percent);
        match result {
            Ok(notice) => {
                self.publish(notice);
                self.emit_state();
            }
            Err(tracker::UnknownMonitor) => self.sync_brightness(),
        }
    }

    /// Sets the default render level; the HUD follows through the platform's event.
    pub fn set_volume(&self, percent: u8) -> Result<(), PlatformError> {
        self.platform.audio().set_volume(percent.min(100))
    }

    /// Moves the level by `delta` (wheel notches, arrow keys), clamped to 0–100, and unmutes
    /// when the user turns it up while muted (Windows and macOS both do).
    pub fn nudge_volume(&self, delta: i8) -> Result<(), PlatformError> {
        let Some(level) = self.state().volume else {
            return Err(PlatformError::NotFound("default render device".into()));
        };
        let target = level.percent.saturating_add_signed(delta).min(100);
        if level.muted && delta > 0 {
            self.platform.audio().set_muted(false)?;
        }
        if target != level.percent {
            self.platform.audio().set_volume(target)?;
        }
        Ok(())
    }

    pub fn set_muted(&self, muted: bool) -> Result<(), PlatformError> {
        self.platform.audio().set_muted(muted)
    }

    pub fn set_mic_muted(&self, muted: bool) -> Result<(), PlatformError> {
        self.platform.audio().set_mic_muted(muted)
    }

    /// Sets one monitor's brightness; the HUD follows through the platform's event.
    pub fn set_brightness(&self, monitor_id: &str, percent: u8) -> Result<(), PlatformError> {
        self.platform.brightness().set(monitor_id, percent.min(100))
    }

    /// Applies `settings.modules.hud` (start-up and every settings change): the flyout is
    /// hidden or restored to match *Replace system flyout*.
    pub fn apply_settings(&self, settings: &Settings) {
        let hud = HudSettings::from_document(settings);
        self.set_suppressed(hud.replace_system_flyout);
    }

    /// Releases the flyout on a clean exit. The watchdog covers every other exit.
    pub fn shutdown(&self) {
        if *self.suppression.lock() == Some(true) {
            self.set_suppressed(false);
        }
    }

    fn set_suppressed(&self, suppressed: bool) {
        {
            let mut last = self.suppression.lock();
            if *last == Some(suppressed) {
                return;
            }
            *last = Some(suppressed);
        }
        let osd = match self.platform.system_osd().set_suppressed(suppressed) {
            Ok(osd) => osd,
            Err(error) => {
                tracing::warn!(%error, suppressed, "system flyout could not be changed");
                self.platform.system_osd().state()
            }
        };
        tracing::info!(suppressed, ?osd, "system flyout");
        if self.tracker.lock().set_osd(osd) {
            self.emit_state();
        }
    }

    fn publish(&self, notice: Option<Notice>) {
        if let Some(notice) = notice {
            self.hub.publish_notice(notice);
        }
    }

    fn emit_state(&self) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.state_changed(&self.state());
        }
    }
}

/// `true` when the flyout is hidden right now (diagnostics, tests).
#[must_use]
pub fn is_suppressed(state: &HudState) -> bool {
    state.osd == OsdState::Suppressed
}

/// The backend: seeds the service from the platform and forwards level events to it.
#[derive(Debug, Clone)]
pub struct HudModule(pub Arc<HudService>);

impl ModuleBackend for HudModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Strip, Surface::Hud]
    }

    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()> {
        let service = Arc::clone(&self.0);
        let mut events = ctx.platform.subscribe();
        service.sync();
        tauri::async_runtime::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(PlatformEvent::VolumeChanged { percent, muted }) => {
                        service.observe_volume(percent, muted);
                    }
                    Ok(PlatformEvent::MicMuteChanged { muted }) => service.observe_mic(muted),
                    Ok(PlatformEvent::BrightnessChanged {
                        monitor_id,
                        percent,
                    }) => service.observe_brightness(&monitor_id, percent),
                    Ok(PlatformEvent::MonitorsChanged(_)) => {
                        let service = Arc::clone(&service);
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(HOTPLUG_SETTLE).await;
                            service.sync_brightness();
                        });
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "hud events lagged; resyncing");
                        service.sync();
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        Ok(())
    }
}
