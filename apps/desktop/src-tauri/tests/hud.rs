//! The `hud` module against `FakePlatform` (docs/modules/hud.md, docs/build-plan/
//! m2-media-hud.md E3 exit criteria). Integration tests because the `muna` lib cannot host
//! unit tests (Common Controls manifest on Tauri-linked tests).

use std::sync::Arc;

use muna_core::{
    Glyph, Hub, Leading, Settings, StripContent, SystemClock, Trailing, activities::priority,
};
use muna_lib::modules::hud::{
    BRIGHTNESS_NOTICE_ID, HUD_HOLD_MS, HudService, HudSettings, HudSink, HudState, HudTracker,
    MIC_NOTICE_ID, ScrollOnStrip, VOLUME_NOTICE_ID, VolumeLevel, is_suppressed, volume_glyph,
};
use muna_platform::{
    Audio, BrightnessKind, BrightnessMonitor, FakePlatform, OsdState, Platform, PlatformError,
};
use parking_lot::Mutex;

#[derive(Default)]
struct Recorder {
    states: Mutex<Vec<HudState>>,
}

impl HudSink for Recorder {
    fn state_changed(&self, state: &HudState) {
        self.states.lock().push(state.clone());
    }
}

struct Rig {
    platform: Arc<FakePlatform>,
    hub: Arc<Hub>,
    service: Arc<HudService>,
    recorder: Arc<Recorder>,
}

fn rig() -> Rig {
    let platform = Arc::new(FakePlatform::new());
    let hub = Arc::new(Hub::new(Arc::new(SystemClock)));
    let service = Arc::new(HudService::new(
        Arc::clone(&platform) as Arc<dyn Platform>,
        Arc::clone(&hub),
    ));
    let recorder = Arc::new(Recorder::default());
    service.set_sink(Arc::clone(&recorder) as Arc<dyn HudSink>);
    Rig {
        platform,
        hub,
        service,
        recorder,
    }
}

fn monitor(id: &str, percent: u8, kind: BrightnessKind) -> BrightnessMonitor {
    BrightnessMonitor {
        id: id.into(),
        name: "Display".into(),
        percent,
        kind,
    }
}

fn shown_notice(hub: &Hub) -> Option<muna_core::Notice> {
    match hub.current() {
        StripContent::Notice { notice } => Some(notice),
        _ => None,
    }
}

fn icon(glyph: Glyph) -> Leading {
    Leading::Icon { glyph, tint: None }
}

fn level(percent: u8, muted: bool) -> Trailing {
    Trailing::Level { percent, muted }
}

/// Feeds a volume event the way the backend does.
fn volume(rig: &Rig, percent: u8, muted: bool) {
    rig.platform.set_volume_state(percent, muted);
    rig.service.observe_volume(percent, muted);
}

fn settings_with(hud: &HudSettings) -> Settings {
    let mut settings = Settings::default();
    hud.write(&mut settings).unwrap();
    settings
}

// --- tracker (pure) -----------------------------------------------------------------------

#[test]
fn glyph_waves_grow_in_thirds_and_mute_wins() {
    assert_eq!(volume_glyph(0, false), Glyph::Volume);
    assert_eq!(volume_glyph(1, false), Glyph::VolumeLow);
    assert_eq!(volume_glyph(33, false), Glyph::VolumeLow);
    assert_eq!(volume_glyph(34, false), Glyph::VolumeMedium);
    assert_eq!(volume_glyph(66, false), Glyph::VolumeMedium);
    assert_eq!(volume_glyph(67, false), Glyph::VolumeHigh);
    assert_eq!(volume_glyph(100, false), Glyph::VolumeHigh);
    assert_eq!(volume_glyph(0, true), Glyph::VolumeMuted);
    assert_eq!(volume_glyph(80, true), Glyph::VolumeMuted);
}

#[test]
fn the_first_level_seeds_the_tracker_without_a_notice() {
    let mut tracker = HudTracker::default();
    assert!(tracker.observe_volume(40, false).is_none());
    assert_eq!(
        tracker.state().volume,
        Some(VolumeLevel {
            percent: 40,
            muted: false
        })
    );
    assert!(tracker.observe_mic(Some(false)).is_none());
    assert!(tracker.set_monitors(vec![monitor("m", 70, BrightnessKind::Internal)]));
    assert_eq!(tracker.observe_brightness("m", 70), Ok(None));
}

