//! The notch shell model and yield rules against `FakePlatform` (docs/modules/notch-shell.md,
//! docs/09-testing-qa.md "fake platform layer"). Integration tests for the same reason as
//! `shell.rs` (Common Controls manifest on Tauri-linked tests).

use std::time::{Duration, Instant};

use muna_core::{MonitorLayout, NotchShape, PlacementMode, ShellSettings, StripHeight};
use muna_lib::ipc::ShapeRect;
use muna_lib::shell::hit_test::PollRate;
use muna_lib::shell::layout::{
    ISLAND_TOP_OFFSET, PANEL_MAX_WIDTH, PANEL_MONITOR_MARGIN, default_strip_rect, panel_max_width,
    parked_rect_for, placed_rect_for, reserved_height, scale_percent,
};
use muna_lib::shell::model::{Effect, PRIMARY_LABEL, ShellModel};
use muna_lib::shell::yield_rules::{
    PARK_DEBOUNCE, ParkDebounce, YieldInputs, YieldState, caption_overlaps, decide, monitor_of,
};
use muna_platform::{
    FakePlatform, ForegroundWindow, MonitorInfo, Platform, Rect, UserNotificationState,
    WindowingCall,
};

const PRIMARY_HWND: isize = 0x1001;
const SECOND_HWND: isize = 0x1002;
const SETTINGS_HWND: isize = 0x1003;

fn primary() -> MonitorInfo {
    MonitorInfo {
        id: r"\\.\DISPLAY1".into(),
        bounds: Rect::new(0, 0, 2560, 1440),
        work_area: Rect::new(0, 0, 2560, 1392),
        dpi: 96,
        is_primary: true,
    }
}

fn secondary() -> MonitorInfo {
    MonitorInfo {
        id: r"\\.\DISPLAY2".into(),
        bounds: Rect::new(2560, 0, 1920, 1080),
        work_area: Rect::new(2560, 0, 1920, 1032),
        dpi: 96,
        is_primary: false,
    }
}

fn app(handle: isize, bounds: Rect, is_fullscreen: bool) -> ForegroundWindow {
    ForegroundWindow {
        handle,
        title: "Some app".into(),
        process_name: "app.exe".into(),
        bounds,
        is_fullscreen,
    }
}

/// A model with the primary monitor attached and its UI ready; returns the platform, the
/// model and the instant everything happened at.
fn ready_model(settings: ShellSettings) -> (FakePlatform, ShellModel, Instant) {
    let platform = FakePlatform::new();
    platform.set_monitors(vec![primary()]);
    let mut model = ShellModel::new(settings);
    let now = Instant::now();
    let (plan, _) = model.plan_reconcile(&platform, vec![primary()], now);
    assert_eq!(plan.create.len(), 1);
    assert_eq!(plan.create[0].0, PRIMARY_LABEL);
    model.attach(&platform, PRIMARY_LABEL, PRIMARY_HWND, primary(), now);
    model.window_ready(&platform, PRIMARY_LABEL, now);
    (platform, model, now)
}

fn yield_effects(effects: &[Effect]) -> Vec<(&str, YieldState)> {
    effects
        .iter()
        .filter_map(|e| match e {
            Effect::YieldChanged { label, state } => Some((label.as_str(), *state)),
            _ => None,
        })
        .collect()
}

fn last_move(platform: &FakePlatform, hwnd: isize) -> Option<Rect> {
    platform
        .windowing_calls()
        .into_iter()
        .rev()
        .find_map(|call| match call {
            WindowingCall::MoveAsync(h, rect) if h == hwnd => Some(rect),
            _ => None,
        })
}

// --- yield rules ------------------------------------------------------------------------

fn inputs<'a>(
    monitor: &'a MonitorInfo,
    monitors: &'a [MonitorInfo],
    foreground: Option<&'a ForegroundWindow>,
) -> YieldInputs<'a> {
    YieldInputs {
        mode: PlacementMode::Overlay,
        monitor,
        monitors,
        strip: Rect::new(1185, 0, 190, 32),
        foreground,
        quiet: UserNotificationState::AcceptsNotifications,
        moving: false,
        snapping: false,
        dragging: false,
        locked: false,
        paused: false,
    }
}

#[test]
fn nothing_in_the_way_yields_none() {
    let monitors = [primary()];
    let window = app(0x55, Rect::new(200, 300, 800, 600), false);
    assert_eq!(
        decide(&inputs(&monitors[0], &monitors, Some(&window))),
        YieldState::None
    );
}

#[test]
fn caption_overlap_needs_more_than_forty_percent_of_the_strip() {
    let strip = Rect::new(1000, 0, 200, 32);
    // 80 px of 200 is exactly 40 %: not enough.
    assert!(!caption_overlaps(&Rect::new(1120, 0, 800, 600), strip));
    // 81 px is more than 40 %.
    assert!(caption_overlaps(&Rect::new(1119, 0, 800, 600), strip));
    // A window that starts below the strip never overlaps its caption.
    assert!(!caption_overlaps(&Rect::new(1000, 33, 800, 600), strip));
    // A window whose top edge is inside the strip does.
    assert!(caption_overlaps(&Rect::new(1000, 20, 800, 600), strip));
    // Zero-width strips never overlap.
    assert!(!caption_overlaps(
        &Rect::new(0, 0, 4000, 600),
        Rect::new(0, 0, 0, 32)
    ));
}

