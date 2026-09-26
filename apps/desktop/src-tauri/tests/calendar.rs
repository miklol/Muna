//! The `calendar` module against `FakePlatform` (its scripted vault) and scripted feeds
//! (docs/modules/calendar.md acceptance criteria, docs/build-plan/m3-daily-modules.md E1).
//! Integration tests because the `muna` lib cannot host unit tests (Common Controls manifest
//! on Tauri-linked tests).
//!
//! The service is a reducer: the tests call `plan` and hand the outcome to `complete_fetch` in
//! place of the backend loop, so every branch runs without a network or a runtime.

use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use chrono::{DateTime, TimeZone, Utc};
use muna_core::{
    Clock, FakeClock, Glyph, Hub, Leading, Settings, Store, StripContent, StripMessage, StripSink,
    Tint, Trailing, activities::priority,
};
use muna_lib::modules::calendar::fetch::looks_like_calendar;
use muna_lib::modules::calendar::ics::{
    self, MAX_OCCURRENCES_PER_EVENT, events, is_meeting_url, moment_of, parse_duration, parse_line,
    unescape_text, unfold, urls_in, zone,
};
use muna_lib::modules::calendar::settings::{
    DEFAULT_REFRESH_MINUTES, MAX_NAME_CHARS, REFRESH_CHOICES_MINUTES, trim_name,
};
use muna_lib::modules::calendar::{
    AddSourceError, CalendarCommand, CalendarService, CalendarSettings, CalendarSink,
    CalendarSnapshot, FeedError, GRACE, ID, Job, LEAD, NEXT_ACTIVITY_ID, RETRY_BASE, STARTING_LEAD,
    SourceSetting, SourceStatus, UrlError, backoff, cache_key, normalise_url, secret_key,
    starting_notice_id, window_of,
};
use muna_lib::modules::{ModuleServices, Surface, backends};
use muna_platform::{FakePlatform, Platform};
use parking_lot::Mutex;

const START_SECS: u64 = 1_700_000_000;

#[derive(Default)]
struct Recorder {
    snapshots: Mutex<Vec<CalendarSnapshot>>,
    strip: Mutex<Vec<StripContent>>,
}

impl CalendarSink for Recorder {
    fn changed(&self, snapshot: &CalendarSnapshot) {
        self.snapshots.lock().push(snapshot.clone());
    }
}

impl StripSink for Recorder {
    fn strip_changed(&self, content: &StripContent) {
        self.strip.lock().push(content.clone());
    }
}

struct Rig {
    clock: Arc<FakeClock>,
    platform: Arc<FakePlatform>,
    hub: Arc<Hub>,
    store: Arc<Store>,
    service: Arc<CalendarService>,
    recorder: Arc<Recorder>,
}

impl Rig {
    fn new() -> Self {
        Self::with_store_at(
            Arc::new(Store::open_in_memory().expect("store")),
            Duration::ZERO,
        )
    }

    /// A fresh service over an existing store, `later` after the usual start: "the next launch".
    fn with_store_at(store: Arc<Store>, later: Duration) -> Self {
        let clock = Arc::new(FakeClock::at(
            UNIX_EPOCH + Duration::from_secs(START_SECS) + later,
        ));
        let platform = Arc::new(FakePlatform::new());
        let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
        let service = Arc::new(CalendarService::new(
            Arc::clone(&store),
            Arc::clone(&clock) as Arc<dyn Clock>,
            Arc::clone(&hub),
            Arc::clone(&platform) as Arc<dyn Platform>,
        ));
        let recorder = Arc::new(Recorder::default());
        service.set_sink(Arc::clone(&recorder) as Arc<dyn CalendarSink>);
        hub.add_sink(Arc::clone(&recorder) as Arc<dyn StripSink>);
        // What the backend loop does first.
        service.evaluate();
        Self {
            clock,
            platform,
            hub,
            store,
            service,
            recorder,
        }
    }

    fn apply(&self, settings: &CalendarSettings) {
        let mut document = Settings::default();
        settings.write(&mut document).expect("settings serialise");
        self.service.apply_settings(&document);
    }

    /// Adds a source the way the IPC layer does: vault first, then the settings.
    fn subscribe(&self, name: &str, url: &str, color: Tint) -> SourceSetting {
        let source = self
            .service
            .add_source(name, url, color)
            .expect("source accepted");
        let mut settings = self.service.settings();
        settings.sources.push(source.clone());
        self.apply(&settings);
        source
    }

    fn now_ms(&self) -> i64 {
        i64::try_from(
            self.clock
                .system_time()
                .duration_since(UNIX_EPOCH)
                .expect("after the epoch")
                .as_millis(),
        )
        .expect("fits")
    }

    /// Lets time pass and evaluates the way the loop would when its sleep ends.
    fn pass(&self, by: Duration) {
        self.clock.advance(by);
        self.hub.refresh();
        self.service.evaluate();
    }

    /// What the backend loop does for a `Fetch`: hand the scripted body over.
    fn fetch(&self, result: Result<&str, FeedError>) -> String {
        let Some(Job::Fetch { source_id }) = self.service.plan() else {
            panic!("a fetch is due");
        };
        self.service
            .complete_fetch(&source_id, result.map(str::to_owned));
        source_id
    }

    fn snapshot(&self) -> CalendarSnapshot {
        self.service.snapshot()
    }

    fn source_status(&self, id: &str) -> SourceStatus {
        self.snapshot()
            .sources
            .into_iter()
            .find(|source| source.id == id)
            .expect("source listed")
            .status
    }

    fn strip_activity(&self) -> Option<muna_core::Activity> {
        self.hub
            .activities()
            .into_iter()
            .map(|held| held.activity)
            .find(|activity| activity.id == NEXT_ACTIVITY_ID)
    }

    /// Every notice the strip showed for `event_id`, in order.
    fn notices_for(&self, event_id: &str) -> Vec<muna_core::Notice> {
        let id = starting_notice_id(event_id);
        self.recorder
            .strip
            .lock()
            .iter()
            .filter_map(|content| match content {
                StripContent::Notice { notice } if notice.id == id => Some(notice.clone()),
                _ => None,
            })
            .collect()
    }
}

fn ms(duration: Duration) -> i64 {
    i64::try_from(duration.as_millis()).expect("fits")
}

fn utc(ms: i64) -> DateTime<Utc> {
    Utc.timestamp_millis_opt(ms)
        .single()
        .expect("valid instant")
}

fn stamp(ms: i64) -> String {
    utc(ms).format("%Y%m%dT%H%M%SZ").to_string()
}

