//! Placement and hit-testing logic of the notch shell, exercised without a window. Integration
//! tests for the same reason as `shell.rs` (Common Controls manifest on Tauri-linked tests).

use muna_lib::shell::hit_test::{HitTester, PollRate, samples_per_second};
use muna_lib::shell::layout::{
    WINDOW_LOGICAL, parked_rect, placed_rect, scale_factor, shape_to_physical, window_size,
};
use muna_platform::{FakePlatform, MonitorInfo, Platform, Rect, WindowingCall};

fn monitor(x: i32, y: i32, width: u32, height: u32, dpi: u32) -> MonitorInfo {
    MonitorInfo {
        id: r"\\.\DISPLAY1".into(),
        bounds: Rect::new(x, y, width, height),
        work_area: Rect::new(x, y, width, height),
        dpi,
        is_primary: true,
    }
}

#[test]
fn window_logical_size_matches_tauri_conf() {
    let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let notch = conf["app"]["windows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["label"] == "notch")
        .unwrap();
    assert_eq!(notch["width"], u64::from(WINDOW_LOGICAL.0));
    assert_eq!(notch["height"], u64::from(WINDOW_LOGICAL.1));
    assert_eq!(notch["windowClassname"], "MunaNotch");
}

#[test]
fn placed_rect_is_centred_at_100_percent() {
    let rect = placed_rect(&monitor(0, 0, 2560, 1440, 96));
    assert_eq!(rect, Rect::new(780, 0, 1000, 440));
}

#[test]
fn placed_rect_scales_with_dpi_and_negative_origins() {
    // 1920 px wide monitor at 150 %: window becomes 1500×660 physical.
    let m = monitor(-1920, -291, 1920, 1080, 144);
    assert_eq!(window_size(&m), (1500, 660));
    assert_eq!(placed_rect(&m), Rect::new(-1920 + 210, -291, 1500, 660));
    assert!((scale_factor(&m) - 1.5).abs() < f64::EPSILON);
}

#[test]
fn narrow_monitor_centres_even_when_the_window_is_wider() {
    let rect = placed_rect(&monitor(0, 0, 800, 600, 96));
    assert_eq!(rect.x, -100);
    assert_eq!(rect.width, 1000);
}

#[test]
fn parked_rect_sits_entirely_above_the_monitor() {
    let m = monitor(0, 0, 2560, 1440, 96);
    let parked = parked_rect(&m);
    assert_eq!(parked.y + i32::try_from(parked.height).unwrap(), m.bounds.y);
    assert_eq!((parked.x, parked.width), (780, 1000));
}

#[test]
fn shape_rects_are_offset_by_the_window_and_scaled() {
    let m = monitor(0, 0, 2560, 1600, 144);
    let window = placed_rect(&m);
    let strip = shape_to_physical(&m, window, [400.0, 0.0, 200.0, 32.0]);
    assert_eq!(strip, Rect::new(window.x + 600, 0, 300, 48));
}

const WINDOW: Rect = Rect::new(780, 0, 1000, 440);
const STRIP: Rect = Rect::new(1180, 0, 200, 32);

#[test]
fn first_sample_outside_the_window_starts_ignoring_at_idle_rate() {
    let mut tester = HitTester::new();
    let decision = tester.observe((0, 900), WINDOW);
    assert_eq!(decision.set_ignore, Some(true));
    assert_eq!(decision.rate, PollRate::Idle);
    assert!(tester.is_ignoring());
}

#[test]
fn transparent_area_inside_the_window_polls_fast_but_stays_click_through() {
    let mut tester = HitTester::new();
    tester.set_shapes(vec![STRIP]);
    tester.observe((0, 900), WINDOW);
    let decision = tester.observe((800, 300), WINDOW);
    assert_eq!(decision.set_ignore, None);
    assert_eq!(decision.rate, PollRate::Active);
}

#[test]
fn entering_and_leaving_a_shape_toggles_exactly_once_each() {
    let mut tester = HitTester::new();
    tester.set_shapes(vec![STRIP]);
    tester.observe((0, 900), WINDOW);
    assert_eq!(tester.observe((1200, 10), WINDOW).set_ignore, Some(false));
    assert_eq!(tester.observe((1210, 12), WINDOW).set_ignore, None);
    assert_eq!(tester.observe((1210, 100), WINDOW).set_ignore, Some(true));
}

#[test]
fn without_shapes_nothing_is_ever_interactive() {
    let mut tester = HitTester::new();
    assert_eq!(tester.observe((1200, 10), WINDOW).set_ignore, Some(true));
    assert_eq!(tester.observe((1200, 10), WINDOW).set_ignore, None);
}

#[test]
fn rates_match_the_spec() {
    assert_eq!(samples_per_second(PollRate::Idle), 10);
    assert_eq!(samples_per_second(PollRate::Active), 59);
    assert!(PollRate::Active.interval() < PollRate::Idle.interval());
}

/// The placement math drives the fake platform end to end: place, then verify the OS-side
/// hit test answers "notch" inside the placed rect and "nothing" outside it.
#[test]
fn placement_round_trips_through_the_fake_platform() {
    let fake = FakePlatform::new();
    let m = monitor(0, 0, 2560, 1440, 96);
    let rect = placed_rect(&m);
    let hwnd = 42;
    fake.windowing().move_async(hwnd, rect).unwrap();
    fake.windowing().assert_topmost(hwnd).unwrap();

    assert_eq!(fake.windowing().window_rect(hwnd).unwrap(), rect);
    assert_eq!(fake.windowing().window_at(1280, 10).unwrap(), hwnd);
    assert_eq!(fake.windowing().window_at(10, 10).unwrap(), 0);
    assert_eq!(
        fake.windowing_calls(),
        vec![
            WindowingCall::MoveAsync(hwnd, rect),
            WindowingCall::AssertTopmost(hwnd)
        ]
    );

    fake.windowing().move_async(hwnd, parked_rect(&m)).unwrap();
    assert_eq!(fake.windowing().window_at(1280, 10).unwrap(), 0);
}