#[test]
fn a_caption_under_the_strip_peeks_in_overlay_but_not_in_reserved_mode() {
    let monitors = [primary()];
    let window = app(0x55, Rect::new(100, 0, 1400, 900), false);
    let mut i = inputs(&monitors[0], &monitors, Some(&window));
    assert_eq!(decide(&i), YieldState::Peek);
    i.mode = PlacementMode::Reserved;
    assert_eq!(decide(&i), YieldState::None);
}

#[test]
fn a_window_drag_peeks_in_both_modes() {
    let monitors = [primary()];
    let mut i = inputs(&monitors[0], &monitors, None);
    i.moving = true;
    assert_eq!(decide(&i), YieldState::Peek);
    i.mode = PlacementMode::Reserved;
    assert_eq!(decide(&i), YieldState::Peek);
}

/// docs/modules/notch-shell.md: "MOVESIZESTART on any window → Peek unless the Window-snap
/// module wants the hot zone"; the zones need the strip in place, and a park still wins.
#[test]
fn a_snap_candidate_drag_holds_the_strip_instead_of_peeking() {
    let monitors = [primary()];
    let caption = app(0x55, Rect::new(100, 0, 1400, 900), false);
    let mut i = inputs(&monitors[0], &monitors, Some(&caption));
    i.moving = true;
    assert_eq!(decide(&i), YieldState::Peek);
    i.snapping = true;
    assert_eq!(decide(&i), YieldState::None);
    i.mode = PlacementMode::Reserved;
    assert_eq!(decide(&i), YieldState::None);
    i.locked = true;
    assert_eq!(decide(&i), YieldState::Parked);
    i.locked = false;
    i.moving = false;
    i.mode = PlacementMode::Overlay;
    assert_eq!(
        decide(&i),
        YieldState::Peek,
        "snapping without a drag changes nothing; the caption still peeks"
    );
}

/// docs/build-plan/m4-power-tools.md "Risks": a file drag over the strip must win over Peek
/// and lose to fullscreen holds.
#[test]
fn a_file_drag_over_the_strip_wins_over_peek_and_loses_to_park() {
    let monitors = [primary()];
    let caption = app(0x55, Rect::new(100, 0, 1400, 900), false);
    let mut i = inputs(&monitors[0], &monitors, Some(&caption));
    assert_eq!(decide(&i), YieldState::Peek);
    i.dragging = true;
    assert_eq!(decide(&i), YieldState::None);
    i.moving = true;
    assert_eq!(decide(&i), YieldState::None);
    i.paused = true;
    assert_eq!(decide(&i), YieldState::Parked);
    i.paused = false;
    let game = app(0x56, Rect::new(0, 0, 2560, 1440), true);
    i.foreground = Some(&game);
    assert_eq!(decide(&i), YieldState::Parked);
}

#[test]
fn fullscreen_parks_only_the_monitor_it_is_on() {
    let monitors = [primary(), secondary()];
    let game = app(0x55, Rect::new(2560, 0, 1920, 1080), true);
    assert_eq!(
        decide(&inputs(&monitors[1], &monitors, Some(&game))),
        YieldState::Parked
    );
    assert_eq!(
        decide(&inputs(&monitors[0], &monitors, Some(&game))),
        YieldState::None
    );
}

#[test]
fn busy_quiet_state_needs_a_fullscreen_window_but_presentation_parks_everything() {
    let monitors = [primary(), secondary()];
    let window = app(0x55, Rect::new(200, 300, 800, 600), false);
    let mut i = inputs(&monitors[0], &monitors, Some(&window));
    i.quiet = UserNotificationState::Busy;
    assert_eq!(
        decide(&i),
        YieldState::None,
        "Busy alone is only a hint (W6)"
    );
    i.quiet = UserNotificationState::Presentation;
    assert_eq!(decide(&i), YieldState::Parked);
    let other = inputs(&monitors[1], &monitors, Some(&window));
    assert_eq!(
        decide(&YieldInputs {
            quiet: UserNotificationState::Presentation,
            ..other
        }),
        YieldState::Parked
    );
}

#[test]
fn lock_and_pause_park_and_beat_everything_else() {
    let monitors = [primary()];
    let mut i = inputs(&monitors[0], &monitors, None);
    i.moving = true;
    i.locked = true;
    assert_eq!(decide(&i), YieldState::Parked);
    i.locked = false;
    i.paused = true;
    assert_eq!(decide(&i), YieldState::Parked);
}

#[test]
fn monitor_of_picks_the_largest_intersection() {
    let monitors = [primary(), secondary()];
    let straddling = Rect::new(2000, 100, 1000, 500);
    assert_eq!(
        monitor_of(&straddling, &monitors).map(|m| m.id.as_str()),
        Some(r"\\.\DISPLAY1")
    );
    assert_eq!(
        monitor_of(&Rect::new(3000, 100, 500, 500), &monitors).map(|m| m.id.as_str()),
        Some(r"\\.\DISPLAY2")
    );
    assert!(monitor_of(&Rect::new(-5000, 0, 100, 100), &monitors).is_none());
}

