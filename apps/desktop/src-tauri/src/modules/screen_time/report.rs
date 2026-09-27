//! The arithmetic behind the panel (docs/modules/screen-time.md): local day boundaries with
//! the reset hour, spans clipped to a window, and the totals per day, app and category. Pure
//! functions over plain values so `tests/screen_time.rs` and the unit tests here pin every
//! edge without a store or a clock.

use std::collections::BTreeMap;

use super::categories::AppCategory;

/// Milliseconds in a day.
pub const DAY_MS: i64 = 24 * 60 * 60 * 1000;
/// Milliseconds in an hour.
pub const HOUR_MS: i64 = 60 * 60 * 1000;

/// A foreground span in Unix milliseconds, `[start_ms, end_ms)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Span<'a> {
    pub exe: &'a str,
    pub start_ms: i64,
    pub end_ms: i64,
}

/// The start of the day containing `now_ms`: the most recent local `reset_hour:00` at or
/// before it, converted back to UTC with the zone offset in force at `now_ms`.
#[must_use]
pub fn day_start(now_ms: i64, reset_hour: u8, offset_seconds: i32) -> i64 {
    let offset_ms = i64::from(offset_seconds) * 1000;
    let reset_ms = i64::from(reset_hour.min(23)) * HOUR_MS;
    let local = now_ms.saturating_add(offset_ms);
    let day = (local - reset_ms).div_euclid(DAY_MS);
    day * DAY_MS + reset_ms - offset_ms
}

/// Starts of the `days` most recent days, oldest first, the last being today's. Each is
/// `DAY_MS` before the next; a DST change inside the week shifts the earlier boundaries by
/// an hour, which the totals tolerate.
#[must_use]
pub fn day_starts(today_start_ms: i64, days: usize) -> Vec<i64> {
    (0..days)
        .rev()
        .map(|back| today_start_ms - i64::try_from(back).unwrap_or(0) * DAY_MS)
        .collect()
}

/// The part of `[start, end)` inside `[from, to)`, in milliseconds; 0 when they do not meet.
#[must_use]
pub fn overlap_ms(start: i64, end: i64, from: i64, to: i64) -> i64 {
    (end.min(to) - start.max(from)).max(0)
}

/// What one app did inside a window.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AppTotals {
    pub total_ms: i64,
    /// Spans that touched the window.
    pub sessions: u32,
    /// The longest clipped span.
    pub longest_ms: i64,
}

/// Per-app totals for the spans inside `[from, to)`, keyed by exe.
#[must_use]
pub fn totals_by_app<'a>(spans: &[Span<'a>], from: i64, to: i64) -> BTreeMap<&'a str, AppTotals> {
    let mut totals: BTreeMap<&str, AppTotals> = BTreeMap::new();
    for span in spans {
        let inside = overlap_ms(span.start_ms, span.end_ms, from, to);
        if inside <= 0 {
            continue;
        }
        let entry = totals.entry(span.exe).or_default();
        entry.total_ms += inside;
        entry.sessions += 1;
        entry.longest_ms = entry.longest_ms.max(inside);
    }
    totals
}

/// The whole window: total, switches (spans that touched it), longest and average span.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WindowTotals {
    pub total_ms: i64,
    pub switches: u32,
    pub longest_ms: i64,
    pub average_ms: i64,
}

#[must_use]
pub fn totals_for_window(spans: &[Span<'_>], from: i64, to: i64) -> WindowTotals {
    let mut totals = WindowTotals::default();
    for span in spans {
        let inside = overlap_ms(span.start_ms, span.end_ms, from, to);
        if inside <= 0 {
            continue;
        }
        totals.total_ms += inside;
        totals.switches += 1;
        totals.longest_ms = totals.longest_ms.max(inside);
    }
    if totals.switches > 0 {
        totals.average_ms = totals.total_ms / i64::from(totals.switches);
    }
    totals
}

/// Per-category totals for the spans inside `[from, to)`, with `category_of` resolving each
/// exe. Categories without time are left out; the result is ordered as [`AppCategory::ALL`].
#[must_use]
pub fn totals_by_category(
    spans: &[Span<'_>],
    from: i64,
    to: i64,
    category_of: &dyn Fn(&str) -> AppCategory,
) -> Vec<(AppCategory, i64)> {
    let mut sums: BTreeMap<AppCategory, i64> = BTreeMap::new();
    for span in spans {
        let inside = overlap_ms(span.start_ms, span.end_ms, from, to);
        if inside <= 0 {
            continue;
        }
        *sums.entry(category_of(span.exe)).or_default() += inside;
    }
    AppCategory::ALL
        .into_iter()
        .filter_map(|category| sums.get(&category).map(|total| (category, *total)))
        .collect()
}

/// A display name from an executable file name when the file has no description:
/// `code.exe` → `Code`, `ms-teams.exe` → `Ms Teams`, `notepad++.exe` → `Notepad++`.
#[must_use]
pub fn name_from_exe(exe: &str) -> String {
    let stem = exe.rsplit_once('.').map_or(exe, |(stem, _)| stem).trim();
    let words: Vec<String> = stem
        .split(['-', '_', ' '])
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect(),
                None => String::new(),
            }
        })
        .collect();
    if words.is_empty() {
        exe.to_owned()
    } else {
        words.join(" ")
    }
}

