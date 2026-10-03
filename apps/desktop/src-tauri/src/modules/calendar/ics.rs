//! iCalendar reading for the calendar module (docs/modules/calendar.md "ICS subscriptions"):
//! content lines, `VEVENT` components, dates in their zones, recurrence and the meeting link.
//!
//! The parser is Muna's own — small, permissive, never panicking on a feed it does not
//! understand — because the feeds in the wild (Outlook, Google, Apple, Nextcloud) bend RFC
//! 5545 in different ways. Recurrence rules are handed to the `rrule` crate once the lines
//! have been normalised (zone names Windows spells its own way, `VALUE=DATE` lists).
//!
//! Everything here is pure: text in, occurrences out, so `tests/calendar.rs` covers it with
//! fixtures and no clock.

use std::collections::BTreeMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::str::FromStr;

use chrono::{
    DateTime, Days, Local, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeDelta, TimeZone,
    Utc,
};

/// The most occurrences one recurring event contributes inside the window; past that the rule
/// is cut, which for a five-minute rule still covers the window.
pub const MAX_OCCURRENCES_PER_EVENT: u16 = 400;
/// How far before the window's start recurrences are generated, so a multi-day occurrence
/// that began earlier and is still running is kept.
const OCCURRENCE_LOOKBACK_MS: i64 = 31 * 24 * 60 * 60 * 1000;
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// Hosts whose links are video meetings; a sub-domain of any of them counts.
pub const MEETING_HOSTS: [&str; 8] = [
    "teams.microsoft.com",
    "teams.live.com",
    "meet.google.com",
    "zoom.us",
    "webex.com",
    "gotomeeting.com",
    "whereby.com",
    "meet.jit.si",
];

/// One unfolded `NAME;PARAM=value:value` line. Names are upper-cased on the way in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentLine {
    pub name: String,
    pub params: Vec<(String, String)>,
    pub value: String,
}

impl ContentLine {
    /// The first parameter named `name` (case-insensitive), unquoted.
    #[must_use]
    pub fn param(&self, name: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// Joins folded lines (a continuation starts with a space or a tab) and drops blank ones.
#[must_use]
pub fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.lines() {
        if let Some(rest) = raw.strip_prefix([' ', '\t'])
            && let Some(last) = lines.last_mut()
        {
            last.push_str(rest);
            continue;
        }
        if !raw.trim().is_empty() {
            lines.push(raw.to_owned());
        }
    }
    lines
}

/// Splits one logical line into name, parameters and value; `None` when there is no `:` or
/// no name.
#[must_use]
pub fn parse_line(line: &str) -> Option<ContentLine> {
    let colon = position_outside_quotes(line, ':')?;
    let (head, value) = line.split_at(colon);
    let value = &value[1..];
    let mut parts = split_outside_quotes(head, ';').into_iter();
    let name = parts.next()?.trim().to_ascii_uppercase();
    if name.is_empty() {
        return None;
    }
    let params = parts
        .filter_map(|part| {
            let (key, value) = part.split_once('=')?;
            Some((
                key.trim().to_ascii_uppercase(),
                unquote(value.trim()).to_owned(),
            ))
        })
        .collect();
    Some(ContentLine {
        name,
        params,
        value: value.to_owned(),
    })
}

fn position_outside_quotes(text: &str, needle: char) -> Option<usize> {
    let mut quoted = false;
    for (index, ch) in text.char_indices() {
        match ch {
            '"' => quoted = !quoted,
            c if c == needle && !quoted => return Some(index),
            _ => {}
        }
    }
    None
}

fn split_outside_quotes(text: &str, separator: char) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut quoted = false;
    let mut start = 0;
    for (index, ch) in text.char_indices() {
        match ch {
            '"' => quoted = !quoted,
            c if c == separator && !quoted => {
                parts.push(&text[start..index]);
                start = index + c.len_utf8();
            }
            _ => {}
        }
    }
    parts.push(&text[start..]);
    parts
}

fn unquote(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(value)
}

/// Undoes TEXT escaping: `\n` and `\N` become a newline, `\,` `\;` `\\` the character.
#[must_use]
pub fn unescape_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('n' | 'N') => out.push('\n'),
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

/// One `VEVENT` as its content lines (alarms inside it are dropped).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RawEvent {
    pub props: Vec<ContentLine>,
}