#[test]
fn park_debounce_waits_500_ms_and_never_flickers() {
    let mut debounce = ParkDebounce::new();
    let t0 = Instant::now();
    let first = debounce.observe(YieldState::Parked, t0);
    assert_eq!(first.effective, YieldState::None);
    assert_eq!(first.recheck_at, Some(t0 + PARK_DEBOUNCE));
    assert!(!debounce.is_parked());

    // The detection flaps back before the debounce elapses: nothing happened.
    let flap = debounce.observe(YieldState::None, t0 + Duration::from_millis(200));
    assert_eq!(flap.effective, YieldState::None);
    assert_eq!(flap.recheck_at, None);

    // Held for the full window: parks.
    let t1 = t0 + Duration::from_millis(300);
    debounce.observe(YieldState::Parked, t1);
    let settled = debounce.observe(YieldState::Parked, t1 + PARK_DEBOUNCE);
    assert_eq!(settled.effective, YieldState::Parked);
    assert!(debounce.is_parked());

    // Unparking is debounced too; Peek meanwhile stays Parked.
    let t2 = t1 + PARK_DEBOUNCE + Duration::from_millis(10);
    let pending = debounce.observe(YieldState::Peek, t2);
    assert_eq!(pending.effective, YieldState::Parked);
    assert_eq!(pending.recheck_at, Some(t2 + PARK_DEBOUNCE));
    let unparked = debounce.observe(YieldState::Peek, t2 + PARK_DEBOUNCE);
    assert_eq!(unparked.effective, YieldState::Peek);
    assert!(!debounce.is_parked());
}

#[test]
fn peek_is_never_debounced() {
    let mut debounce = ParkDebounce::new();
    let now = Instant::now();
    assert_eq!(
        debounce.observe(YieldState::Peek, now).effective,
        YieldState::Peek
    );
    assert_eq!(
        debounce.observe(YieldState::None, now).effective,
        YieldState::None
    );
}

// --- layout helpers ---------------------------------------------------------------------

#[test]
fn placed_rect_applies_offsets_in_css_px_at_the_monitor_scale() {
    let mut monitor = primary();
    monitor.dpi = 144;
    let layout = MonitorLayout {
        offset_x: 10,
        offset_y: 4,
        ..MonitorLayout::default()
    };
    // 1120×480 CSS at 150 % = 1680×720; slack (2560−1680)/2 = 440, +15 px offset; y = 6 px.
    assert_eq!(
        placed_rect_for(&monitor, &layout),
        Rect::new(455, 6, 1680, 720)
    );
    assert_eq!(
        parked_rect_for(&monitor, &layout),
        Rect::new(455, -720, 1680, 720)
    );
}

#[test]
fn reserved_height_covers_offset_strip_and_island_gap() {
    let monitor = primary();
    let notch = MonitorLayout::default();
    assert_eq!(reserved_height(&monitor, &notch), 32);
    let island = MonitorLayout {
        shape: NotchShape::Island,
        strip_height: StripHeight::Comfortable,
        offset_y: 2,
        ..MonitorLayout::default()
    };
    assert_eq!(
        reserved_height(&monitor, &island),
        2 + ISLAND_TOP_OFFSET + 38
    );
    let mut hidpi = primary();
    hidpi.dpi = 192;
    assert_eq!(reserved_height(&hidpi, &notch), 64);
}

#[test]
fn panel_max_width_is_clamped_to_1000_css_px() {
    assert_eq!(panel_max_width(&primary()), PANEL_MAX_WIDTH);
    let mut small = primary();
    small.bounds = Rect::new(0, 0, 1024, 768);
    assert_eq!(panel_max_width(&small), 1024 - PANEL_MONITOR_MARGIN);
    let mut hidpi = primary();
    hidpi.bounds = Rect::new(0, 0, 1920, 1080);
    hidpi.dpi = 192;
    assert_eq!(panel_max_width(&hidpi), 960 - PANEL_MONITOR_MARGIN);
    assert_eq!(scale_percent(&hidpi), 200);
}

#[test]
fn default_strip_is_centred_in_the_window_at_the_shape_offset() {
    let monitor = primary();
    let window = placed_rect_for(&monitor, &MonitorLayout::default());
    let strip = default_strip_rect(&monitor, &MonitorLayout::default(), window);
    assert_eq!(strip, Rect::new(720 + (1120 - 190) / 2, 0, 190, 32));
    let island = MonitorLayout {
        shape: NotchShape::Island,
        ..MonitorLayout::default()
    };
    assert_eq!(default_strip_rect(&monitor, &island, window).y, 8);
}

// --- model ------------------------------------------------------------------------------

#[test]
fn ready_window_becomes_a_tool_window_and_is_placed_topmost() {
    let (platform, model, _) = ready_model(ShellSettings::default());
    let calls = platform.windowing_calls();
    assert!(calls.contains(&WindowingCall::SetToolWindow(PRIMARY_HWND)));
    assert!(
        calls.contains(&WindowingCall::SetCaptureExclusion(PRIMARY_HWND, false)),
        "capture exclusion follows the setting (off by default)"
    );
    assert!(calls.contains(&WindowingCall::AssertTopmost(PRIMARY_HWND)));
    assert_eq!(
        last_move(&platform, PRIMARY_HWND),
        Some(Rect::new(720, 0, 1120, 480))
    );
    let layout = model.shell_layout(PRIMARY_LABEL).unwrap();
    assert_eq!(layout.strip_height, 32);
    assert_eq!(layout.strip_top_offset, 0);
    assert_eq!(layout.panel_max_width, 1000);
    assert_eq!(layout.scale_percent, 100);
    assert_eq!(layout.yield_state, YieldState::None);
    assert!(layout.is_primary);
    assert!(
        platform.app_bars().is_empty(),
        "overlay mode reserves nothing"
    );
}