/// The lower-case file name of a process image (`C:\Apps\Code.exe` or `Code.exe` → `code.exe`);
/// empty for an empty input.
#[must_use]
pub fn exe_key(process_name_or_path: &str) -> String {
    process_name_or_path
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2026-03-01 12:00:00 UTC.
    const NOON_UTC: i64 = 1_772_366_400_000;

    #[test]
    fn day_start_uses_the_reset_hour_in_local_time() {
        // UTC zone, reset at midnight: 2026-03-01 00:00 UTC.
        assert_eq!(day_start(NOON_UTC, 0, 0), NOON_UTC - 12 * HOUR_MS);
        // Reset at 04:00: 2026-03-01 04:00 UTC.
        assert_eq!(day_start(NOON_UTC, 4, 0), NOON_UTC - 8 * HOUR_MS);
        // 02:00 UTC with a 04:00 reset belongs to the day before.
        let two_am = NOON_UTC - 10 * HOUR_MS;
        assert_eq!(day_start(two_am, 4, 0), NOON_UTC - 8 * HOUR_MS - DAY_MS);
        // UTC+2: local noon is 14:00; local midnight was 22:00 UTC the day before.
        assert_eq!(day_start(NOON_UTC, 0, 7200), NOON_UTC - 14 * HOUR_MS);
        // UTC-5: local 07:00; local midnight is 05:00 UTC today.
        assert_eq!(day_start(NOON_UTC, 0, -18000), NOON_UTC - 7 * HOUR_MS);
        // Exactly on the boundary belongs to the new day.
        let boundary = day_start(NOON_UTC, 4, 0);
        assert_eq!(day_start(boundary, 4, 0), boundary);
        assert_eq!(day_start(boundary - 1, 4, 0), boundary - DAY_MS);
    }

    #[test]
    fn day_starts_count_back_oldest_first() {
        let today = day_start(NOON_UTC, 0, 0);
        let week = day_starts(today, 7);
        assert_eq!(week.len(), 7);
        assert_eq!(week[6], today);
        assert_eq!(week[0], today - 6 * DAY_MS);
        assert!(week.windows(2).all(|pair| pair[1] - pair[0] == DAY_MS));
    }

    #[test]
    fn totals_clip_spans_to_the_window() {
        let spans = [
            Span {
                exe: "code.exe",
                start_ms: 0,
                end_ms: 1000,
            },
            Span {
                exe: "code.exe",
                start_ms: 2000,
                end_ms: 5000,
            },
            Span {
                exe: "chrome.exe",
                start_ms: 4500,
                end_ms: 9000,
            },
            Span {
                exe: "steam.exe",
                start_ms: 9000,
                end_ms: 9500,
            },
        ];
        let by_app = totals_by_app(&spans, 500, 9000);
        assert_eq!(
            by_app["code.exe"],
            AppTotals {
                total_ms: 500 + 3000,
                sessions: 2,
                longest_ms: 3000,
            }
        );
        assert_eq!(
            by_app["chrome.exe"],
            AppTotals {
                total_ms: 4500,
                sessions: 1,
                longest_ms: 4500,
            }
        );
        assert!(
            !by_app.contains_key("steam.exe"),
            "a span starting at the window's end is outside it"
        );

        let window = totals_for_window(&spans, 500, 9000);
        assert_eq!(
            window,
            WindowTotals {
                total_ms: 8000,
                switches: 3,
                longest_ms: 4500,
                average_ms: 8000 / 3,
            }
        );
        assert_eq!(
            totals_for_window(&spans, 20_000, 30_000),
            WindowTotals::default()
        );

        let by_category = totals_by_category(&spans, 0, 10_000, &|exe| AppCategory::rule(exe));
        assert_eq!(
            by_category,
            vec![
                (AppCategory::Browsing, 4500),
                (AppCategory::Development, 4000),
                (AppCategory::Games, 500),
            ]
        );
    }

    #[test]
    fn names_and_keys_derive_from_the_file_name() {
        assert_eq!(name_from_exe("code.exe"), "Code");
        assert_eq!(name_from_exe("ms-teams.exe"), "Ms Teams");
        assert_eq!(name_from_exe("notepad++.exe"), "Notepad++");
        assert_eq!(name_from_exe("docker desktop.exe"), "Docker Desktop");
        assert_eq!(name_from_exe(".exe"), ".exe");
        assert_eq!(
            exe_key(r"C:\Program Files\Microsoft VS Code\Code.exe"),
            "code.exe"
        );
        assert_eq!(exe_key("Explorer.EXE"), "explorer.exe");
        assert_eq!(exe_key(""), "");
    }
}