impl RawEvent {
    /// The first property named `name`.
    #[must_use]
    pub fn first(&self, name: &str) -> Option<&ContentLine> {
        self.props.iter().find(|line| line.name == name)
    }

    /// Every property named `name`, in order.
    pub fn all<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a ContentLine> + 'a {
        self.props.iter().filter(move |line| line.name == name)
    }

    /// A TEXT property, unescaped and trimmed; `None` when absent or blank.
    #[must_use]
    pub fn text(&self, name: &str) -> Option<String> {
        let value = unescape_text(&self.first(name)?.value);
        let value = value.trim();
        (!value.is_empty()).then(|| value.to_owned())
    }

    /// A TEXT property flattened to one line (a title or a place).
    #[must_use]
    pub fn line_text(&self, name: &str) -> Option<String> {
        self.text(name)
            .map(|value| value.split_whitespace().collect::<Vec<_>>().join(" "))
    }

    /// `STATUS:CANCELLED`, which hides the event (or the one occurrence, on an override).
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.first("STATUS")
            .is_some_and(|status| status.value.trim().eq_ignore_ascii_case("CANCELLED"))
    }
}

/// Every `VEVENT` in the text, nested components (`VALARM`) skipped and other components
/// (`VTIMEZONE`, `VTODO`) ignored.
#[must_use]
pub fn events(text: &str) -> Vec<RawEvent> {
    let mut events = Vec::new();
    let mut current: Option<RawEvent> = None;
    let mut nested = 0usize;
    for line in unfold(text) {
        let Some(line) = parse_line(&line) else {
            continue;
        };
        match (line.name.as_str(), current.as_mut()) {
            ("BEGIN", None) => {
                if line.value.trim().eq_ignore_ascii_case("VEVENT") {
                    current = Some(RawEvent::default());
                }
            }
            ("BEGIN", Some(_)) => nested += 1,
            ("END", Some(_)) if nested > 0 => nested -= 1,
            ("END", Some(_)) => {
                if line.value.trim().eq_ignore_ascii_case("VEVENT")
                    && let Some(event) = current.take()
                {
                    events.push(event);
                }
                current = None;
            }
            (_, Some(event)) if nested == 0 => event.props.push(line),
            _ => {}
        }
    }
    events
}

/// A point in time as a feed states it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Moment {
    pub ms: i64,
    /// The value named a day, not a time; `ms` is that day's local midnight.
    pub all_day: bool,
}

/// A `DTSTART`, `DTEND`, `RECURRENCE-ID` or `RDATE` value as an instant: `VALUE=DATE` and
/// bare dates are local midnights, `Z` is UTC, `TZID` is looked up (IANA or the Windows name),
/// and a floating or unknown-zone time is read in the machine's zone.
#[must_use]
pub fn moment_of(line: &ContentLine) -> Option<Moment> {
    let value = line.value.trim();
    let dated = line
        .param("VALUE")
        .is_some_and(|kind| kind.eq_ignore_ascii_case("DATE"))
        || (value.len() == 8 && value.bytes().all(|byte| byte.is_ascii_digit()));
    if dated {
        let date = NaiveDate::parse_from_str(&value[..value.len().min(8)], "%Y%m%d").ok()?;
        return Some(Moment {
            ms: local_midnight_ms(date)?,
            all_day: true,
        });
    }
    let (naive, utc) = parse_naive(value)?;
    if utc {
        return Some(Moment {
            ms: Utc.from_utc_datetime(&naive).timestamp_millis(),
            all_day: false,
        });
    }
    let ms = match line.param("TZID").and_then(zone) {
        Some(tz) => resolve(&tz, naive)?,
        None => resolve(&Local, naive)?,
    };
    Some(Moment { ms, all_day: false })
}

fn parse_naive(value: &str) -> Option<(NaiveDateTime, bool)> {
    let (body, utc) = match value.strip_suffix(['Z', 'z']) {
        Some(body) => (body, true),
        None => (value, false),
    };
    let naive = NaiveDateTime::parse_from_str(body, "%Y%m%dT%H%M%S")
        .or_else(|_| NaiveDateTime::parse_from_str(body, "%Y%m%dT%H%M"))
        .ok()?;
    Some((naive, utc))
}