#[test]
fn window_ready_reports_layout_then_yield_state() {
    let platform = FakePlatform::new();
    let mut model = ShellModel::new(ShellSettings::default());
    let now = Instant::now();
    model.plan_reconcile(&platform, vec![primary()], now);
    model.attach(&platform, PRIMARY_LABEL, PRIMARY_HWND, primary(), now);
    let effects = model.window_ready(&platform, PRIMARY_LABEL, now);
    assert!(matches!(effects.first(), Some(Effect::LayoutChanged(l)) if l.label == PRIMARY_LABEL));
    assert_eq!(
        yield_effects(&effects),
        vec![(PRIMARY_LABEL, YieldState::None)]
    );
}

#[test]
fn ready_and_shapes_reported_before_attach_are_replayed() {
    let platform = FakePlatform::new();
    let mut model = ShellModel::new(ShellSettings::default());
    let now = Instant::now();
    let strip = ShapeRect {
        x: 405,
        y: 0,
        width: 190,
        height: 32,
    };
    assert!(
        model
            .publish_shapes(&platform, PRIMARY_LABEL, &[strip], now)
            .is_empty()
    );
    assert!(model.window_ready(&platform, PRIMARY_LABEL, now).is_empty());
    assert!(platform.windowing_calls().is_empty());

    model.plan_reconcile(&platform, vec![primary()], now);
    let effects = model.attach(&platform, PRIMARY_LABEL, PRIMARY_HWND, primary(), now);
    assert!(
        effects
            .iter()
            .any(|e| matches!(e, Effect::LayoutChanged(_)))
    );
    let window = model.window(PRIMARY_LABEL).unwrap();
    assert!(window.ready);
    assert_eq!(window.css_shapes, vec![strip]);
    assert_eq!(
        last_move(&platform, PRIMARY_HWND),
        Some(Rect::new(720, 0, 1120, 480))
    );
}

#[test]
fn fullscreen_parks_after_the_debounce_and_unparks_the_same_way() {
    let (platform, mut model, t0) = ready_model(ShellSettings::default());
    let game = app(0x55, Rect::new(0, 0, 2560, 1440), true);
    let effects = model.set_foreground(&platform, Some(game.clone()), t0);
    assert_eq!(
        effects,
        vec![Effect::RecheckAt(t0 + PARK_DEBOUNCE)],
        "nothing visible happens until the park settles"
    );
    assert_eq!(
        last_move(&platform, PRIMARY_HWND),
        Some(Rect::new(720, 0, 1120, 480))
    );

    let effects = model.evaluate(&platform, t0 + PARK_DEBOUNCE);
    assert_eq!(
        yield_effects(&effects),
        vec![(PRIMARY_LABEL, YieldState::Parked)]
    );
    assert_eq!(
        last_move(&platform, PRIMARY_HWND),
        Some(Rect::new(720, -480, 1120, 480)),
        "parked = moved fully above the monitor, never hidden"
    );

    let t1 = t0 + PARK_DEBOUNCE * 2;
    let desktop = app(0x56, Rect::new(200, 300, 800, 600), false);
    model.set_foreground(&platform, Some(desktop), t1);
    let effects = model.evaluate(&platform, t1 + PARK_DEBOUNCE);
    assert_eq!(
        yield_effects(&effects),
        vec![(PRIMARY_LABEL, YieldState::None)]
    );
    assert_eq!(
        last_move(&platform, PRIMARY_HWND),
        Some(Rect::new(720, 0, 1120, 480))
    );
    assert_eq!(
        model.shell_layout(PRIMARY_LABEL).unwrap().yield_state,
        YieldState::None
    );
    let _ = game;
}

#[test]
fn caption_under_the_published_strip_peeks_immediately() {
    let (platform, mut model, now) = ready_model(ShellSettings::default());
    // The UI painted a 300 px strip centred in the window.
    let strip = ShapeRect {
        x: 350,
        y: 0,
        width: 300,
        height: 32,
    };
    model.publish_shapes(&platform, PRIMARY_LABEL, &[strip], now);
    let editor = app(0x55, Rect::new(1000, 0, 1200, 900), false);
    let effects = model.set_foreground(&platform, Some(editor), now);
    assert_eq!(
        yield_effects(&effects),
        vec![(PRIMARY_LABEL, YieldState::Peek)]
    );
    // Peek never moves the window.
    assert_eq!(
        last_move(&platform, PRIMARY_HWND),
        Some(Rect::new(720, 0, 1120, 480))
    );
}

/// S5 (docs/09-testing-qa.md), Rust half: while a window peeks the UI paints only the
/// 6 px sliver, so the strip's rest position — the caption of the window that caused the peek
/// — must click through; the sliver itself stays interactive. The published rect is left alone
/// (it is the yield reference), only the hit tester follows the slide.
#[test]
fn s5_peek_moves_the_hit_rect_up_to_the_sliver_and_back() {
    let (platform, mut model, now) = ready_model(ShellSettings::default());
    let strip = ShapeRect {
        x: 350,
        y: 0,
        width: 300,
        height: 32,
    };
    model.publish_shapes(&platform, PRIMARY_LABEL, &[strip], now);
    // Over the strip at rest: interactive, nothing to toggle yet.
    let over_strip = (720 + 500, 20);
    let on_sliver = (720 + 500, 3);
    assert!(model.poll_cursor(over_strip, false).toggles.is_empty());

    let editor = app(0x55, Rect::new(1000, 0, 1200, 900), false);
    let effects = model.set_foreground(&platform, Some(editor), now);
    assert_eq!(
        yield_effects(&effects),
        vec![(PRIMARY_LABEL, YieldState::Peek)]
    );
    // The rest position now belongs to the editor's caption; the sliver is still ours.
    assert_eq!(
        model.poll_cursor(over_strip, false).toggles,
        vec![(PRIMARY_HWND, true)]
    );
    assert_eq!(
        model.poll_cursor(on_sliver, false).toggles,
        vec![(PRIMARY_HWND, false)]
    );
    assert_eq!(
        model.poll_cursor(over_strip, false).toggles,
        vec![(PRIMARY_HWND, true)]
    );

    // The rule clears: the whole strip is interactive again.
    let effects = model.set_foreground(&platform, None, now);
    assert_eq!(
        yield_effects(&effects),
        vec![(PRIMARY_LABEL, YieldState::None)]
    );
    assert_eq!(
        model.poll_cursor(over_strip, false).toggles,
        vec![(PRIMARY_HWND, false)]
    );
}

