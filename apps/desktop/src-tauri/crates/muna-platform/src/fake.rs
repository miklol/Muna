//! A scripted, deterministic platform used by every unit and integration test (docs/09).
//!
//! Tests drive it through the `push_*` / `set_*` methods; each call updates the snapshot the
//! traits return **and** publishes the matching [`PlatformEvent`], exactly as the real
//! implementation would. Commands sent to the fake are recorded so tests can assert on them.

use parking_lot::Mutex;
use tokio::sync::broadcast;

use crate::error::{PlatformError, PlatformResult};
use crate::events::PlatformEvent;
use crate::traits::{Audio, Bluetooth, Foreground, Media, Monitors, Platform, Power};
use crate::types::{
    AudioDevice, BatteryState, BluetoothDevice, ForegroundWindow, MediaCommand, MediaSession,
    MonitorInfo, PowerSource, Rect,
};

const EVENT_CAPACITY: usize = 256;

#[derive(Debug)]
struct State {
    sessions: Vec<MediaSession>,
    audio_devices: Vec<AudioDevice>,
    volume: u8,
    muted: bool,
    bluetooth: Vec<BluetoothDevice>,
    battery: BatteryState,
    monitors: Vec<MonitorInfo>,
    foreground: Option<ForegroundWindow>,
    sent_media_commands: Vec<(String, MediaCommand)>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            sessions: Vec::new(),
            audio_devices: vec![AudioDevice {
                id: "fake-speakers".into(),
                name: "Speakers (fake)".into(),
                is_default: true,
            }],
            volume: 50,
            muted: false,
            bluetooth: Vec::new(),
            battery: BatteryState {
                percent: None,
                source: PowerSource::Ac,
                charging: false,
            },
            monitors: vec![MonitorInfo {
                id: r"\\.\DISPLAY1".into(),
                bounds: Rect::new(0, 0, 2560, 1440),
                work_area: Rect::new(0, 0, 2560, 1392),
                dpi: 96,
                is_primary: true,
            }],
            foreground: None,
            sent_media_commands: Vec::new(),
        }
    }
}

/// Scripted platform. Cheap to clone-by-`Arc`; all methods take `&self`.
#[derive(Debug)]
pub struct FakePlatform {
    state: Mutex<State>,
    events: broadcast::Sender<PlatformEvent>,
}

impl Default for FakePlatform {
    fn default() -> Self {
        Self::new()
    }
}

impl FakePlatform {
    #[must_use]
    pub fn new() -> Self {
        let (events, _) = broadcast::channel(EVENT_CAPACITY);
        Self {
            state: Mutex::new(State::default()),
            events,
        }
    }

    fn publish(&self, event: PlatformEvent) {
        // No subscribers is fine: the app may not have mounted a listener yet.
        let _ = self.events.send(event);
    }

    // --- scripting API -----------------------------------------------------------------

    /// Replaces the media session list and notifies subscribers.
    pub fn set_media_sessions(&self, sessions: Vec<MediaSession>) {
        self.state.lock().sessions.clone_from(&sessions);
        self.publish(PlatformEvent::MediaSessionsChanged(sessions));
    }

    /// Adds (or replaces, by `source_app_id`) one media session and notifies subscribers.
    pub fn push_media_session(&self, session: MediaSession) {
        let sessions = {
            let mut state = self.state.lock();
            state
                .sessions
                .retain(|s| s.source_app_id != session.source_app_id);
            state.sessions.push(session);
            state.sessions.clone()
        };
        self.publish(PlatformEvent::MediaSessionsChanged(sessions));
    }

    pub fn set_volume_state(&self, percent: u8, muted: bool) {
        let percent = percent.min(100);
        {
            let mut state = self.state.lock();
            state.volume = percent;
            state.muted = muted;
        }
        self.publish(PlatformEvent::VolumeChanged { percent, muted });
    }