/// A wall time in `tz` as an instant; a time inside a spring-forward gap is moved an hour on,
/// the earlier of an autumn pair is taken.
fn resolve<Z: TimeZone>(tz: &Z, naive: NaiveDateTime) -> Option<i64> {
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(at) | LocalResult::Ambiguous(at, _) => Some(at.timestamp_millis()),
        LocalResult::None => {
            let shifted = naive.checked_add_signed(TimeDelta::hours(1))?;
            match tz.from_local_datetime(&shifted) {
                LocalResult::Single(at) | LocalResult::Ambiguous(at, _) => {
                    Some(at.timestamp_millis())
                }
                LocalResult::None => None,
            }
        }
    }
}

fn local_midnight_ms(date: NaiveDate) -> Option<i64> {
    resolve(&Local, date.and_time(NaiveTime::MIN))
}

fn local_date_of(ms: i64) -> Option<NaiveDate> {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|at| at.date_naive())
}

/// The zone a `TZID` names: an IANA name, a path ending in one (`/mozilla.org/…/Europe/Rome`)
/// or one of the Windows display names Outlook writes.
#[must_use]
pub fn zone(tzid: &str) -> Option<chrono_tz::Tz> {
    let name = tzid.trim().trim_matches('"');
    if let Ok(tz) = chrono_tz::Tz::from_str(name) {
        return Some(tz);
    }
    if let Some(mapped) = windows_zone(name) {
        return chrono_tz::Tz::from_str(mapped).ok();
    }
    let segments: Vec<&str> = name.split('/').filter(|part| !part.is_empty()).collect();
    if segments.len() >= 2 {
        let tail = format!(
            "{}/{}",
            segments[segments.len() - 2],
            segments[segments.len() - 1]
        );
        if let Ok(tz) = chrono_tz::Tz::from_str(&tail) {
            return Some(tz);
        }
    }
    None
}

/// The IANA zone for a Windows time-zone display name, for the ones feeds commonly carry.
/// Anything else falls back to the machine's zone — a documented limitation.
#[must_use]
pub fn windows_zone(name: &str) -> Option<&'static str> {
    Some(match name {
        "UTC" | "Coordinated Universal Time" => "UTC",
        "GMT Standard Time" => "Europe/London",
        "Greenwich Standard Time" => "Atlantic/Reykjavik",
        "W. Europe Standard Time" => "Europe/Berlin",
        "Romance Standard Time" => "Europe/Paris",
        "Central Europe Standard Time" => "Europe/Budapest",
        "Central European Standard Time" => "Europe/Warsaw",
        "E. Europe Standard Time" => "Europe/Chisinau",
        "FLE Standard Time" => "Europe/Kiev",
        "GTB Standard Time" => "Europe/Bucharest",
        "Russian Standard Time" => "Europe/Moscow",
        "Turkey Standard Time" => "Europe/Istanbul",
        "Israel Standard Time" => "Asia/Jerusalem",
        "Egypt Standard Time" => "Africa/Cairo",
        "South Africa Standard Time" => "Africa/Johannesburg",
        "W. Central Africa Standard Time" => "Africa/Lagos",
        "E. Africa Standard Time" => "Africa/Nairobi",
        "Arabian Standard Time" => "Asia/Dubai",
        "Arab Standard Time" => "Asia/Riyadh",
        "Pakistan Standard Time" => "Asia/Karachi",
        "India Standard Time" => "Asia/Kolkata",
        "SE Asia Standard Time" => "Asia/Bangkok",
        "Singapore Standard Time" => "Asia/Singapore",
        "China Standard Time" => "Asia/Shanghai",
        "Taipei Standard Time" => "Asia/Taipei",
        "Tokyo Standard Time" => "Asia/Tokyo",
        "Korea Standard Time" => "Asia/Seoul",
        "W. Australia Standard Time" => "Australia/Perth",
        "Cen. Australia Standard Time" => "Australia/Adelaide",
        "AUS Eastern Standard Time" => "Australia/Sydney",
        "New Zealand Standard Time" => "Pacific/Auckland",
        "Hawaiian Standard Time" => "Pacific/Honolulu",
        "Alaskan Standard Time" => "America/Anchorage",
        "Pacific Standard Time" => "America/Los_Angeles",
        "US Mountain Standard Time" => "America/Phoenix",
        "Mountain Standard Time" => "America/Denver",
        "Central Standard Time" => "America/Chicago",
        "Central Standard Time (Mexico)" => "America/Mexico_City",
        "Canada Central Standard Time" => "America/Regina",
        "Eastern Standard Time" => "America/New_York",
        "US Eastern Standard Time" => "America/Indianapolis",
        "Atlantic Standard Time" => "America/Halifax",
        "SA Pacific Standard Time" => "America/Bogota",
        "Argentina Standard Time" => "America/Argentina/Buenos_Aires",
        "E. South America Standard Time" => "America/Sao_Paulo",
        _ => return None,
    })
}