/// The island rests below the top edge; peeking still leaves exactly the 6 px sliver at the
/// edge, so the whole rest position — 8 px gap included — must click through.
#[test]
fn s5_an_island_peeks_to_the_same_6_px_sliver() {
    let mut settings = ShellSettings::default();
    settings.defaults.shape = NotchShape::Island;
    let (platform, mut model, now) = ready_model(settings);
    let strip = ShapeRect {
        x: 350,
        y: i32::try_from(ISLAND_TOP_OFFSET).unwrap(),
        width: 300,
        height: 32,
    };
    model.publish_shapes(&platform, PRIMARY_LABEL, &[strip], now);
    let over_strip = (720 + 500, 20);
    let below_the_sliver = (720 + 500, 7);
    let on_sliver = (720 + 500, 5);
    assert!(model.poll_cursor(over_strip, false).toggles.is_empty());

    let editor = app(0x55, Rect::new(1000, 0, 1200, 900), false);
    model.set_foreground(&platform, Some(editor), now);
    assert_eq!(
        model.poll_cursor(over_strip, false).toggles,
        vec![(PRIMARY_HWND, true)]
    );
    assert!(
        model
            .poll_cursor(below_the_sliver, false)
            .toggles
            .is_empty(),
        "row 7 is the caption's, not the sliver's"
    );
    assert_eq!(
        model.poll_cursor(on_sliver, false).toggles,
        vec![(PRIMARY_HWND, false)]
    );
}

#[test]
fn own_windows_never_count_as_foreground() {
    let (platform, mut model, now) = ready_model(ShellSettings::default());
    model.set_own_handles(vec![SETTINGS_HWND]);
    let settings = app(SETTINGS_HWND, Rect::new(0, 0, 2560, 1440), true);
    assert!(
        model
            .set_foreground(&platform, Some(settings), now)
            .is_empty()
    );
    let notch = app(PRIMARY_HWND, Rect::new(0, 0, 2560, 1440), true);
    assert!(model.set_foreground(&platform, Some(notch), now).is_empty());
}

#[test]
fn lock_and_pause_park_and_the_debounce_applies() {
    let (platform, mut model, t0) = ready_model(ShellSettings::default());
    assert_eq!(
        model.set_locked(&platform, true, t0),
        vec![Effect::RecheckAt(t0 + PARK_DEBOUNCE)]
    );
    let effects = model.evaluate(&platform, t0 + PARK_DEBOUNCE);
    assert_eq!(
        yield_effects(&effects),
        vec![(PRIMARY_LABEL, YieldState::Parked)]
    );
    model.set_locked(&platform, false, t0 + PARK_DEBOUNCE);
    model.evaluate(&platform, t0 + PARK_DEBOUNCE * 2);
    assert_eq!(
        model.shell_layout(PRIMARY_LABEL).unwrap().yield_state,
        YieldState::None
    );

    let t1 = t0 + PARK_DEBOUNCE * 3;
    model.set_paused(&platform, &primary().id, true, t1);
    assert!(model.paused_monitors().contains(&primary().id));
    let effects = model.evaluate(&platform, t1 + PARK_DEBOUNCE);
    assert_eq!(
        yield_effects(&effects),
        vec![(PRIMARY_LABEL, YieldState::Parked)]
    );
}

#[test]
fn reserved_mode_keeps_an_app_bar_while_placed_and_releases_it_when_parked() {
    let mut settings = ShellSettings::default();
    settings.defaults.mode = PlacementMode::Reserved;
    let (platform, mut model, t0) = ready_model(settings);
    assert_eq!(
        platform.app_bars(),
        vec![(PRIMARY_HWND, Rect::new(0, 0, 2560, 32))]
    );
    let game = app(0x55, Rect::new(0, 0, 2560, 1440), true);
    model.set_foreground(&platform, Some(game), t0);
    model.evaluate(&platform, t0 + PARK_DEBOUNCE);
    assert!(
        platform.app_bars().is_empty(),
        "a parked strip reserves nothing"
    );

    model.set_foreground(
        &platform,
        Some(app(0x56, Rect::new(0, 100, 800, 600), false)),
        t0 + PARK_DEBOUNCE,
    );
    model.evaluate(&platform, t0 + PARK_DEBOUNCE * 2);
    assert_eq!(platform.app_bars().len(), 1);

    model.release_app_bars(&platform);
    assert!(platform.app_bars().is_empty());
}

