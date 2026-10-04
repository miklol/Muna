//! CSV export (docs/modules/screen-time.md, "export CSV"): one row per span with the app's
//! name and category, ISO-8601 local times and whole seconds. Written by the module into a
//! folder the user picks; window titles are not part of the data and never appear here.

use std::fmt::Write as _;

/// One row of the export.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CsvRow<'a> {
    pub start_ms: i64,
    pub end_ms: i64,
    pub exe: &'a str,
    pub name: &'a str,
    pub category: &'a str,
}

pub const HEADER: &str = "start,end,exe,app,category,seconds";

/// The whole file. `offset_seconds` is the zone offset the timestamps are written in, so the
/// export reads in the user's local time.
#[must_use]
pub fn render(rows: &[CsvRow<'_>], offset_seconds: i32) -> String {
    let mut out = String::with_capacity(rows.len() * 96 + HEADER.len() + 2);
    out.push_str(HEADER);
    out.push_str("\r\n");
    for row in rows {
        let seconds = (row.end_ms - row.start_ms).max(0) / 1000;
        let _ = writeln!(
            out,
            "{},{},{},{},{},{}\r",
            iso_local(row.start_ms, offset_seconds),
            iso_local(row.end_ms, offset_seconds),
            field(row.exe),
            field(row.name),
            field(row.category),
            seconds
        );
    }
    out
}

/// The file name for an export made on the day starting at `today_start_ms` local.
#[must_use]
pub fn file_name(now_ms: i64, offset_seconds: i32) -> String {
    let (year, month, day, ..) = civil(now_ms, offset_seconds);
    format!("muna-screen-time-{year:04}-{month:02}-{day:02}.csv")
}

/// RFC 4180: quote when the value has a comma, a quote or a line break; double the quotes.
fn field(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

/// `2026-03-01T14:05:09+02:00`.
fn iso_local(ms: i64, offset_seconds: i32) -> String {
    let (year, month, day, hour, minute, second) = civil(ms, offset_seconds);
    let sign = if offset_seconds < 0 { '-' } else { '+' };
    let offset = offset_seconds.unsigned_abs();
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}{sign}{:02}:{:02}",
        offset / 3600,
        (offset % 3600) / 60
    )
}

/// Civil date and time of `ms` shifted by `offset_seconds` (Howard Hinnant's days-to-civil).
fn civil(ms: i64, offset_seconds: i32) -> (i64, u32, u32, u32, u32, u32) {
    let local_seconds = ms.div_euclid(1000) + i64::from(offset_seconds);
    let days = local_seconds.div_euclid(86_400);
    let of_day = local_seconds.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    (
        year,
        u32::try_from(month).unwrap_or(1),
        u32::try_from(day).unwrap_or(1),
        u32::try_from(of_day / 3600).unwrap_or(0),
        u32::try_from((of_day % 3600) / 60).unwrap_or(0),
        u32::try_from(of_day % 60).unwrap_or(0),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2026-03-01 12:00:00 UTC.
    const NOON_UTC: i64 = 1_772_366_400_000;

    #[test]
    fn timestamps_are_local_iso_8601() {
        assert_eq!(iso_local(NOON_UTC, 0), "2026-03-01T12:00:00+00:00");
        assert_eq!(iso_local(NOON_UTC, 7200), "2026-03-01T14:00:00+02:00");
        assert_eq!(iso_local(NOON_UTC, -18_000), "2026-03-01T07:00:00-05:00");
        assert_eq!(
            iso_local(NOON_UTC + 5_009_000, 19_800),
            "2026-03-01T18:53:29+05:30"
        );
        // A negative offset that crosses midnight lands on the day before.
        assert_eq!(
            iso_local(NOON_UTC - 11 * 3_600_000, -7200),
            "2026-02-28T23:00:00-02:00"
        );
        assert_eq!(file_name(NOON_UTC, 0), "muna-screen-time-2026-03-01.csv");
    }

    #[test]
    fn rows_are_quoted_only_when_needed() {
        let rows = [
            CsvRow {
                start_ms: NOON_UTC,
                end_ms: NOON_UTC + 90_500,
                exe: "code.exe",
                name: "Visual Studio Code",
                category: "development",
            },
            CsvRow {
                start_ms: NOON_UTC + 90_500,
                end_ms: NOON_UTC + 100_000,
                exe: "odd.exe",
                name: "Say \"hi\", friend",
                category: "other",
            },
        ];
        let csv = render(&rows, 0);
        let lines: Vec<&str> = csv.split("\r\n").collect();
        assert_eq!(lines[0], HEADER);
        assert_eq!(
            lines[1],
            "2026-03-01T12:00:00+00:00,2026-03-01T12:01:30+00:00,code.exe,Visual Studio Code,development,90"
        );
        assert_eq!(
            lines[2],
            "2026-03-01T12:01:30+00:00,2026-03-01T12:01:40+00:00,odd.exe,\"Say \"\"hi\"\", friend\",other,9"
        );
        assert_eq!(lines[3], "", "the file ends with a line break");
    }
}