/// A minimal feed with the given `VEVENT` bodies.
fn feed(events: &[String]) -> String {
    let mut text = String::from(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Muna tests//EN\r\n\
         BEGIN:VTIMEZONE\r\nTZID:Europe/Berlin\r\nBEGIN:STANDARD\r\nTZOFFSETFROM:+0200\r\n\
         TZOFFSETTO:+0100\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n",
    );
    for event in events {
        text.push_str("BEGIN:VEVENT\r\n");
        text.push_str(event);
        text.push_str("END:VEVENT\r\n");
    }
    text.push_str("END:VCALENDAR\r\n");
    text
}

/// A timed event `uid` starting `start_ms` and lasting `length`, plus extra lines.
fn timed(uid: &str, title: &str, start_ms: i64, length: Duration, extra: &str) -> String {
    format!(
        "UID:{uid}\r\nSUMMARY:{title}\r\nDTSTART:{}\r\nDTEND:{}\r\n{extra}",
        stamp(start_ms),
        stamp(start_ms + ms(length))
    )
}

fn line(text: &str) -> ics::ContentLine {
    parse_line(text).expect("line parses")
}

// --- content lines -----------------------------------------------------------------------------

#[test]
fn folded_lines_are_joined_and_blank_ones_dropped() {
    let text =
        "BEGIN:VEVENT\r\nDESCRIPTION:first part\r\n  second part\r\n\tthird\r\n\r\nEND:VEVENT\r\n";
    assert_eq!(
        unfold(text),
        vec![
            "BEGIN:VEVENT".to_owned(),
            "DESCRIPTION:first part second partthird".to_owned(),
            "END:VEVENT".to_owned(),
        ]
    );
}

#[test]
fn a_content_line_splits_name_parameters_and_value() {
    let parsed = line("ATTENDEE;CN=\"Doe, Jane\";role=REQ-PARTICIPANT:mailto:jane@example.test");
    assert_eq!(parsed.name, "ATTENDEE");
    assert_eq!(parsed.param("cn"), Some("Doe, Jane"));
    assert_eq!(parsed.param("ROLE"), Some("REQ-PARTICIPANT"));
    assert_eq!(parsed.value, "mailto:jane@example.test");
    assert!(parse_line("no colon here").is_none());
    assert!(parse_line(":value without a name").is_none());
}

#[test]
fn text_escapes_are_undone() {
    assert_eq!(
        unescape_text("Lunch\\, then coffee\\; notes:\\nline two \\\\ done"),
        "Lunch, then coffee; notes:\nline two \\ done"
    );
    assert_eq!(unescape_text("trailing\\"), "trailing\\");
}

#[test]
fn only_events_are_collected_and_alarms_inside_them_are_skipped() {
    let text = feed(&[
        "UID:a\r\nSUMMARY:With alarm\r\nDTSTART:20231115T100000Z\r\n\
         BEGIN:VALARM\r\nTRIGGER:-PT10M\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\n"
            .to_owned(),
    ]);
    let found = events(&text);
    assert_eq!(found.len(), 1);
    let event = &found[0];
    assert_eq!(event.text("SUMMARY").as_deref(), Some("With alarm"));
    assert!(
        event.first("TRIGGER").is_none() && event.first("ACTION").is_none(),
        "alarm properties do not leak into the event"
    );
    assert!(
        event.first("TZID").is_none(),
        "the VTIMEZONE is not an event"
    );
}

// --- moments -------------------------------------------------------------------------------------

#[test]
fn utc_and_zoned_times_resolve_to_the_same_instant() {
    let zulu = moment_of(&line("DTSTART:20231115T100000Z")).expect("parses");
    let berlin = moment_of(&line("DTSTART;TZID=Europe/Berlin:20231115T110000")).expect("parses");
    let outlook = moment_of(&line(
        "DTSTART;TZID=W. Europe Standard Time:20231115T110000",
    ))
    .expect("parses");
    let expected = Utc
        .with_ymd_and_hms(2023, 11, 15, 10, 0, 0)
        .single()
        .unwrap()
        .timestamp_millis();
    assert_eq!(zulu.ms, expected);
    assert_eq!(berlin.ms, expected, "TZID applies");
    assert_eq!(outlook.ms, expected, "Windows zone names map to IANA");
    assert!(!zulu.all_day);
}

#[test]
fn dates_are_all_day_at_local_midnight() {
    let dated = moment_of(&line("DTSTART;VALUE=DATE:20231115")).expect("parses");
    let bare = moment_of(&line("DTSTART:20231115")).expect("parses");
    assert!(dated.all_day && bare.all_day);
    assert_eq!(dated.ms, bare.ms);
    let local = chrono::Local
        .timestamp_millis_opt(dated.ms)
        .single()
        .expect("valid");
    assert_eq!(
        local.format("%Y-%m-%d %H:%M").to_string(),
        "2023-11-15 00:00"
    );
}

#[test]
fn unknown_zones_fall_back_to_the_machine_zone() {
    let floating = moment_of(&line("DTSTART:20231115T110000")).expect("parses");
    let unknown = moment_of(&line("DTSTART;TZID=Mars/Olympus:20231115T110000")).expect("parses");
    assert_eq!(unknown.ms, floating.ms);
    assert!(zone("Mars/Olympus").is_none());
    assert_eq!(
        zone("/freeassociation.sourceforge.net/Europe/Rome").map(chrono_tz::Tz::name),
        Some("Europe/Rome"),
        "a path ending in an IANA name is that zone"
    );
    assert!(moment_of(&line("DTSTART:not-a-date")).is_none());
}

#[test]
fn durations_parse_per_rfc_5545() {
    assert_eq!(parse_duration("P1D"), Some(chrono::TimeDelta::days(1)));
    assert_eq!(
        parse_duration("PT1H30M"),
        Some(chrono::TimeDelta::minutes(90))
    );
    assert_eq!(parse_duration("-P1W"), Some(chrono::TimeDelta::weeks(-1)));
    assert_eq!(
        parse_duration("P2DT3H4M5S"),
        Some(chrono::TimeDelta::seconds(
            2 * 86_400 + 3 * 3600 + 4 * 60 + 5
        ))
    );
    assert_eq!(parse_duration("1H"), None);
    assert_eq!(parse_duration("P1X"), None);
    assert_eq!(parse_duration("PT1"), None);
}

// --- expansion -----------------------------------------------------------------------------------

#[test]
fn a_single_event_yields_one_occurrence_inside_the_window() {
    let now = i64::try_from(START_SECS * 1000).unwrap();
    let start = now + ms(Duration::from_hours(2));
    let text = feed(&[timed(
        "one",
        "Design review",
        start,
        Duration::from_mins(45),
        "LOCATION:Room 4\\, second floor\r\n",
    )]);
    let (from, to) = window_of(now);
    let found = ics::expand(&text, from, to);
    assert_eq!(found.len(), 1);
    let occurrence = &found[0];
    assert_eq!(occurrence.uid, "one");
    assert_eq!(occurrence.title, "Design review");
    assert_eq!(occurrence.location.as_deref(), Some("Room 4, second floor"));
    assert_eq!(occurrence.start_ms, start);
    assert_eq!(occurrence.end_ms, start + ms(Duration::from_mins(45)));
    assert!(!occurrence.all_day && !occurrence.is_meeting);
    assert_eq!(occurrence.link, None);
    assert!(
        ics::expand(&text, to, to + 1).is_empty(),
        "outside the window nothing is returned"
    );
}