    pub fn set_bluetooth_device(&self, device: BluetoothDevice) {
        {
            let mut state = self.state.lock();
            state.bluetooth.retain(|d| d.id != device.id);
            state.bluetooth.push(device.clone());
        }
        self.publish(PlatformEvent::BluetoothChanged(device));
    }

    pub fn set_battery(&self, battery: BatteryState) {
        self.state.lock().battery = battery;
        self.publish(PlatformEvent::BatteryChanged(battery));
    }

    pub fn set_monitors(&self, monitors: Vec<MonitorInfo>) {
        self.state.lock().monitors.clone_from(&monitors);
        self.publish(PlatformEvent::MonitorsChanged(monitors));
    }

    pub fn foreground_changed(&self, window: ForegroundWindow) {
        self.state.lock().foreground = Some(window.clone());
        self.publish(PlatformEvent::ForegroundChanged(window));
    }

    pub fn set_session_locked(&self, locked: bool) {
        self.publish(PlatformEvent::SessionLockChanged { locked });
    }

    /// Media commands received so far, in order.
    #[must_use]
    pub fn sent_media_commands(&self) -> Vec<(String, MediaCommand)> {
        self.state.lock().sent_media_commands.clone()
    }
}

impl Media for FakePlatform {
    fn sessions(&self) -> PlatformResult<Vec<MediaSession>> {
        Ok(self.state.lock().sessions.clone())
    }

    fn send(&self, source_app_id: &str, command: MediaCommand) -> PlatformResult<()> {
        let mut state = self.state.lock();
        if !state
            .sessions
            .iter()
            .any(|s| s.source_app_id == source_app_id)
        {
            return Err(PlatformError::NotFound(format!(
                "media session {source_app_id}"
            )));
        }
        state
            .sent_media_commands
            .push((source_app_id.to_owned(), command));
        Ok(())
    }
}

impl Audio for FakePlatform {
    fn devices(&self) -> PlatformResult<Vec<AudioDevice>> {
        Ok(self.state.lock().audio_devices.clone())
    }

    fn volume(&self) -> PlatformResult<u8> {
        Ok(self.state.lock().volume)
    }

    fn set_volume(&self, percent: u8) -> PlatformResult<()> {
        let muted = self.state.lock().muted;
        self.set_volume_state(percent, muted);
        Ok(())
    }

    fn set_default_device(&self, id: &str) -> PlatformResult<()> {
        let mut state = self.state.lock();
        if !state.audio_devices.iter().any(|d| d.id == id) {
            return Err(PlatformError::NotFound(format!("audio device {id}")));
        }
        for device in &mut state.audio_devices {
            device.is_default = device.id == id;
        }
        Ok(())
    }
}

impl Bluetooth for FakePlatform {
    fn devices(&self) -> PlatformResult<Vec<BluetoothDevice>> {
        Ok(self.state.lock().bluetooth.clone())
    }

    fn connect(&self, id: &str) -> PlatformResult<()> {
        self.toggle_bluetooth(id, true)
    }

    fn disconnect(&self, id: &str) -> PlatformResult<()> {
        self.toggle_bluetooth(id, false)
    }
}

impl FakePlatform {
    fn toggle_bluetooth(&self, id: &str, connected: bool) -> PlatformResult<()> {
        let device = {
            let mut state = self.state.lock();
            let device = state
                .bluetooth
                .iter_mut()
                .find(|d| d.id == id)
                .ok_or_else(|| PlatformError::NotFound(format!("bluetooth device {id}")))?;
            device.connected = connected;
            device.clone()
        };
        self.publish(PlatformEvent::BluetoothChanged(device));
        Ok(())
    }
}

impl Power for FakePlatform {
    fn battery(&self) -> PlatformResult<BatteryState> {
        Ok(self.state.lock().battery)
    }
}

impl Monitors for FakePlatform {
    fn all(&self) -> PlatformResult<Vec<MonitorInfo>> {
        Ok(self.state.lock().monitors.clone())
    }
}