#[test]
fn a_volume_change_is_a_hud_notice() {
    let mut tracker = HudTracker::default();
    tracker.observe_volume(40, false);
    let notice = tracker.observe_volume(45, false).expect("notice");
    assert_eq!(notice.id, VOLUME_NOTICE_ID);
    assert_eq!(notice.module, "hud");
    assert_eq!(notice.priority, priority::HUD);
    assert_eq!(notice.hold_ms, HUD_HOLD_MS);
    assert_eq!(notice.leading, Some(icon(Glyph::VolumeMedium)));
    assert_eq!(notice.trailing, Some(level(45, false)));
    assert!(notice.wide.is_none(), "the HUD has no text");
    assert!(
        tracker.observe_volume(45, false).is_none(),
        "same level, no notice"
    );
    let muted = tracker.observe_volume(45, true).expect("mute notice");
    assert_eq!(muted.leading, Some(icon(Glyph::VolumeMuted)));
    assert_eq!(muted.trailing, Some(level(45, true)));
    let clamped = tracker.observe_volume(250, true).expect("notice");
    assert_eq!(clamped.trailing, Some(level(100, true)));
}

#[test]
fn mic_changes_are_glyph_only_notices() {
    let mut tracker = HudTracker::default();
    tracker.observe_mic(Some(false));
    let notice = tracker.observe_mic(Some(true)).expect("notice");
    assert_eq!(notice.id, MIC_NOTICE_ID);
    assert_eq!(notice.leading, Some(icon(Glyph::MicMuted)));
    assert!(notice.trailing.is_none());
    assert!(
        tracker.observe_mic(None).is_none(),
        "losing the microphone is silent"
    );
    assert!(
        tracker.observe_mic(Some(true)).is_none(),
        "it coming back is silent"
    );
    let unmuted = tracker.observe_mic(Some(false)).expect("notice");
    assert_eq!(unmuted.leading, Some(icon(Glyph::Mic)));
}

#[test]
fn brightness_changes_track_known_monitors_only() {
    let mut tracker = HudTracker::default();
    assert!(tracker.observe_brightness("m", 50).is_err());
    tracker.set_monitors(vec![monitor("m", 70, BrightnessKind::Internal)]);
    let notice = tracker
        .observe_brightness("m", 65)
        .unwrap()
        .expect("notice");
    assert_eq!(notice.id, BRIGHTNESS_NOTICE_ID);
    assert_eq!(notice.leading, Some(icon(Glyph::Sun)));
    assert_eq!(notice.trailing, Some(level(65, false)));
    assert_eq!(tracker.state().monitors[0].percent, 65);
}

// --- service over the fake platform -------------------------------------------------------

#[test]
fn start_up_seeds_state_and_shows_nothing() {
    let rig = rig();
    rig.platform.set_volume_state(50, false);
    rig.platform
        .add_brightness_monitor(monitor("wmi:panel", 70, BrightnessKind::Internal));
    rig.service.sync();

    assert_eq!(rig.hub.current(), StripContent::Idle, "no HUD at start-up");
    let state = rig.service.state();
    assert_eq!(
        state.volume,
        Some(VolumeLevel {
            percent: 50,
            muted: false
        })
    );
    assert_eq!(state.mic_muted, Some(false), "the fake has a microphone");
    assert_eq!(state.monitors.len(), 1);
    assert_eq!(state.osd, OsdState::Native);
    assert_eq!(
        rig.recorder.states.lock().len(),
        1,
        "one state event for the seed"
    );
}