#[test]
fn a_weekly_rule_expands_with_exceptions_and_an_override() {
    // 2023-11-15 10:00 UTC (Wednesday), weekly, four times, second instance dropped, third
    // moved an hour later with a new title.
    let text = feed(&[
        "UID:weekly\r\nSUMMARY:Standup\r\nDTSTART:20231115T100000Z\r\nDTEND:20231115T101500Z\r\n\
         RRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE:20231122T100000Z\r\n"
            .to_owned(),
        "UID:weekly\r\nRECURRENCE-ID:20231129T100000Z\r\nSUMMARY:Standup (moved)\r\n\
         DTSTART:20231129T110000Z\r\nDTEND:20231129T111500Z\r\n"
            .to_owned(),
    ]);
    let from = Utc
        .with_ymd_and_hms(2023, 11, 1, 0, 0, 0)
        .single()
        .unwrap()
        .timestamp_millis();
    let to = Utc
        .with_ymd_and_hms(2024, 1, 1, 0, 0, 0)
        .single()
        .unwrap()
        .timestamp_millis();
    let found = ics::expand(&text, from, to);
    let starts: Vec<String> = found.iter().map(|o| stamp(o.start_ms)).collect();
    assert_eq!(
        starts,
        vec!["20231115T100000Z", "20231129T110000Z", "20231206T100000Z"],
        "count 4, minus the EXDATE, with the override in place of its instance"
    );
    assert_eq!(found[1].title, "Standup (moved)");
    assert_eq!(
        found[1].end_ms - found[1].start_ms,
        ms(Duration::from_mins(15))
    );
    assert!(
        found
            .iter()
            .all(|o| o.end_ms - o.start_ms == ms(Duration::from_mins(15))),
        "each instance keeps the master's length"
    );
}

#[test]
fn a_cancelled_override_removes_its_instance_and_a_cancelled_master_everything() {
    let text = feed(&[
        "UID:daily\r\nSUMMARY:Daily\r\nDTSTART:20231115T090000Z\r\nDTEND:20231115T093000Z\r\n\
         RRULE:FREQ=DAILY;COUNT=3\r\n"
            .to_owned(),
        "UID:daily\r\nRECURRENCE-ID:20231116T090000Z\r\nSTATUS:CANCELLED\r\n\
         DTSTART:20231116T090000Z\r\nDTEND:20231116T093000Z\r\n"
            .to_owned(),
        "UID:gone\r\nSUMMARY:Gone\r\nSTATUS:CANCELLED\r\nDTSTART:20231117T090000Z\r\n".to_owned(),
    ]);
    let from = Utc
        .with_ymd_and_hms(2023, 11, 1, 0, 0, 0)
        .single()
        .unwrap()
        .timestamp_millis();
    let found = ics::expand(&text, from, from + ms(Duration::from_hours(24 * 60)));
    let starts: Vec<String> = found.iter().map(|o| stamp(o.start_ms)).collect();
    assert_eq!(starts, vec!["20231115T090000Z", "20231117T090000Z"]);
    assert!(found.iter().all(|o| o.uid == "daily"));
}

#[test]
fn all_day_events_span_whole_local_days_and_default_to_one() {
    let text = feed(&[
        "UID:trip\r\nSUMMARY:Offsite\r\nDTSTART;VALUE=DATE:20231120\r\nDTEND;VALUE=DATE:20231122\r\n"
            .to_owned(),
        "UID:holiday\r\nSUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20231124\r\n".to_owned(),
    ]);
    let from = moment_of(&line("DTSTART;VALUE=DATE:20231101")).unwrap().ms;
    let to = moment_of(&line("DTSTART;VALUE=DATE:20231201")).unwrap().ms;
    let found = ics::expand(&text, from, to);
    assert_eq!(found.len(), 2);
    let trip = &found[0];
    assert!(trip.all_day);
    assert_eq!(
        trip.start_ms,
        moment_of(&line("DTSTART:20231120")).unwrap().ms
    );
    assert_eq!(
        trip.end_ms,
        moment_of(&line("DTSTART:20231122")).unwrap().ms
    );
    let holiday = &found[1];
    assert_eq!(
        holiday.end_ms,
        moment_of(&line("DTSTART:20231125")).unwrap().ms,
        "a date without an end lasts one day"
    );
}

#[test]
fn a_recurring_all_day_event_keeps_its_length_per_instance() {
    let text = feed(&[
        "UID:weekend\r\nSUMMARY:Retreat\r\nDTSTART;VALUE=DATE:20231118\r\n\
         DTEND;VALUE=DATE:20231120\r\nRRULE:FREQ=WEEKLY;COUNT=2\r\n"
            .to_owned(),
    ]);
    let from = moment_of(&line("DTSTART;VALUE=DATE:20231101")).unwrap().ms;
    let to = moment_of(&line("DTSTART;VALUE=DATE:20231201")).unwrap().ms;
    let found = ics::expand(&text, from, to);
    assert_eq!(found.len(), 2);
    assert_eq!(
        found[1].start_ms,
        moment_of(&line("DTSTART:20231125")).unwrap().ms
    );
    assert_eq!(
        found[1].end_ms,
        moment_of(&line("DTSTART:20231127")).unwrap().ms
    );
}

#[test]
fn a_running_multi_day_event_that_began_before_the_window_is_kept() {
    let text = feed(&[
        "UID:long\r\nSUMMARY:Conference\r\nDTSTART:20231113T080000Z\r\n\
         DTEND:20231117T170000Z\r\n"
            .to_owned(),
    ]);
    let from = Utc
        .with_ymd_and_hms(2023, 11, 15, 0, 0, 0)
        .single()
        .unwrap()
        .timestamp_millis();
    let found = ics::expand(&text, from, from + ms(Duration::from_hours(24)));
    assert_eq!(found.len(), 1, "it overlaps the window");
}

#[test]
fn a_rule_that_cannot_be_read_keeps_the_first_instance() {
    let text = feed(&["UID:odd\r\nSUMMARY:Odd\r\nDTSTART:20231115T100000Z\r\n\
         DTEND:20231115T110000Z\r\nRRULE:FREQ=SOMETIMES\r\n"
        .to_owned()]);
    let from = Utc
        .with_ymd_and_hms(2023, 11, 1, 0, 0, 0)
        .single()
        .unwrap()
        .timestamp_millis();
    let found = ics::expand(&text, from, from + ms(Duration::from_hours(24 * 60)));
    assert_eq!(found.len(), 1);
    assert_eq!(stamp(found[0].start_ms), "20231115T100000Z");
}