#[test]
fn applying_settings_re_places_the_window_and_reports_the_layout() {
    let (platform, mut model, now) = ready_model(ShellSettings::default());
    let settings = ShellSettings {
        hide_from_captures: true,
        defaults: MonitorLayout {
            shape: NotchShape::Island,
            offset_y: 6,
            strip_height: StripHeight::Compact,
            ..MonitorLayout::default()
        },
        ..ShellSettings::default()
    };
    let effects = model.apply_settings(&platform, settings.clone(), now);
    let layout = effects
        .iter()
        .find_map(|e| match e {
            Effect::LayoutChanged(l) => Some(l.clone()),
            _ => None,
        })
        .expect("layout change reported");
    assert_eq!(layout.shape, NotchShape::Island);
    assert_eq!(layout.strip_height, 26);
    assert_eq!(layout.strip_top_offset, ISLAND_TOP_OFFSET);
    assert_eq!(
        last_move(&platform, PRIMARY_HWND),
        Some(Rect::new(720, 6, 1120, 480))
    );
    assert!(
        platform
            .windowing_calls()
            .contains(&WindowingCall::SetCaptureExclusion(PRIMARY_HWND, true)),
        "hide from captures is applied to the live window"
    );
    assert_eq!(model.settings(), &settings);
    assert!(model.apply_settings(&platform, settings, now).is_empty());
}

#[test]
fn disabling_a_monitor_parks_its_window_and_re_enabling_restores_it() {
    let (platform, mut model, t0) = ready_model(ShellSettings::default());
    let mut settings = ShellSettings::default();
    settings.layout_for_mut(&primary().id).enabled = false;
    model.apply_settings(&platform, settings, t0);
    let effects = model.evaluate(&platform, t0 + PARK_DEBOUNCE);
    assert_eq!(
        yield_effects(&effects),
        vec![(PRIMARY_LABEL, YieldState::Parked)]
    );
    assert_eq!(
        last_move(&platform, PRIMARY_HWND),
        Some(Rect::new(720, -480, 1120, 480))
    );
    assert_eq!(
        model.labels(),
        vec![PRIMARY_LABEL.to_owned()],
        "the window survives"
    );

    model.apply_settings(&platform, ShellSettings::default(), t0 + PARK_DEBOUNCE);
    model.evaluate(&platform, t0 + PARK_DEBOUNCE * 2);
    assert_eq!(
        last_move(&platform, PRIMARY_HWND),
        Some(Rect::new(720, 0, 1120, 480))
    );
}

#[test]
fn a_second_monitor_gets_its_own_window_and_loses_it_when_unplugged() {
    let (platform, mut model, now) = ready_model(ShellSettings::default());
    let (plan, _) = model.plan_reconcile(&platform, vec![primary(), secondary()], now);
    assert_eq!(plan.create.len(), 1);
    assert_eq!(plan.create[0].0, "notch-1");
    assert_eq!(plan.create[0].1.id, secondary().id);
    assert!(plan.destroy.is_empty());
    model.attach(&platform, "notch-1", SECOND_HWND, secondary(), now);
    model.window_ready(&platform, "notch-1", now);
    assert_eq!(
        last_move(&platform, SECOND_HWND),
        Some(Rect::new(2560 + 400, 0, 1120, 480))
    );
    assert_eq!(model.label_at((3000, 10)), Some("notch-1".to_owned()));
    assert_eq!(model.label_at((100, 10)), Some(PRIMARY_LABEL.to_owned()));
    assert_eq!(
        model.label_at((-9999, -9999)),
        Some(PRIMARY_LABEL.to_owned()),
        "off every monitor falls back to the primary"
    );

    let (plan, _) = model.plan_reconcile(&platform, vec![primary()], now);
    assert_eq!(plan.destroy, vec!["notch-1".to_owned()]);
    assert!(plan.create.is_empty());
    assert_eq!(model.labels(), vec![PRIMARY_LABEL.to_owned()]);
}

#[test]
fn the_primary_window_follows_the_primary_monitor_and_moves_with_a_resolution_change() {
    let (platform, mut model, now) = ready_model(ShellSettings::default());
    let mut bigger = primary();
    bigger.bounds = Rect::new(0, 0, 3840, 2160);
    bigger.dpi = 144;
    let (plan, effects) = model.plan_reconcile(&platform, vec![bigger], now);
    assert!(plan.create.is_empty() && plan.destroy.is_empty());
    assert!(
        effects
            .iter()
            .any(|e| matches!(e, Effect::LayoutChanged(l) if l.scale_percent == 150))
    );
    assert_eq!(
        last_move(&platform, PRIMARY_HWND),
        Some(Rect::new((3840 - 1680) / 2, 0, 1680, 720))
    );
}