#[test]
fn a_volume_key_shows_the_hud_notice() {
    let rig = rig();
    rig.platform.set_volume_state(50, false);
    rig.service.sync();

    volume(&rig, 52, false);
    let notice = shown_notice(&rig.hub).expect("hud notice on the strip");
    assert_eq!(notice.id, VOLUME_NOTICE_ID);
    assert_eq!(notice.leading, Some(icon(Glyph::VolumeMedium)));
    assert_eq!(notice.trailing, Some(level(52, false)));
    assert_eq!(notice.hold_ms, HUD_HOLD_MS);

    volume(&rig, 52, true);
    let notice = shown_notice(&rig.hub).expect("mute notice");
    assert_eq!(notice.leading, Some(icon(Glyph::VolumeMuted)));
    assert_eq!(
        rig.service.state().volume,
        Some(VolumeLevel {
            percent: 52,
            muted: true
        })
    );
    assert_eq!(rig.recorder.states.lock().len(), 3, "seed + two changes");
}

#[test]
fn slider_and_wheel_drive_the_platform_and_the_hud_follows_the_event() {
    let rig = rig();
    rig.platform.set_volume_state(30, false);
    rig.service.sync();

    rig.service.set_volume(40).unwrap();
    assert_eq!(rig.platform.volume().unwrap(), 40);
    // The backend feeds the resulting event; nothing showed until it did.
    assert_eq!(rig.hub.current(), StripContent::Idle);
    rig.service.observe_volume(40, false);
    assert_eq!(
        shown_notice(&rig.hub).unwrap().trailing,
        Some(level(40, false))
    );

    rig.service.nudge_volume(2).unwrap();
    assert_eq!(rig.platform.volume().unwrap(), 42);
    rig.service.observe_volume(42, false);
    rig.service.nudge_volume(-50).unwrap();
    assert_eq!(rig.platform.volume().unwrap(), 0, "clamped at 0");
    rig.service.observe_volume(0, false);
    rig.service.nudge_volume(127).unwrap();
    assert_eq!(rig.platform.volume().unwrap(), 100, "clamped at 100");
}

#[test]
fn turning_up_while_muted_unmutes() {
    let rig = rig();
    rig.platform.set_volume_state(30, true);
    rig.service.sync();

    rig.service.nudge_volume(2).unwrap();
    assert!(!rig.platform.muted().unwrap());
    assert_eq!(rig.platform.volume().unwrap(), 32);

    rig.platform.set_volume_state(32, true);
    rig.service.observe_volume(32, true);
    rig.service.nudge_volume(-2).unwrap();
    assert!(rig.platform.muted().unwrap(), "turning down stays muted");
}

#[test]
fn without_a_render_device_the_wheel_reports_not_found() {
    let rig = rig();
    // Never synced: no level known.
    assert!(matches!(
        rig.service.nudge_volume(2),
        Err(PlatformError::NotFound(_))
    ));
}

#[test]
fn mic_and_brightness_events_show_their_own_notices() {
    let rig = rig();
    rig.platform
        .add_brightness_monitor(monitor("wmi:panel", 70, BrightnessKind::Internal));
    rig.service.sync();

    rig.service.observe_mic(true);
    let notice = shown_notice(&rig.hub).expect("mic notice");
    assert_eq!(notice.id, MIC_NOTICE_ID);
    assert_eq!(notice.leading, Some(icon(Glyph::MicMuted)));

    rig.service.observe_brightness("wmi:panel", 60);
    let notice = shown_notice(&rig.hub).expect("brightness notice");
    assert_eq!(notice.id, BRIGHTNESS_NOTICE_ID);
    assert_eq!(notice.leading, Some(icon(Glyph::Sun)));
    assert_eq!(notice.trailing, Some(level(60, false)));
    assert_eq!(rig.service.state().monitors[0].percent, 60);
}

#[test]
fn an_unknown_monitor_in_an_event_re_reads_the_list() {
    let rig = rig();
    rig.service.sync();
    assert!(rig.service.state().monitors.is_empty());

    // Hot-plugged after start-up; the platform probed it but the module never heard.
    rig.platform
        .add_brightness_monitor(monitor("\\\\.\\DISPLAY2#0", 40, BrightnessKind::External));
    rig.service.observe_brightness("\\\\.\\DISPLAY2#0", 45);
    let monitors = rig.service.state().monitors;
    assert_eq!(monitors.len(), 1);
    assert_eq!(monitors[0].kind, BrightnessKind::External);
    assert_eq!(
        rig.hub.current(),
        StripContent::Idle,
        "the first level of a new monitor is its baseline, not a change"
    );
}