impl Foreground for FakePlatform {
    fn current(&self) -> PlatformResult<Option<ForegroundWindow>> {
        Ok(self.state.lock().foreground.clone())
    }
}

impl Platform for FakePlatform {
    fn media(&self) -> &dyn Media {
        self
    }

    fn audio(&self) -> &dyn Audio {
        self
    }

    fn bluetooth(&self) -> &dyn Bluetooth {
        self
    }

    fn power(&self) -> &dyn Power {
        self
    }

    fn monitors(&self) -> &dyn Monitors {
        self
    }

    fn foreground(&self) -> &dyn Foreground {
        self
    }

    fn subscribe(&self) -> broadcast::Receiver<PlatformEvent> {
        self.events.subscribe()
    }

    fn name(&self) -> &'static str {
        "fake"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::PlaybackStatus;

    fn session(app: &str, title: &str) -> MediaSession {
        MediaSession {
            source_app_id: app.into(),
            title: title.into(),
            artist: "Artist".into(),
            album: None,
            status: PlaybackStatus::Playing,
            position_ms: Some(0),
            duration_ms: Some(180_000),
        }
    }

    #[test]
    fn pushing_a_session_updates_snapshot_and_publishes_event() {
        let fake = FakePlatform::new();
        let mut rx = fake.subscribe();

        fake.push_media_session(session("Spotify.exe", "Song"));

        assert_eq!(fake.media().sessions().unwrap().len(), 1);
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::MediaSessionsChanged(vec![session("Spotify.exe", "Song")])
        );
    }

    #[test]
    fn pushing_same_source_replaces_instead_of_duplicating() {
        let fake = FakePlatform::new();
        fake.push_media_session(session("Spotify.exe", "One"));
        fake.push_media_session(session("Spotify.exe", "Two"));

        let sessions = fake.media().sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].title, "Two");
    }

    #[test]
    fn media_commands_are_recorded_for_known_sessions_only() {
        let fake = FakePlatform::new();
        assert_eq!(
            fake.media().send("Nope.exe", MediaCommand::Play),
            Err(PlatformError::NotFound("media session Nope.exe".into()))
        );

        fake.push_media_session(session("Spotify.exe", "Song"));
        fake.media()
            .send("Spotify.exe", MediaCommand::TogglePlayPause)
            .unwrap();
        assert_eq!(
            fake.sent_media_commands(),
            vec![("Spotify.exe".to_owned(), MediaCommand::TogglePlayPause)]
        );
    }

    #[test]
    fn volume_is_clamped_and_published() {
        let fake = FakePlatform::new();
        let mut rx = fake.subscribe();
        fake.audio().set_volume(250).unwrap();
        assert_eq!(fake.audio().volume().unwrap(), 100);
        assert_eq!(
            rx.try_recv().unwrap(),
            PlatformEvent::VolumeChanged {
                percent: 100,
                muted: false
            }
        );
    }

    #[test]
    fn battery_and_foreground_scripts_round_trip() {
        let fake = FakePlatform::new();
        let battery = BatteryState {
            percent: Some(42),
            source: PowerSource::Battery,
            charging: false,
        };
        fake.set_battery(battery);
        assert_eq!(fake.power().battery().unwrap(), battery);

        let window = ForegroundWindow {
            title: "Game".into(),
            process_name: "game.exe".into(),
            bounds: Rect::new(0, 0, 2560, 1440),
            is_fullscreen: true,
        };
        fake.foreground_changed(window.clone());
        assert_eq!(fake.foreground().current().unwrap(), Some(window));
    }

    #[test]
    fn events_before_subscribe_are_not_replayed() {
        let fake = FakePlatform::new();
        fake.set_session_locked(true);
        let mut rx = fake.subscribe();
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn default_platform_is_available_everywhere() {
        let platform = crate::default_platform();
        let expected = if cfg!(windows) { "windows" } else { "fake" };
        assert_eq!(platform.name(), expected);
        // Every service is reachable even where it is not implemented yet.
        let _ = platform.monitors().all();
    }
}