#[test]
fn a_runaway_rule_is_cut_at_the_occurrence_limit() {
    let text = feed(&["UID:spam\r\nSUMMARY:Ping\r\nDTSTART:20231101T000000Z\r\n\
         DTEND:20231101T000100Z\r\nRRULE:FREQ=MINUTELY\r\n"
        .to_owned()]);
    let from = Utc
        .with_ymd_and_hms(2023, 11, 1, 0, 0, 0)
        .single()
        .unwrap()
        .timestamp_millis();
    let found = ics::expand(&text, from, from + ms(Duration::from_hours(24 * 60)));
    assert_eq!(found.len(), usize::from(MAX_OCCURRENCES_PER_EVENT));
}

#[test]
fn events_without_a_uid_are_still_kept_apart() {
    let text = feed(&[
        "SUMMARY:First\r\nDTSTART:20231115T100000Z\r\n".to_owned(),
        "SUMMARY:Second\r\nDTSTART:20231115T110000Z\r\n".to_owned(),
    ]);
    let from = Utc
        .with_ymd_and_hms(2023, 11, 1, 0, 0, 0)
        .single()
        .unwrap()
        .timestamp_millis();
    let found = ics::expand(&text, from, from + ms(Duration::from_hours(24 * 60)));
    assert_eq!(found.len(), 2);
    assert_ne!(found[0].uid, found[1].uid);
}

// --- meeting links -------------------------------------------------------------------------------

#[test]
fn meeting_hosts_are_recognised_and_others_are_not() {
    assert!(is_meeting_url(
        "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0"
    ));
    assert!(is_meeting_url("https://meet.google.com/abc-defg-hij"));
    assert!(is_meeting_url("https://company.zoom.us/j/123456789?pwd=x"));
    assert!(is_meeting_url("https://company.webex.com/meet/jane"));
    assert!(!is_meeting_url("https://example.test/agenda"));
    assert!(!is_meeting_url("ftp://zoom.us/j/1"));
    assert!(!is_meeting_url("https://notzoom.us/j/1"));
    assert!(!is_meeting_url("zoom.us/j/1"));
}

#[test]
fn urls_are_lifted_out_of_free_text() {
    assert_eq!(
        urls_in("Join at https://meet.google.com/abc-defg-hij. Agenda: <https://example.test/a>"),
        vec![
            "https://meet.google.com/abc-defg-hij".to_owned(),
            "https://example.test/a".to_owned(),
        ]
    );
    assert!(urls_in("no links, just http mentioned").is_empty());
}

#[test]
fn the_link_prefers_a_conferencing_property_then_url_then_the_text() {
    let cases: [(&str, Option<&str>, bool); 5] = [
        (
            "X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/abc\r\n\
             URL:https://example.test/plain\r\n",
            Some("https://teams.microsoft.com/l/meetup-join/abc"),
            true,
        ),
        (
            "X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij\r\n",
            Some("https://meet.google.com/abc-defg-hij"),
            true,
        ),
        (
            "URL:https://company.zoom.us/j/123\r\n",
            Some("https://company.zoom.us/j/123"),
            true,
        ),
        (
            "URL:https://example.test/agenda\r\nLOCATION:Zoom https://zoom.us/j/999\r\n",
            Some("https://zoom.us/j/999"),
            true,
        ),
        (
            "URL:https://example.test/agenda\r\nDESCRIPTION:Bring notes\r\n",
            Some("https://example.test/agenda"),
            false,
        ),
    ];
    for (extra, link, meeting) in cases {
        let text = feed(&[format!(
            "UID:x\r\nSUMMARY:Sync\r\nDTSTART:20231115T100000Z\r\nDTEND:20231115T103000Z\r\n{extra}"
        )]);
        let event = &events(&text)[0];
        assert_eq!(
            ics::link_of(event),
            (link.map(str::to_owned), meeting),
            "{extra}"
        );
    }
}

// --- settings ------------------------------------------------------------------------------------

#[test]
fn settings_default_to_no_sources_and_the_documented_options() {
    let settings = CalendarSettings::from_document(&Settings::default());
    assert_eq!(settings, CalendarSettings::default());
    assert!(settings.sources.is_empty(), "network is opt-in");
    assert_eq!(settings.refresh_minutes, DEFAULT_REFRESH_MINUTES);
    assert!(REFRESH_CHOICES_MINUTES.contains(&settings.refresh_minutes));
    assert!(settings.show_next_in_strip && settings.notices);
    assert_eq!(settings.refresh(), Duration::from_mins(5));
}

#[test]
fn settings_round_trip_without_the_address() {
    let settings = CalendarSettings {
        sources: vec![SourceSetting {
            id: "abc".into(),
            name: "Work".into(),
            color: Tint::Purple,
            enabled: false,
            host: "outlook.office365.com".into(),
        }],
        refresh_minutes: 30,
        show_next_in_strip: false,
        notices: true,
    };
    let mut document = Settings::default();
    settings.write(&mut document).unwrap();
    let json = &document.modules[ID];
    assert_eq!(json["sources"][0]["color"], "purple");
    assert_eq!(json["sources"][0]["host"], "outlook.office365.com");
    assert!(
        json["sources"][0].get("url").is_none(),
        "the address never enters the settings document"
    );
    assert_eq!(json["refreshMinutes"], 30);
    assert_eq!(CalendarSettings::from_document(&document), settings);
}

#[test]
fn settings_repair_what_a_hand_edited_file_breaks() {
    let mut document = Settings::default();
    document.modules.insert(
        ID.into(),
        serde_json::json!({
            "sources": [
                { "id": "a", "name": "   ", "color": "blue", "enabled": true, "host": "h.test" },
                { "id": "a", "name": "Dup", "color": "blue", "enabled": true, "host": "h.test" },
                { "id": " ", "name": "Blank id", "color": "red", "enabled": true, "host": "x" },
                { "id": "b", "name": "  Padded  ", "color": "green", "enabled": false, "host": "g" }
            ],
            "refreshMinutes": 7,
            "unknown": true
        }),
    );
    let settings = CalendarSettings::from_document(&document);
    assert_eq!(settings.refresh_minutes, DEFAULT_REFRESH_MINUTES);
    assert_eq!(settings.sources.len(), 2);
    assert_eq!(
        settings.sources[0].name, "h.test",
        "a blank name shows the host"
    );
    assert_eq!(settings.sources[1].name, "Padded");
    document
        .modules
        .insert(ID.into(), serde_json::json!("junk"));
    assert_eq!(
        CalendarSettings::from_document(&document),
        CalendarSettings::default()
    );
}