#[test]
fn setting_brightness_goes_to_the_platform() {
    let rig = rig();
    rig.platform
        .add_brightness_monitor(monitor("wmi:panel", 70, BrightnessKind::Internal));
    rig.service.sync();

    rig.service.set_brightness("wmi:panel", 55).unwrap();
    assert_eq!(
        rig.platform.brightness_sets(),
        vec![("wmi:panel".to_owned(), 55)]
    );
    assert!(matches!(
        rig.service.set_brightness("nope", 55),
        Err(PlatformError::NotFound(_))
    ));
}

// --- settings and the system flyout -------------------------------------------------------

#[test]
fn hud_settings_default_to_replacing_the_flyout() {
    let defaults = HudSettings::default();
    assert!(defaults.replace_system_flyout);
    assert_eq!(defaults.scroll_on_strip, ScrollOnStrip::Panel);
    assert!(!defaults.show_level_text);
    assert_eq!(HudSettings::from_document(&Settings::default()), defaults);

    let mut settings = Settings::default();
    settings.modules.insert(
        "hud".into(),
        serde_json::json!({ "replaceSystemFlyout": false, "scrollOnStrip": "volume", "future": 1 }),
    );
    let parsed = HudSettings::from_document(&settings);
    assert!(!parsed.replace_system_flyout);
    assert_eq!(parsed.scroll_on_strip, ScrollOnStrip::Volume);
    assert!(!parsed.show_level_text, "missing keys keep their defaults");

    settings
        .modules
        .insert("hud".into(), serde_json::json!("garbage"));
    assert_eq!(HudSettings::from_document(&settings), defaults);
}

#[test]
fn replace_system_flyout_drives_suppression_once_per_change() {
    let rig = rig();
    rig.service.sync();
    let on = settings_with(&HudSettings::default());
    let off = settings_with(&HudSettings {
        replace_system_flyout: false,
        ..HudSettings::default()
    });

    rig.service.apply_settings(&on);
    assert_eq!(rig.platform.osd_requests(), vec![true]);
    assert_eq!(rig.service.state().osd, OsdState::Suppressed);
    assert!(is_suppressed(&rig.service.state()));

    rig.service.apply_settings(&on);
    assert_eq!(
        rig.platform.osd_requests(),
        vec![true],
        "unchanged setting, no request"
    );

    rig.service.apply_settings(&off);
    assert_eq!(rig.platform.osd_requests(), vec![true, false]);
    assert_eq!(rig.service.state().osd, OsdState::Native);

    rig.service.apply_settings(&on);
    rig.service.shutdown();
    assert_eq!(
        rig.platform.osd_requests(),
        vec![true, false, true, false],
        "a clean exit restores the flyout"
    );
    rig.service.shutdown();
    assert_eq!(
        rig.platform.osd_requests().len(),
        4,
        "shutdown is idempotent"
    );
}

#[test]
fn a_build_without_a_flyout_window_reports_unavailable_and_keeps_going() {
    let rig = rig();
    rig.platform.set_osd_unavailable(true);
    rig.service.sync();
    rig.service
        .apply_settings(&settings_with(&HudSettings::default()));
    assert_eq!(rig.service.state().osd, OsdState::Unavailable);
    assert!(!is_suppressed(&rig.service.state()));

    rig.platform.set_volume_state(20, false);
    rig.service.sync();
    volume(&rig, 22, false);
    assert!(shown_notice(&rig.hub).is_some(), "the HUD still shows");
}

#[test]
fn hud_state_serialises_camel_case_for_the_ui() {
    let rig = rig();
    rig.platform.set_volume_state(50, true);
    rig.platform
        .add_brightness_monitor(monitor("wmi:panel", 70, BrightnessKind::Internal));
    rig.service.sync();
    let json = serde_json::to_value(rig.service.state()).unwrap();
    assert_eq!(json["volume"]["percent"], 50);
    assert_eq!(json["volume"]["muted"], true);
    assert_eq!(json["micMuted"], false);
    assert_eq!(json["monitors"][0]["kind"], "internal");
    assert_eq!(json["osd"], "native");
}
