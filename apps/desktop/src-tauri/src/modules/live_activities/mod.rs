//! The `live-activities` module backend (docs/modules/live-activities.md).
//!
//! Owns the built-in notices — battery, power source, Bluetooth, session lock — by reducing
//! platform events into [`muna_core::Notice`]s and publishing them on the hub. Each reducer is
//! a pure struct with no Tauri or platform dependency so the integration tests in
//! `tests/live_activities.rs` can drive it with the fake platform and a fake clock.

pub mod bluetooth;
pub mod power;
pub mod session;

use muna_core::{Hub, Notice};
use muna_platform::{Platform, PlatformEvent};

use super::{ModuleBackend, ModuleCtx, Surface};

pub const ID: &str = "live-activities";

/// Reduces platform events to notices. Seeded from the platform's current state so nothing
/// already true at start-up is announced.
#[derive(Debug)]
pub struct Sources {
    power: power::PowerSource,
    bluetooth: bluetooth::BluetoothSource,
}

impl Sources {
    #[must_use]
    pub fn seeded(platform: &dyn Platform) -> Self {
        let battery = platform.power().battery().ok();
        let devices = platform.bluetooth().devices().unwrap_or_default();
        Self {
            power: power::PowerSource::new(battery),
            bluetooth: bluetooth::BluetoothSource::new(devices),
        }
    }

    /// The notices one platform event warrants, in publish order.
    pub fn reduce(&mut self, event: &PlatformEvent) -> Vec<Notice> {
        match event {
            PlatformEvent::BatteryChanged(state) => self.power.observe(*state),
            PlatformEvent::BluetoothChanged(device) => {
                self.bluetooth.observe(device).into_iter().collect()
            }
            PlatformEvent::SessionLockChanged { locked } => vec![session::notice_for(*locked)],
            _ => Vec::new(),
        }
    }

    /// Reduces `event` and publishes the result.
    pub fn apply(&mut self, event: &PlatformEvent, hub: &Hub) -> usize {
        let notices = self.reduce(event);
        let count = notices.len();
        for notice in notices {
            hub.publish_notice(notice);
        }
        count
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct LiveActivities;

impl ModuleBackend for LiveActivities {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Strip]
    }

    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()> {
        let mut sources = Sources::seeded(ctx.platform.as_ref());
        let mut events = ctx.platform.subscribe();
        tauri::async_runtime::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(event) => {
                        sources.apply(&event, &ctx.activities);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "live-activities events lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        Ok(())
    }
}