/// S12 (docs/09-testing-qa.md): the secondary monitor disappears while its notch is open.
/// The window is destroyed, nothing else changes, and the per-monitor settings survive so the
/// display comes back configured when it is plugged in again.
#[test]
fn s12_removing_a_monitor_destroys_its_window_and_keeps_its_settings() {
    let mut settings = ShellSettings::default();
    settings.layout_for_mut(&secondary().id).shape = NotchShape::Island;
    let (platform, mut model, now) = ready_model(settings);
    let (plan, _) = model.plan_reconcile(&platform, vec![primary(), secondary()], now);
    assert_eq!(plan.create.len(), 1);
    model.attach(&platform, "notch-1", SECOND_HWND, secondary(), now);
    model.window_ready(&platform, "notch-1", now);
    // The panel is open: the UI published the strip and the padded panel span.
    let strip = ShapeRect {
        x: 465,
        y: 8,
        width: 190,
        height: 32,
    };
    let panel = ShapeRect {
        x: 180,
        y: 0,
        width: 760,
        height: 240,
    };
    model.publish_shapes(&platform, "notch-1", &[strip, panel], now);

    let (plan, effects) = model.plan_reconcile(&platform, vec![primary()], now);
    assert_eq!(plan.destroy, vec!["notch-1".to_owned()]);
    assert!(plan.create.is_empty());
    assert!(
        yield_effects(&effects).is_empty(),
        "the primary window is untouched"
    );
    assert_eq!(model.labels(), vec![PRIMARY_LABEL.to_owned()]);
    assert_eq!(model.shell_layout("notch-1"), None);
    assert_eq!(
        model.settings().layout_for(&secondary().id).shape,
        NotchShape::Island,
        "settings for the unplugged display are retained"
    );
    let poll = model.poll_cursor((3000, 10), true);
    assert_eq!(
        poll.pressed_outside,
        vec![PRIMARY_LABEL.to_owned()],
        "the destroyed window is no longer polled"
    );

    let (plan, _) = model.plan_reconcile(&platform, vec![primary(), secondary()], now);
    assert_eq!(
        plan.create.len(),
        1,
        "plugging it back recreates the window"
    );
    assert_eq!(plan.create[0].1.id, secondary().id);
}

/// S13 (docs/09-testing-qa.md): the display scale changes from 100 % to 200 % under a ready
/// window. The window keeps its logical size, so it doubles in physical pixels and the
/// published shapes are re-scaled for hit-testing without the UI publishing again.
#[test]
fn s13_scale_change_rescales_the_window_and_the_hit_rects() {
    let (platform, mut model, now) = ready_model(ShellSettings::default());
    let strip = ShapeRect {
        x: 465,
        y: 0,
        width: 190,
        height: 32,
    };
    model.publish_shapes(&platform, PRIMARY_LABEL, &[strip], now);
    // 100 %: the strip spans x 720+465 ..= 720+655 physical, 32 px tall. The tester starts
    // interactive (the state Tauri creates the window in), so leave the strip first.
    assert_eq!(
        model.poll_cursor((720 + 470, 40), false).toggles,
        vec![(PRIMARY_HWND, true)]
    );
    assert_eq!(
        model.poll_cursor((720 + 470, 30), false).toggles,
        vec![(PRIMARY_HWND, false)]
    );
    assert_eq!(
        model.poll_cursor((720 + 470, 40), false).toggles,
        vec![(PRIMARY_HWND, true)]
    );

    let mut scaled = primary();
    scaled.dpi = 192;
    let (plan, effects) = model.plan_reconcile(&platform, vec![scaled], now);
    assert!(plan.create.is_empty() && plan.destroy.is_empty());
    let layout = effects
        .iter()
        .find_map(|e| match e {
            Effect::LayoutChanged(layout) => Some(layout.clone()),
            _ => None,
        })
        .expect("a layout change is emitted");
    assert_eq!(layout.scale_percent, 200);
    assert_eq!(layout.strip_height, 32, "CSS px do not change");
    assert_eq!(layout.panel_max_width, PANEL_MAX_WIDTH);
    // 2240×960 physical, centred: x = (2560 − 2240) / 2.
    assert_eq!(
        last_move(&platform, PRIMARY_HWND),
        Some(Rect::new(160, 0, 2240, 960))
    );
    // The strip now covers x 160+930 ..= 160+1310 and is 64 px tall.
    assert_eq!(
        model.poll_cursor((160 + 940, 60), false).toggles,
        vec![(PRIMARY_HWND, false)]
    );
    assert_eq!(
        model.poll_cursor((160 + 940, 70), false).toggles,
        vec![(PRIMARY_HWND, true)]
    );
    assert_eq!(
        model.poll_cursor((720 + 470, 40), false).toggles,
        vec![(PRIMARY_HWND, false)],
        "a point that was transparent at 100 % is over the doubled strip"
    );
}

#[test]
fn focusable_toggles_no_activate_once() {
    let (platform, mut model, _) = ready_model(ShellSettings::default());
    model.set_focusable(&platform, PRIMARY_LABEL, true);
    model.set_focusable(&platform, PRIMARY_LABEL, true);
    model.set_focusable(&platform, PRIMARY_LABEL, false);
    let toggles: Vec<_> = platform
        .windowing_calls()
        .into_iter()
        .filter(|c| matches!(c, WindowingCall::SetNoActivate(..)))
        .collect();
    assert_eq!(
        toggles,
        vec![
            WindowingCall::SetNoActivate(PRIMARY_HWND, false),
            WindowingCall::SetNoActivate(PRIMARY_HWND, true),
        ]
    );
}

#[test]
fn moving_a_window_peeks_until_the_drag_ends() {
    let (platform, mut model, now) = ready_model(ShellSettings::default());
    assert_eq!(
        yield_effects(&model.set_moving(&platform, true, now)),
        vec![(PRIMARY_LABEL, YieldState::Peek)]
    );
    assert!(model.set_moving(&platform, true, now).is_empty());
    assert_eq!(
        yield_effects(&model.set_moving(&platform, false, now)),
        vec![(PRIMARY_LABEL, YieldState::None)]
    );
}