#[test]
fn names_are_trimmed_and_capped() {
    assert_eq!(trim_name("  Team  "), "Team");
    assert_eq!(trim_name(&"x".repeat(200)).chars().count(), MAX_NAME_CHARS);
}

// --- addresses -----------------------------------------------------------------------------------

#[test]
fn addresses_are_normalised_and_the_host_reported() {
    assert_eq!(
        normalise_url(" webcal://calendar.example.test/feed.ics#frag "),
        Ok((
            "https://calendar.example.test/feed.ics".to_owned(),
            "calendar.example.test".to_owned()
        ))
    );
    assert_eq!(
        normalise_url("http://intranet/cal.ics?token=abc"),
        Ok((
            "http://intranet/cal.ics?token=abc".to_owned(),
            "intranet".to_owned()
        ))
    );
    assert_eq!(normalise_url("not a link"), Err(UrlError::Malformed));
    assert_eq!(
        normalise_url("ftp://example.test/cal.ics"),
        Err(UrlError::Scheme)
    );
    assert_eq!(
        normalise_url("https://user:pw@example.test/cal.ics"),
        Err(UrlError::Credentials)
    );
}

#[test]
fn a_body_must_be_a_calendar() {
    assert!(looks_like_calendar("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
    assert!(looks_like_calendar("\u{feff}begin:vcalendar\n"));
    assert!(!looks_like_calendar("<!doctype html><html>Sign in</html>"));
    assert!(!looks_like_calendar(""));
}

// --- sources and the vault -----------------------------------------------------------------------

#[test]
fn adding_a_source_stores_the_address_in_the_vault_only() {
    let rig = Rig::new();
    let source = rig
        .service
        .add_source(
            "  ",
            "webcal://cal.example.test/p/secret-token.ics",
            Tint::Green,
        )
        .expect("accepted");
    assert_eq!(
        source.name, "cal.example.test",
        "a blank name shows the host"
    );
    assert_eq!(source.host, "cal.example.test");
    assert_eq!(source.color, Tint::Green);
    assert!(source.enabled);
    assert_eq!(
        rig.platform.secret(&secret_key(&source.id)).as_deref(),
        Some("https://cal.example.test/p/secret-token.ics")
    );
    assert_eq!(rig.platform.secret_keys().len(), 1);
    assert!(
        rig.service.settings().sources.is_empty(),
        "the settings entry is the caller's to add"
    );
    let second = rig
        .service
        .add_source("Other", "https://cal.example.test/p/other.ics", Tint::Blue)
        .expect("accepted");
    assert_ne!(second.id, source.id);
}

#[test]
fn a_bad_address_or_a_closed_vault_adds_nothing() {
    let rig = Rig::new();
    assert_eq!(
        rig.service.add_source("X", "mailto:a@b.test", Tint::Blue),
        Err(AddSourceError::Url(UrlError::Scheme))
    );
    rig.platform.set_secrets_unavailable(true);
    assert_eq!(
        rig.service
            .add_source("X", "https://cal.example.test/f.ics", Tint::Blue),
        Err(AddSourceError::Vault)
    );
    rig.platform.set_secrets_unavailable(false);
    assert!(rig.platform.secret_keys().is_empty());
}

#[test]
fn removing_a_source_forgets_its_secret_and_its_cache() {
    let rig = Rig::new();
    let source = rig.subscribe("Work", "https://cal.example.test/w.ics", Tint::Blue);
    let now = rig.now_ms();
    let text = feed(&[timed(
        "e1",
        "Planning",
        now + ms(Duration::from_hours(3)),
        Duration::from_hours(1),
        "",
    )]);
    rig.fetch(Ok(&text));
    assert!(
        rig.store
            .get_meta(&cache_key(&source.id))
            .unwrap()
            .is_some(),
        "the feed is cached"
    );
    assert_eq!(rig.snapshot().events.len(), 1);

    let mut settings = rig.service.settings();
    settings.sources.clear();
    rig.apply(&settings);
    rig.service
        .remove_source_secret(&source.id)
        .expect("vault removal");

    assert!(rig.snapshot().sources.is_empty());
    assert!(rig.snapshot().events.is_empty());
    assert!(
        rig.store
            .get_meta(&cache_key(&source.id))
            .unwrap()
            .is_none()
    );
    assert!(rig.platform.secret_keys().is_empty());
    assert_eq!(rig.service.plan(), None, "nothing left to fetch");
}

// --- fetching ------------------------------------------------------------------------------------

#[test]
fn nothing_is_fetched_until_a_source_exists() {
    let rig = Rig::new();
    assert_eq!(rig.service.plan(), None);
    assert_eq!(rig.service.next_wake(), None, "sleeps until woken");
    let snapshot = rig.snapshot();
    assert!(snapshot.sources.is_empty() && snapshot.events.is_empty());
    assert!(!snapshot.offline);
    assert_eq!(
        snapshot.window_end_ms - snapshot.window_start_ms,
        ms(Duration::from_hours(120 * 24))
    );
}

#[test]
fn a_new_source_is_fetched_at_once_and_then_on_the_refresh_period() {
    let rig = Rig::new();
    let source = rig.subscribe("Work", "https://cal.example.test/w.ics", Tint::Orange);
    assert_eq!(rig.source_status(&source.id), SourceStatus::Idle);
    assert_eq!(rig.service.next_wake(), Some(Duration::ZERO), "due now");

    let now = rig.now_ms();
    let text = feed(&[
        timed(
            "e1",
            "Planning",
            now + ms(Duration::from_hours(3)),
            Duration::from_hours(1),
            "",
        ),
        timed(
            "e0",
            "Earlier",
            now + ms(Duration::from_hours(2)),
            Duration::from_mins(30),
            "",
        ),
    ]);
    let fetched = rig.fetch(Ok(&text));
    assert_eq!(fetched, source.id);
    assert_eq!(
        rig.recorder
            .snapshots
            .lock()
            .iter()
            .filter(|s| s
                .sources
                .first()
                .is_some_and(|s| s.status == SourceStatus::Fetching))
            .count(),
        1,
        "the sink saw the in-flight state"
    );

    let snapshot = rig.snapshot();
    assert_eq!(snapshot.sources[0].status, SourceStatus::Ok);
    assert_eq!(snapshot.sources[0].fetched_at_ms, Some(now));
    assert_eq!(snapshot.sources[0].event_count, 2);
    assert_eq!(
        snapshot
            .events
            .iter()
            .map(|e| e.title.as_str())
            .collect::<Vec<_>>(),
        vec!["Earlier", "Planning"],
        "chronological"
    );
    assert_eq!(snapshot.events[0].source_id, source.id);
    assert_eq!(
        snapshot.events[0].id,
        format!("{}:e0:{}", source.id, now + ms(Duration::from_hours(2)))
    );
    assert!(!snapshot.offline);
    assert_eq!(
        rig.service.next_wake(),
        Some(Duration::from_mins(5)),
        "the refresh period, sooner than any strip boundary"
    );
    assert_eq!(rig.service.plan(), None, "not due yet");
    rig.pass(Duration::from_mins(5));
    assert_eq!(rig.service.next_wake(), Some(Duration::ZERO));
    assert!(matches!(rig.service.plan(), Some(Job::Fetch { source_id }) if source_id == source.id));
}

#[test]
fn a_failed_fetch_backs_off_and_keeps_the_old_events() {
    let rig = Rig::new();
    let source = rig.subscribe("Work", "https://cal.example.test/w.ics", Tint::Blue);
    let now = rig.now_ms();
    let text = feed(&[timed(
        "e1",
        "Planning",
        now + ms(Duration::from_hours(3)),
        Duration::from_hours(1),
        "",
    )]);
    rig.fetch(Ok(&text));
    rig.pass(Duration::from_mins(5));

    rig.fetch(Err(FeedError::Offline));
    let snapshot = rig.snapshot();
    assert_eq!(
        snapshot.sources[0].status,
        SourceStatus::Error {
            error: FeedError::Offline
        }
    );
    assert!(snapshot.offline);
    assert_eq!(snapshot.events.len(), 1, "the cached events stand");
    assert_eq!(
        snapshot.sources[0].fetched_at_ms,
        Some(now),
        "with their time"
    );
    assert_eq!(rig.service.next_wake(), Some(RETRY_BASE));

    rig.pass(RETRY_BASE);
    rig.fetch(Err(FeedError::Invalid));
    assert_eq!(rig.service.next_wake(), Some(RETRY_BASE * 2));
    assert!(
        !rig.snapshot().offline,
        "an answer, however odd, is not offline"
    );

    rig.pass(RETRY_BASE * 2);
    rig.fetch(Err(FeedError::Refused));
    rig.pass(RETRY_BASE * 4);
    rig.fetch(Err(FeedError::Refused));
    assert_eq!(
        rig.service.next_wake(),
        Some(Duration::from_mins(5)),
        "capped at the refresh period"
    );
    assert_eq!(
        rig.source_status(&source.id),
        SourceStatus::Error {
            error: FeedError::Refused
        }
    );

    rig.pass(Duration::from_mins(5));
    rig.fetch(Ok(&text));
    assert_eq!(rig.source_status(&source.id), SourceStatus::Ok);
    assert_eq!(rig.service.next_wake(), Some(Duration::from_mins(5)));
}

#[test]
fn backoff_doubles_from_a_minute_up_to_the_refresh_period() {
    let refresh = Duration::from_mins(60);
    assert_eq!(backoff(1, refresh), Duration::from_mins(1));
    assert_eq!(backoff(2, refresh), Duration::from_mins(2));
    assert_eq!(backoff(4, refresh), Duration::from_mins(8));
    assert_eq!(backoff(7, refresh), refresh);
    assert_eq!(backoff(40, refresh), refresh);
    assert_eq!(backoff(3, Duration::from_mins(5)), Duration::from_mins(4));
    assert_eq!(backoff(4, Duration::from_mins(5)), Duration::from_mins(5));
}

#[test]
fn refresh_fetches_now_whatever_the_schedule_says() {
    let rig = Rig::new();
    rig.subscribe("Work", "https://cal.example.test/w.ics", Tint::Blue);
    let text = feed(&[]);
    rig.fetch(Ok(&text));
    assert_eq!(rig.service.plan(), None);
    rig.service.command(CalendarCommand::Refresh);
    assert_eq!(rig.service.next_wake(), Some(Duration::ZERO));
    assert!(rig.service.plan().is_some());
    rig.fetch_in_flight_completes(&text);
}

impl Rig {
    /// Completes whatever `plan` last marked in flight.
    fn fetch_in_flight_completes(&self, text: &str) {
        let fetching: Vec<String> = self
            .snapshot()
            .sources
            .into_iter()
            .filter(|source| source.status == SourceStatus::Fetching)
            .map(|source| source.id)
            .collect();
        for id in fetching {
            self.service.complete_fetch(&id, Ok(text.to_owned()));
        }
    }
}

#[test]
fn a_missing_vault_entry_parks_the_source_until_it_is_added_again() {
    let rig = Rig::new();
    let source = rig.subscribe("Work", "https://cal.example.test/w.ics", Tint::Blue);
    rig.fetch(Err(FeedError::MissingLink));
    assert_eq!(
        rig.source_status(&source.id),
        SourceStatus::Error {
            error: FeedError::MissingLink
        }
    );
    assert_eq!(rig.service.plan(), None, "not retried");
    assert_eq!(rig.service.next_wake(), None);
    rig.service.command(CalendarCommand::Refresh);
    assert_eq!(rig.service.plan(), None, "not even on refresh");
}

#[test]
fn sources_are_fetched_one_after_another_and_disabled_ones_not_at_all() {
    let rig = Rig::new();
    let first = rig.subscribe("Work", "https://cal.example.test/w.ics", Tint::Blue);
    let second = rig.subscribe("Home", "https://cal.example.test/h.ics", Tint::Pink);
    let third = rig.subscribe("Muted", "https://cal.example.test/m.ics", Tint::Red);
    let mut settings = rig.service.settings();
    settings.sources[2].enabled = false;
    rig.apply(&settings);

    let now = rig.now_ms();
    let a = rig.fetch(Ok(&feed(&[timed(
        "a",
        "From work",
        now + ms(Duration::from_hours(4)),
        Duration::from_hours(1),
        "",
    )])));
    let b = rig.fetch(Ok(&feed(&[timed(
        "b",
        "From home",
        now + ms(Duration::from_hours(5)),
        Duration::from_hours(1),
        "",
    )])));
    assert_eq!(
        (a.as_str(), b.as_str()),
        (first.id.as_str(), second.id.as_str())
    );
    assert_eq!(rig.service.plan(), None, "the disabled source is skipped");
    assert_eq!(rig.source_status(&third.id), SourceStatus::Idle);
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.events.len(), 2);
    assert_eq!(snapshot.sources.len(), 3);

    settings.sources[0].enabled = false;
    rig.apply(&settings);
    assert_eq!(
        rig.snapshot()
            .events
            .iter()
            .map(|e| e.title.as_str())
            .collect::<Vec<_>>(),
        vec!["From home"],
        "a disabled source's events are hidden but kept"
    );
    settings.sources[0].enabled = true;
    rig.apply(&settings);
    assert_eq!(rig.snapshot().events.len(), 2, "and back without a fetch");
}

#[test]
fn a_fetch_that_outlives_a_disable_is_dropped() {
    let rig = Rig::new();
    let source = rig.subscribe("Work", "https://cal.example.test/w.ics", Tint::Blue);
    let Some(Job::Fetch { source_id }) = rig.service.plan() else {
        panic!("a fetch is due");
    };
    let mut settings = rig.service.settings();
    settings.sources[0].enabled = false;
    rig.apply(&settings);
    let now = rig.now_ms();
    rig.service.complete_fetch(
        &source_id,
        Ok(feed(&[timed(
            "a",
            "Late",
            now + ms(Duration::from_hours(4)),
            Duration::from_hours(1),
            "",
        )])),
    );
    assert_eq!(rig.source_status(&source.id), SourceStatus::Idle);
    settings.sources[0].enabled = true;
    rig.apply(&settings);
    assert!(
        rig.snapshot().events.is_empty(),
        "the stale result was dropped"
    );
    assert_eq!(
        rig.service.next_wake(),
        Some(Duration::ZERO),
        "fetched afresh"
    );
}

// --- the cache -----------------------------------------------------------------------------------

#[test]
fn the_next_launch_shows_the_cached_feed_before_any_fetch() {
    let store = Arc::new(Store::open_in_memory().expect("store"));
    let first = Rig::with_store_at(Arc::clone(&store), Duration::ZERO);
    let source = first.subscribe("Work", "https://cal.example.test/w.ics", Tint::Blue);
    let now = first.now_ms();
    let text = feed(&[
        timed(
            "soon",
            "Soon",
            now + ms(Duration::from_hours(3)),
            Duration::from_hours(1),
            "",
        ),
        "UID:daily\r\nSUMMARY:Daily\r\nDTSTART:20231101T090000Z\r\nDTEND:20231101T093000Z\r\n\
         RRULE:FREQ=DAILY\r\n"
            .to_owned(),
    ]);
    first.fetch(Ok(&text));
    let before = first.snapshot();
    let settings = first.service.settings();
    drop(first);

    let later = Duration::from_hours(24 * 30);
    let second = Rig::with_store_at(store, later);
    second.apply(&settings);
    let restored = second.snapshot();
    assert_eq!(restored.sources[0].status, SourceStatus::Idle);
    assert_eq!(
        restored.sources[0].fetched_at_ms,
        Some(now),
        "the cache keeps its own time"
    );
    let soon = before
        .events
        .iter()
        .find(|e| e.title == "Soon")
        .expect("the one-off event was fetched");
    assert!(
        restored.events.iter().any(|e| e.id == soon.id),
        "the one-off event is back with the same id"
    );
    let daily_before = before.events.iter().filter(|e| e.title == "Daily").count();
    let daily_after = restored
        .events
        .iter()
        .filter(|e| e.title == "Daily")
        .count();
    assert!(
        daily_before > 60,
        "one a day from November to the window's end"
    );
    assert_eq!(
        daily_after,
        daily_before + 30,
        "expanded again for a window a month further on"
    );
    assert_eq!(
        restored.window_start_ms,
        before.window_start_ms + ms(later),
        "the window moved with the clock"
    );
    assert_eq!(
        second.service.next_wake(),
        Some(Duration::ZERO),
        "an old cache is refreshed as soon as the loop runs"
    );
    assert_eq!(source.id, restored.sources[0].id);
}

#[test]
fn a_malformed_cache_is_ignored() {
    let rig = Rig::new();
    let source = rig
        .service
        .add_source("Work", "https://cal.example.test/w.ics", Tint::Blue)
        .unwrap();
    rig.store
        .set_meta(&cache_key(&source.id), "{not json")
        .unwrap();
    let mut settings = rig.service.settings();
    settings.sources.push(source.clone());
    rig.apply(&settings);
    assert!(rig.snapshot().events.is_empty());
    assert_eq!(rig.source_status(&source.id), SourceStatus::Idle);
    assert_eq!(rig.service.next_wake(), Some(Duration::ZERO));
}

// --- the strip -----------------------------------------------------------------------------------

/// A "Design sync" `offset` from now, fetched now; returns the source and the event id.
fn with_event_in(rig: &Rig, offset: Duration, extra: &str) -> (SourceSetting, String) {
    let source = rig.subscribe("Work", "https://cal.example.test/w.ics", Tint::Purple);
    let now = rig.now_ms();
    let start = now + ms(offset);
    let text = feed(&[timed(
        "m1",
        "Design sync",
        start,
        Duration::from_mins(30),
        extra,
    )]);
    rig.fetch(Ok(&text));
    let event_id = format!("{}:m1:{start}", source.id);
    (source, event_id)
}

#[test]
fn the_next_event_takes_the_strip_an_hour_ahead_and_leaves_after_the_grace() {
    let rig = Rig::new();
    let (source, event_id) = with_event_in(&rig, Duration::from_hours(2), "");
    let start = rig.now_ms() + ms(Duration::from_hours(2));
    assert!(rig.strip_activity().is_none(), "two hours out is too early");
    assert_eq!(
        rig.service.next_wake(),
        Some(Duration::from_mins(5)),
        "the refresh comes before the hour boundary"
    );

    rig.pass(Duration::from_hours(1));
    let activity = rig.strip_activity().expect("within the hour");
    assert_eq!(activity.module, ID);
    assert_eq!(activity.priority, priority::EVENT_UPCOMING);
    assert_eq!(
        activity.leading,
        Some(Leading::Icon {
            glyph: Glyph::Calendar,
            tint: Some(source.color),
        })
    );
    assert_eq!(activity.trailing, Some(Trailing::Time { at_ms: start }));
    assert_eq!(
        activity.wide,
        Some(StripMessage::EventStarting {
            title: "Design sync".into(),
        })
    );
    assert!(rig.notices_for(&event_id).is_empty(), "no notice yet");

    rig.pass(LEAD.saturating_sub(STARTING_LEAD));
    let activity = rig.strip_activity().expect("still showing");
    assert_eq!(
        activity.priority,
        priority::EVENT_STARTING,
        "ten minutes out it outranks playing media"
    );
    let notices = rig.notices_for(&event_id);
    assert_eq!(notices.len(), 1, "announced once");
    assert_eq!(notices[0].priority, priority::EVENT_STARTING);
    assert_eq!(notices[0].trailing, Some(Trailing::Time { at_ms: start }));
    assert_eq!(
        notices[0].wide,
        Some(StripMessage::EventStarting {
            title: "Design sync".into(),
        })
    );

    rig.pass(STARTING_LEAD);
    assert!(
        rig.strip_activity().is_some(),
        "at the start it is still there"
    );
    rig.pass(GRACE);
    assert!(rig.strip_activity().is_none(), "gone after the grace");
    assert_eq!(rig.notices_for(&event_id).len(), 1, "never announced twice");
}

#[test]
fn boundaries_wake_the_loop_before_the_refresh_when_they_come_first() {
    let rig = Rig::new();
    let settings = CalendarSettings {
        refresh_minutes: 60,
        ..CalendarSettings::default()
    };
    rig.apply(&settings);
    rig.subscribe("Work", "https://cal.example.test/w.ics", Tint::Purple);
    let start = rig.now_ms() + ms(Duration::from_mins(90));
    let text = feed(&[timed(
        "m1",
        "Design sync",
        start,
        Duration::from_mins(30),
        "",
    )]);
    rig.fetch(Ok(&text));
    assert_eq!(
        rig.service.next_wake(),
        Some(Duration::from_mins(30)),
        "enters the strip in 30 minutes, before the hourly refresh"
    );
    rig.pass(Duration::from_mins(30));
    assert!(rig.strip_activity().is_some());
    assert_eq!(
        rig.service.next_wake(),
        Some(Duration::from_mins(30)),
        "the refresh is due in 30 minutes, the ten-minute mark in 50"
    );
    rig.pass(Duration::from_mins(30));
    rig.fetch(Ok(&text));
    assert_eq!(
        rig.service.next_wake(),
        Some(Duration::from_mins(20)),
        "now the ten-minute mark comes first"
    );
    rig.pass(Duration::from_mins(20));
    assert_eq!(
        rig.service.next_wake(),
        Some(Duration::from_mins(25)),
        "then the end of the grace (the start itself changes nothing), before the refresh at 40"
    );
    rig.pass(Duration::from_mins(25));
    assert!(rig.strip_activity().is_none());
    assert_eq!(
        rig.service.next_wake(),
        Some(Duration::from_mins(15)),
        "only the refresh is left"
    );
}

#[test]
fn the_strip_and_the_notice_can_each_be_turned_off() {
    let rig = Rig::new();
    let settings = CalendarSettings {
        show_next_in_strip: false,
        ..CalendarSettings::default()
    };
    rig.apply(&settings);
    let (_, event_id) = with_event_in(&rig, Duration::from_mins(30), "");
    assert!(rig.strip_activity().is_none(), "strip off");
    rig.pass(Duration::from_mins(20));
    assert_eq!(
        rig.notices_for(&event_id).len(),
        1,
        "the notice still fires"
    );

    let rig = Rig::new();
    let settings = CalendarSettings {
        notices: false,
        ..CalendarSettings::default()
    };
    rig.apply(&settings);
    let (_, event_id) = with_event_in(&rig, Duration::from_mins(30), "");
    assert!(rig.strip_activity().is_some());
    rig.pass(Duration::from_mins(20));
    assert!(rig.notices_for(&event_id).is_empty(), "notices off");
    assert_eq!(
        rig.strip_activity().unwrap().priority,
        priority::EVENT_STARTING
    );
}

#[test]
fn all_day_events_never_take_the_strip() {
    let rig = Rig::new();
    rig.subscribe("Work", "https://cal.example.test/w.ics", Tint::Blue);
    let today = chrono::Local
        .timestamp_millis_opt(rig.now_ms())
        .single()
        .unwrap()
        .format("%Y%m%d")
        .to_string();
    let text = feed(&[format!(
        "UID:day\r\nSUMMARY:Company day\r\nDTSTART;VALUE=DATE:{today}\r\n"
    )]);
    rig.fetch(Ok(&text));
    assert_eq!(rig.snapshot().events.len(), 1);
    assert!(rig.snapshot().events[0].all_day);
    assert!(rig.strip_activity().is_none());
    assert_eq!(rig.service.next_wake(), Some(Duration::from_mins(5)));
}

#[test]
fn turning_the_strip_off_retracts_a_showing_activity() {
    let rig = Rig::new();
    with_event_in(&rig, Duration::from_mins(30), "");
    assert!(rig.strip_activity().is_some());
    let mut settings = rig.service.settings();
    settings.show_next_in_strip = false;
    rig.apply(&settings);
    assert!(rig.strip_activity().is_none());
}

#[test]
fn the_earliest_event_across_sources_is_the_one_shown() {
    let rig = Rig::new();
    let work = rig.subscribe("Work", "https://cal.example.test/w.ics", Tint::Blue);
    let home = rig.subscribe("Home", "https://cal.example.test/h.ics", Tint::Pink);
    let now = rig.now_ms();
    rig.fetch(Ok(&feed(&[timed(
        "w",
        "Work thing",
        now + ms(Duration::from_mins(50)),
        Duration::from_mins(30),
        "",
    )])));
    rig.fetch(Ok(&feed(&[timed(
        "h",
        "Home thing",
        now + ms(Duration::from_mins(20)),
        Duration::from_mins(30),
        "",
    )])));
    let activity = rig.strip_activity().expect("showing");
    assert_eq!(
        activity.wide,
        Some(StripMessage::EventStarting {
            title: "Home thing".into()
        })
    );
    assert_eq!(
        activity.leading,
        Some(Leading::Icon {
            glyph: Glyph::Calendar,
            tint: Some(home.color),
        })
    );
    let _ = work;
}

// --- links ---------------------------------------------------------------------------------------

#[test]
fn links_are_handed_out_only_for_known_events() {
    let rig = Rig::new();
    let (_, event_id) = with_event_in(
        &rig,
        Duration::from_hours(2),
        "LOCATION:Microsoft Teams meeting\r\n\
         X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/abc\r\n",
    );
    let event = &rig.snapshot().events[0];
    assert!(event.is_meeting);
    assert_eq!(
        rig.service.link_for(&event_id).as_deref(),
        Some("https://teams.microsoft.com/l/meetup-join/abc")
    );
    assert_eq!(rig.service.link_for("nope"), None);
    let mut settings = rig.service.settings();
    settings.sources[0].enabled = false;
    rig.apply(&settings);
    assert_eq!(
        rig.service.link_for(&event_id),
        None,
        "a disabled source's links are not opened"
    );
}

// --- registry ------------------------------------------------------------------------------------

#[test]
fn the_backend_is_registered_with_strip_panel_and_widget() {
    let clock = Arc::new(FakeClock::new());
    let platform: Arc<dyn Platform> = Arc::new(FakePlatform::new());
    let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
    let store = Arc::new(Store::open_in_memory().expect("store"));
    let services = ModuleServices::new(
        &platform,
        &hub,
        None,
        &store,
        &(Arc::clone(&clock) as Arc<dyn Clock>),
    );
    let backend = backends(&services)
        .into_iter()
        .find(|backend| backend.id() == ID)
        .expect("calendar is registered");
    assert_eq!(
        backend.capabilities(),
        &[Surface::Strip, Surface::Panel, Surface::Widget]
    );
    assert!(
        services.calendar.settings().sources.is_empty(),
        "no source, no request"
    );
}