/// An RFC 5545 `DURATION` (`P1D`, `PT1H30M`, `-P1W`); `None` for anything else.
#[must_use]
pub fn parse_duration(value: &str) -> Option<TimeDelta> {
    let value = value.trim();
    let (negative, rest) = match value.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, value.strip_prefix('+').unwrap_or(value)),
    };
    let rest = rest.strip_prefix('P')?;
    let (date_part, time_part) = match rest.split_once('T') {
        Some((date, time)) => (date, Some(time)),
        None => (rest, None),
    };
    let mut total = TimeDelta::zero();
    let mut number = String::new();
    for ch in date_part.chars() {
        if ch.is_ascii_digit() {
            number.push(ch);
            continue;
        }
        let count: i64 = number.parse().ok()?;
        number.clear();
        total = total.checked_add(&match ch {
            'W' => TimeDelta::try_weeks(count)?,
            'D' => TimeDelta::try_days(count)?,
            _ => return None,
        })?;
    }
    if !number.is_empty() {
        return None;
    }
    if let Some(time_part) = time_part {
        for ch in time_part.chars() {
            if ch.is_ascii_digit() {
                number.push(ch);
                continue;
            }
            let count: i64 = number.parse().ok()?;
            number.clear();
            total = total.checked_add(&match ch {
                'H' => TimeDelta::try_hours(count)?,
                'M' => TimeDelta::try_minutes(count)?,
                'S' => TimeDelta::try_seconds(count)?,
                _ => return None,
            })?;
        }
        if !number.is_empty() {
            return None;
        }
    }
    Some(if negative { -total } else { total })
}

/// One event instance inside the requested window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Occurrence {
    pub uid: String,
    /// The summary, one line; empty when the feed had none (the UI names it).
    pub title: String,
    pub location: Option<String>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub all_day: bool,
    /// A meeting link when one was found, else the event's `URL`.
    pub link: Option<String>,
    /// `link` points at a video meeting ([`MEETING_HOSTS`]).
    pub is_meeting: bool,
}