/// A file drag entering the window while a window drag peeks brings the strip back for the
/// drop tiles; when the file drag leaves, the peek resumes. Only the window under the drag is
/// affected, and an unknown label is a no-op.
#[test]
fn a_file_drag_holds_the_strip_in_place_while_it_is_over_the_window() {
    let (platform, mut model, now) = ready_model(ShellSettings::default());
    model.set_moving(&platform, true, now);
    assert_eq!(
        yield_effects(&model.set_dragging(&platform, PRIMARY_LABEL, true, now)),
        vec![(PRIMARY_LABEL, YieldState::None)]
    );
    assert!(
        model
            .set_dragging(&platform, PRIMARY_LABEL, true, now)
            .is_empty()
    );
    assert!(
        model
            .set_dragging(&platform, "notch-9", true, now)
            .is_empty()
    );
    assert_eq!(
        yield_effects(&model.set_dragging(&platform, PRIMARY_LABEL, false, now)),
        vec![(PRIMARY_LABEL, YieldState::Peek)]
    );
}

#[test]
fn cursor_poll_returns_click_through_toggles_to_apply_outside_the_lock() {
    let (platform, mut model, now) = ready_model(ShellSettings::default());
    let strip = ShapeRect {
        x: 465,
        y: 0,
        width: 190,
        height: 32,
    };
    model.publish_shapes(&platform, PRIMARY_LABEL, &[strip], now);
    // Inside the window but outside every shape: click-through.
    let poll = model.poll_cursor((720 + 20, 300), false);
    assert_eq!(poll.toggles, vec![(PRIMARY_HWND, true)]);
    assert_eq!(poll.rate, PollRate::Active);
    // Over the strip: interactive again.
    let poll = model.poll_cursor((720 + 560, 10), false);
    assert_eq!(poll.toggles, vec![(PRIMARY_HWND, false)]);
    // Outside the window: idle rate, still interactive (nothing to toggle).
    let poll = model.poll_cursor((10, 1000), false);
    assert_eq!(poll.toggles, vec![(PRIMARY_HWND, true)]);
    assert_eq!(poll.rate, PollRate::Idle);
    assert!(poll.pressed_outside.is_empty());
    assert_eq!(platform.name(), "fake");
}

/// S4 (docs/09-testing-qa.md), Rust half: a button going down while the cursor is outside
/// every published shape is reported once per press, for the windows it is outside of.
#[test]
fn s4_press_outside_the_shapes_is_reported_on_the_rising_edge_only() {
    let (platform, mut model, now) = ready_model(ShellSettings::default());
    let strip = ShapeRect {
        x: 465,
        y: 0,
        width: 190,
        height: 32,
    };
    model.publish_shapes(&platform, PRIMARY_LABEL, &[strip], now);
    let outside = (100, 900);
    let over_strip = (720 + 560, 10);

    assert!(model.poll_cursor(outside, false).pressed_outside.is_empty());
    assert_eq!(
        model.poll_cursor(outside, true).pressed_outside,
        vec![PRIMARY_LABEL.to_owned()]
    );
    assert!(
        model.poll_cursor(outside, true).pressed_outside.is_empty(),
        "holding the button is not a second press"
    );
    assert!(model.poll_cursor(outside, false).pressed_outside.is_empty());
    assert!(
        model
            .poll_cursor(over_strip, true)
            .pressed_outside
            .is_empty(),
        "a press on the strip reaches the UI directly"
    );
    model.poll_cursor(over_strip, false);
    assert_eq!(
        model.poll_cursor(outside, true).pressed_outside,
        vec![PRIMARY_LABEL.to_owned()],
        "released and pressed again"
    );
}

#[test]
fn press_outside_is_reported_per_window_on_two_monitors() {
    let (platform, mut model, now) = ready_model(ShellSettings::default());
    model.plan_reconcile(&platform, vec![primary(), secondary()], now);
    model.attach(&platform, "notch-1", SECOND_HWND, secondary(), now);
    model.window_ready(&platform, "notch-1", now);
    let strip = ShapeRect {
        x: 465,
        y: 0,
        width: 190,
        height: 32,
    };
    model.publish_shapes(&platform, PRIMARY_LABEL, &[strip], now);
    model.publish_shapes(&platform, "notch-1", &[strip], now);

    // A click on the primary strip closes the secondary's panel but not the primary's.
    model.poll_cursor((720 + 560, 10), false);
    assert_eq!(
        model.poll_cursor((720 + 560, 10), true).pressed_outside,
        vec!["notch-1".to_owned()]
    );
    model.poll_cursor((720 + 560, 10), false);
    // A click on the desktop is outside both.
    assert_eq!(
        model.poll_cursor((3000, 900), true).pressed_outside,
        vec![PRIMARY_LABEL.to_owned(), "notch-1".to_owned()]
    );
}

/// While a window publishes more than the strip (revealed, open or morphing) the poll runs at
/// the active rate wherever the cursor is, so a click anywhere lands within one 16 ms tick.
#[test]
fn cursor_poll_stays_active_while_the_panel_is_open() {
    let (platform, mut model, now) = ready_model(ShellSettings::default());
    let strip = ShapeRect {
        x: 465,
        y: 0,
        width: 190,
        height: 32,
    };
    let span = ShapeRect {
        x: 180,
        y: 0,
        width: 760,
        height: 240,
    };
    let far_away = (10, 1400);
    model.publish_shapes(&platform, PRIMARY_LABEL, &[strip], now);
    assert_eq!(model.poll_cursor(far_away, false).rate, PollRate::Idle);
    model.publish_shapes(&platform, PRIMARY_LABEL, &[strip, span], now);
    assert_eq!(model.poll_cursor(far_away, false).rate, PollRate::Active);
    model.publish_shapes(&platform, PRIMARY_LABEL, &[strip], now);
    assert_eq!(model.poll_cursor(far_away, false).rate, PollRate::Idle);
}