/// Whether `url` is an `http(s)` link to one of [`MEETING_HOSTS`].
#[must_use]
pub fn is_meeting_url(url: &str) -> bool {
    let Ok(parsed) = tauri::Url::parse(url) else {
        return false;
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return false;
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    MEETING_HOSTS
        .iter()
        .any(|known| host == *known || host.ends_with(&format!(".{known}")))
}

/// Whether `url` is something the opener may be handed.
#[must_use]
pub fn is_web_url(url: &str) -> bool {
    tauri::Url::parse(url).is_ok_and(|parsed| matches!(parsed.scheme(), "http" | "https"))
}

/// Every `http(s)://…` run in free text, in order, trailing punctuation dropped.
#[must_use]
pub fn urls_in(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let lower = text.to_ascii_lowercase();
    let mut from = 0;
    while let Some(offset) = lower[from..].find("http") {
        let start = from + offset;
        let candidate = &text[start..];
        let is_scheme = candidate
            .get(..8)
            .is_some_and(|head| head.eq_ignore_ascii_case("https://"))
            || candidate
                .get(..7)
                .is_some_and(|head| head.eq_ignore_ascii_case("http://"));
        if !is_scheme {
            from = start + 4;
            continue;
        }
        let end = candidate
            .find(|ch: char| ch.is_whitespace() || matches!(ch, '<' | '>' | '"' | '\''))
            .unwrap_or(candidate.len());
        let url = candidate[..end].trim_end_matches(['.', ',', ';', ')', ']', '}']);
        if is_web_url(url) {
            found.push(url.to_owned());
        }
        from = start + end.max(4);
    }
    found
}

/// The link for an event and whether it is a meeting: a conferencing property first, then
/// `URL`, then the first meeting link in the location or the description.
#[must_use]
pub fn link_of(event: &RawEvent) -> (Option<String>, bool) {
    const CONFERENCE_PROPS: [&str; 3] = [
        "X-MICROSOFT-SKYPETEAMSMEETINGURL",
        "X-MICROSOFT-ONLINEMEETINGEXTERNALLINK",
        "X-GOOGLE-CONFERENCE",
    ];
    for name in CONFERENCE_PROPS {
        if let Some(url) = event.text(name)
            && is_web_url(&url)
        {
            return (Some(url), true);
        }
    }
    let plain = event.text("URL").filter(|url| is_web_url(url));
    if let Some(url) = &plain
        && is_meeting_url(url)
    {
        return (plain, true);
    }
    for name in ["LOCATION", "DESCRIPTION"] {
        if let Some(text) = event.text(name)
            && let Some(url) = urls_in(&text).into_iter().find(|url| is_meeting_url(url))
        {
            return (Some(url), true);
        }
    }
    (plain, false)
}

/// Every occurrence in `[window_start_ms, window_end_ms)` from every event in `text`, sorted
/// by start. Recurrence overrides (`RECURRENCE-ID`) replace the instance they name; cancelled
/// events and instances are left out.
#[must_use]
pub fn expand(text: &str, window_start_ms: i64, window_end_ms: i64) -> Vec<Occurrence> {
    let mut groups: BTreeMap<String, (Option<RawEvent>, Vec<RawEvent>)> = BTreeMap::new();
    for event in events(text) {
        let uid = event.text("UID").unwrap_or_else(|| synthetic_uid(&event));
        let group = groups.entry(uid).or_default();
        if event.first("RECURRENCE-ID").is_some() {
            group.1.push(event);
        } else if group.0.is_none() {
            group.0 = Some(event);
        }
    }
    let mut occurrences = Vec::new();
    for (uid, (master, overrides)) in groups {
        let mut instances = master
            .as_ref()
            .filter(|master| !master.is_cancelled())
            .map(|master| expand_master(&uid, master, window_start_ms, window_end_ms))
            .unwrap_or_default();
        for override_event in overrides {
            let Some(named) = override_event
                .first("RECURRENCE-ID")
                .and_then(moment_of)
                .map(|moment| moment.ms)
            else {
                continue;
            };
            instances.retain(|occurrence| occurrence.start_ms != named);
            if override_event.is_cancelled() {
                continue;
            }
            if let Some(occurrence) = single(&uid, &override_event)
                && overlaps(&occurrence, window_start_ms, window_end_ms)
            {
                instances.push(occurrence);
            }
        }
        occurrences.append(&mut instances);
    }
    occurrences.sort_by(|a, b| {
        a.start_ms
            .cmp(&b.start_ms)
            .then_with(|| a.end_ms.cmp(&b.end_ms))
            .then_with(|| a.title.cmp(&b.title))
            .then_with(|| a.uid.cmp(&b.uid))
    });
    occurrences.dedup_by(|a, b| a.uid == b.uid && a.start_ms == b.start_ms);
    occurrences
}

fn synthetic_uid(event: &RawEvent) -> String {
    let mut hasher = DefaultHasher::new();
    event.text("SUMMARY").hash(&mut hasher);
    event
        .first("DTSTART")
        .map(|line| &line.value)
        .hash(&mut hasher);
    format!("anon-{:016x}", hasher.finish())
}

fn overlaps(occurrence: &Occurrence, window_start_ms: i64, window_end_ms: i64) -> bool {
    occurrence.start_ms < window_end_ms && occurrence.end_ms > window_start_ms
}

/// The start and end of an event as written, the end defaulting per RFC 5545 §3.6.1 (a day
/// for a date, zero length for a time).
fn span_of(event: &RawEvent) -> Option<(Moment, i64)> {
    let start = moment_of(event.first("DTSTART")?)?;
    let end_ms = event
        .first("DTEND")
        .and_then(moment_of)
        .map(|end| end.ms)
        .or_else(|| {
            let duration = parse_duration(&event.first("DURATION")?.value)?;
            start.ms.checked_add(duration.num_milliseconds())
        })
        .unwrap_or(if start.all_day {
            start.ms + DAY_MS
        } else {
            start.ms
        });
    Some((start, end_ms.max(start.ms)))
}

fn occurrence(uid: &str, event: &RawEvent, start: Moment, end_ms: i64) -> Occurrence {
    let (link, is_meeting) = link_of(event);
    Occurrence {
        uid: uid.to_owned(),
        title: event.line_text("SUMMARY").unwrap_or_default(),
        location: event.line_text("LOCATION"),
        start_ms: start.ms,
        end_ms,
        all_day: start.all_day,
        link,
        is_meeting,
    }
}

fn single(uid: &str, event: &RawEvent) -> Option<Occurrence> {
    let (start, end_ms) = span_of(event)?;
    Some(occurrence(uid, event, start, end_ms))
}

fn expand_master(
    uid: &str,
    master: &RawEvent,
    window_start_ms: i64,
    window_end_ms: i64,
) -> Vec<Occurrence> {
    let Some((start, end_ms)) = span_of(master) else {
        return Vec::new();
    };
    let recurring = master.first("RRULE").is_some() || master.first("RDATE").is_some();
    let starts = if recurring {
        recurrence_starts(master, start, window_start_ms, window_end_ms).unwrap_or_else(|| {
            tracing::debug!("calendar recurrence rule not understood; first instance kept");
            vec![start.ms]
        })
    } else {
        vec![start.ms]
    };
    let template = occurrence(uid, master, start, end_ms);
    let length_ms = end_ms - start.ms;
    let all_day_days = if start.all_day {
        u64::try_from(((end_ms - start.ms) / DAY_MS).max(1)).unwrap_or(1)
    } else {
        0
    };
    starts
        .into_iter()
        .filter_map(|start_ms| {
            let end_ms = if start.all_day {
                let date = local_date_of(start_ms)?.checked_add_days(Days::new(all_day_days))?;
                local_midnight_ms(date)?
            } else {
                start_ms + length_ms
            };
            Some(Occurrence {
                start_ms,
                end_ms,
                ..template.clone()
            })
        })
        .filter(|instance| overlaps(instance, window_start_ms, window_end_ms))
        .collect()
}

/// The starts of a recurring event around the window, from `rrule`; `None` when the rule
/// lines do not parse.
fn recurrence_starts(
    master: &RawEvent,
    start: Moment,
    window_start_ms: i64,
    window_end_ms: i64,
) -> Option<Vec<i64>> {
    let mut block = normalised_date_line("DTSTART", master.first("DTSTART")?, start.all_day)?;
    for rule in master.all("RRULE") {
        block.push_str("\nRRULE:");
        block.push_str(rule.value.trim());
    }
    for name in ["EXDATE", "RDATE"] {
        for line in master.all(name) {
            if let Some(normalised) = normalised_date_line(name, line, start.all_day) {
                block.push('\n');
                block.push_str(&normalised);
            }
        }
    }
    let set = rrule::RRuleSet::from_str(&block)
        .map_err(|error| tracing::debug!(%error, "calendar recurrence rule rejected"))
        .ok()?;
    let after = rrule_instant(window_start_ms.saturating_sub(OCCURRENCE_LOOKBACK_MS))?;
    let before = rrule_instant(window_end_ms)?;
    let result = set
        .after(after)
        .before(before)
        .all(MAX_OCCURRENCES_PER_EVENT);
    if result.limited {
        tracing::debug!("calendar recurrence cut at the occurrence limit");
    }
    Some(
        result
            .dates
            .iter()
            .map(DateTime::timestamp_millis)
            .collect(),
    )
}

fn rrule_instant(ms: i64) -> Option<DateTime<rrule::Tz>> {
    rrule::Tz::UTC.timestamp_millis_opt(ms).single()
}

/// A date property as `rrule` reads it: a bare date for all-day values, `Z` kept, a known
/// zone as its IANA name, anything else floating (the machine's zone). Values it cannot
/// read are dropped from the list; an empty list yields `None`.
fn normalised_date_line(name: &str, line: &ContentLine, all_day: bool) -> Option<String> {
    let zone_name = line
        .param("TZID")
        .and_then(zone)
        .map(|tz| tz.name().to_owned());
    let values: Vec<&str> = line
        .value
        .split(',')
        .map(str::trim)
        .filter(|value| {
            if all_day || value.len() == 8 {
                value.len() >= 8 && value.bytes().take(8).all(|byte| byte.is_ascii_digit())
            } else {
                parse_naive(value).is_some()
            }
        })
        .map(|value| if all_day { &value[..8] } else { value })
        .collect();
    if values.is_empty() {
        return None;
    }
    let utc = values.iter().all(|value| value.ends_with(['Z', 'z']));
    let mut out = name.to_owned();
    if let Some(zone_name) = zone_name
        && !all_day
        && !utc
    {
        out.push_str(";TZID=");
        out.push_str(&zone_name);
    }
    out.push(':');
    out.push_str(&values.join(","));
    Some(out)
}
