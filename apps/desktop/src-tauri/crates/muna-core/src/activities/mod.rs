//! Live activities: the runtime concept that decides what the collapsed strip shows
//! (docs/modules/live-activities.md, ADR-0004).
//!
//! Modules publish [`Activity`] records (long-lived, prioritised, focusable) and [`Notice`]
//! records (short, pre-empting) through a [`Hub`]; the [`Scheduler`] resolves the current
//! [`StripContent`] and the hub tells its sinks when it changes. Modules never draw to the
//! strip themselves: the vocabulary below (slots, glyphs, tints, messages) is everything the
//! strip can show, and the UI maps each variant to a view.
//!
//! Every timing here is the one in docs/06-motion-spec.md ("Timings"); the module spec
//! defers to it.

mod hub;
mod scheduler;

use std::time::Duration;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::wire::Int53;

pub use hub::{Hub, StripSink, Waker};
pub use scheduler::{ActivityState, Scheduler};

/// How long a notice holds the strip unless it says otherwise (motion spec: 4 s).
pub const NOTICE_HOLD: Duration = Duration::from_millis(4000);
/// How long the wide form stays after an activity's text changes (motion spec: 2.5 s).
pub const WIDE_FORM_HOLD: Duration = Duration::from_millis(2500);
/// How often equal-priority activities take turns (motion spec: 8 s).
pub const TIE_ROTATION: Duration = Duration::from_millis(8000);

/// Default priorities (docs/modules/live-activities.md "Scheduler").
pub mod priority {
    pub const HUD: u8 = 100;
    pub const POWER: u8 = 90;
    pub const BLUETOOTH: u8 = 85;
    pub const POMODORO: u8 = 70;
    /// A drop action in flight (docs/modules/drop-actions.md): the user just asked for it,
    /// so it outranks scheduled content while it works, under the pomodoro they set running.
    pub const DROP_JOB: u8 = 68;
    pub const EVENT_STARTING: u8 = 65;
    pub const MEDIA_PLAYING: u8 = 60;
    /// A task due within the hour (docs/modules/todo.md); under playing media so an hour of
    /// lead time never hijacks the now-playing strip.
    pub const TASK_DUE: u8 = 55;
    /// A calendar event within the hour (docs/modules/calendar.md); under a task due, since
    /// the task named a moment the user chose, and rises to [`EVENT_STARTING`] at ten
    /// minutes.
    pub const EVENT_UPCOMING: u8 = 50;
    /// A review request or a finished check run on the user's pull request
    /// (docs/modules/code-hosting.md): a notice that pre-empts what is on the strip while it
    /// holds, ordered among notices under a task or an event the user themselves scheduled.
    pub const CODE_HOSTING: u8 = 45;
    pub const UNREAD: u8 = 40;
    pub const SESSION: u8 = 30;
    pub const MEDIA_PAUSED: u8 = 20;
    /// The system monitor's CPU strip gauge (docs/modules/system-monitor.md): ambient
    /// telemetry, so it sits under everything with a message, including paused media.
    pub const SYSTEM_GAUGE: u8 = 10;
    /// The day-progress bar (docs/modules/day-progress.md): the most ambient content of all,
    /// so even the CPU gauge outranks it.
    pub const DAY_PROGRESS: u8 = 5;
}

/// An accent from the design system (docs/05-design-system.md, colour tokens).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Tint {
    Blue,
    Cyan,
    Green,
    Orange,
    Red,
    Purple,
    Yellow,
    Pink,
}

/// A glyph the strip can draw; the UI maps each to its icon. Closed on purpose so the
/// mapping is exhaustive — add a variant here when a module needs a new one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Glyph {
    Battery,
    BatteryCharging,
    Bluetooth,
    Headphones,
    Lock,
    Unlock,
    Timer,
    Bell,
    Music,
    Moon,
    Play,
    /// Speaker with no waves (level 0).
    Volume,
    /// Speaker with one wave (1–33).
    VolumeLow,
    /// Speaker with two waves (34–66).
    VolumeMedium,
    /// Speaker with three waves (67–100).
    VolumeHigh,
    /// Speaker with a slash.
    VolumeMuted,
    Sun,
    Mic,
    MicMuted,
    /// A task (docs/modules/todo.md): a circle with a check.
    CheckCircle,
    /// A processor (docs/modules/system-monitor.md): the CPU strip gauge.
    Cpu,
    /// An hourglass (docs/modules/day-progress.md): the working day's progress bar.
    Hourglass,
    /// A calendar page (docs/modules/calendar.md): the next event, tinted like its source.
    Calendar,
    /// A folder (docs/modules/drop-actions.md): copying or moving dropped files.
    Folder,
    /// A zip archive (docs/modules/drop-actions.md): zipping or unzipping.
    Archive,
    /// A share arrow (docs/modules/drop-actions.md): the Nearby Share sheet.
    Share,
    /// A bin (docs/modules/drop-actions.md): sent to the Recycle Bin.
    Trash,
    /// A drive (docs/modules/drop-actions.md): a removable volume ejected.
    Drive,
    /// A tray (docs/modules/shelf.md): items parked on the Shelf.
    Shelf,
    /// A pull request (docs/modules/code-hosting.md): a review was requested.
    PullRequest,
    /// A circle with a cross (docs/modules/code-hosting.md): checks failed on a pull request.
    XCircle,
}

/// The leading (left) slot of the strip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Leading {
    Icon {
        glyph: Glyph,
        tint: Option<Tint>,
    },
    /// A battery glyph filled to `percent`, with a bolt while charging; the UI colours it by
    /// level (green charging, orange ≤ 20, red ≤ 10).
    Battery {
        percent: u8,
        charging: bool,
    },
    /// Album art or an app icon, as a data URL or asset URL. Rounded 6 px at 20 px. `glow` is
    /// a CSS colour from the artwork palette for the tinted halo behind it (docs/modules/
    /// media.md, strip form); `None` draws no halo (no palette yet, or adaptive colours off).
    Image {
        src: String,
        #[serde(default)]
        glow: Option<String>,
    },
}

/// The trailing (right) slot of the strip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Trailing {
    Icon {
        glyph: Glyph,
        tint: Option<Tint>,
    },
    /// Short text that is already words (a track position, a device name); tabular figures.
    Text {
        value: String,
    },
    /// A percentage the UI formats for the locale.
    Percent {
        value: u8,
    },
    /// A battery glyph filled to `percent`, with a bolt while charging.
    Battery {
        percent: u8,
        charging: bool,
    },
    /// A countdown. The UI ticks it locally from the moment it arrives, so the value need
    /// not be republished every second.
    Timer {
        remaining_ms: u32,
        total_ms: u32,
        running: bool,
    },
    /// A 0–100 progress track.
    Progress {
        percent: u8,
    },
    /// Audio bars beside album art (docs/modules/media.md, strip form). `playing` animates
    /// them; paused bars rest at a low level.
    Waveform {
        playing: bool,
    },
    /// The HUD's 96 px level track with a white fill (docs/modules/hud.md, "Visual"); the
    /// UI animates the fill between values. `muted` draws the fill dimmed.
    Level {
        percent: u8,
        muted: bool,
    },
    /// A wall-clock instant (Unix milliseconds) the UI formats as a short time for the locale
    /// (a task's due time, an event's start).
    Time {
        #[specta(type = Int53)]
        at_ms: i64,
    },
    /// A small whole number the UI formats for the locale (unread notifications).
    Count {
        value: u32,
    },
}

/// One line of text for the wide form. Built-in notices carry their *facts* rather than a
/// sentence so the UI can localise them; `Text` is for content that is already words
/// (a track title, a user label) and is never logged. Glyph-only notices (charging, lock)
/// have no message: the UI describes them from their slots for assistive technology.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StripMessage {
    Text {
        value: String,
    },
    BatteryLow {
        percent: u8,
    },
    BluetoothConnected {
        name: String,
        battery_percent: Option<u8>,
    },
    BluetoothDisconnected {
        name: String,
    },
    /// A connected Bluetooth device's battery fell to a threshold (docs/modules/bluetooth.md);
    /// the name is content and is never logged.
    DeviceBatteryLow {
        name: String,
        percent: u8,
    },
    TimerFinished {
        label: String,
    },
    /// A track change; both fields are content and never logged. The UI lays them out as
    /// title and artist (marquee only when they overflow).
    NowPlaying {
        title: String,
        artist: String,
    },
    /// The running pomodoro phase ("Focus", "Short break"); the trailing timer counts down.
    Pomodoro {
        phase: PomodoroPhase,
    },
    /// A pomodoro phase ran out (docs/modules/pomodoro.md).
    PomodoroFinished {
        phase: PomodoroPhase,
    },
    /// A task that is due soon or due now (docs/modules/todo.md); the title is content and is
    /// never logged. As an activity the trailing slot carries the due time; as a notice it
    /// announces the moment.
    TaskDue {
        title: String,
    },
    /// A calendar event within the hour or starting now (docs/modules/calendar.md); the title
    /// is content and is never logged. As an activity the trailing slot carries the start
    /// time; as a notice it announces the ten-minute mark.
    EventStarting {
        title: String,
    },
    /// A notification that just arrived, or the latest unread one (docs/modules/
    /// notifications.md); both fields are content and never logged. The UI lays them out as
    /// sender and title.
    Notification {
        app: String,
        title: String,
    },
    /// A drop action working on `count` items (docs/modules/drop-actions.md); the trailing
    /// slot carries its progress. The UI phrases it per action ("Zipping 3 items").
    DropRunning {
        action: DropActionKind,
        count: u32,
    },
    /// A drop action finished; `count` is how many items it handled.
    DropFinished {
        action: DropActionKind,
        count: u32,
    },
    /// A drop action failed or was cancelled by the user; the reason stays in the log.
    DropFailed {
        action: DropActionKind,
    },
    /// Someone asked the user to review a pull request (docs/modules/code-hosting.md); the
    /// title is content and is never logged. The UI phrases it ("Review requested · title").
    ReviewRequested {
        title: String,
    },
    /// The checks on a pull request the user opened finished (docs/modules/code-hosting.md);
    /// the title is content and is never logged.
    ChecksFinished {
        title: String,
        passed: bool,
    },
}

/// What a drop action does with the items, as a fact for the UI to phrase and tint
/// (docs/modules/drop-actions.md "Tiles"). Closed on purpose, like [`Glyph`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DropActionKind {
    Share,
    Copy,
    Move,
    Open,
    OpenWith,
    Zip,
    Unzip,
    Reveal,
    Trash,
    Eject,
    /// Parked on the Shelf (docs/modules/shelf.md).
    Shelf,
}

impl DropActionKind {
    /// The glyph the strip shows for this action.
    #[must_use]
    pub const fn glyph(self) -> Glyph {
        match self {
            Self::Share => Glyph::Share,
            Self::Copy | Self::Move | Self::Open | Self::OpenWith | Self::Reveal => Glyph::Folder,
            Self::Zip | Self::Unzip => Glyph::Archive,
            Self::Trash => Glyph::Trash,
            Self::Eject => Glyph::Drive,
            Self::Shelf => Glyph::Shelf,
        }
    }
}

/// One step of the pomodoro cycle; the UI localises the label and picks the tint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PomodoroPhase {
    Work,
    ShortBreak,
    LongBreak,
}

impl PomodoroPhase {
    /// `true` for the two break phases.
    #[must_use]
    pub const fn is_break(self) -> bool {
        matches!(self, Self::ShortBreak | Self::LongBreak)
    }
}

/// Long-lived strip content owned by a module (`id` is `<module>:<key>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub module: String,
    /// 0–100; higher wins. Defaults live in [`priority`].
    pub priority: u8,
    pub leading: Option<Leading>,
    pub trailing: Option<Trailing>,
    /// Text for the wide form. A change here shows the wide form for [`WIDE_FORM_HOLD`].
    pub wide: Option<StripMessage>,
}

/// Short, self-dismissing strip content. Pre-empts activities while held.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub id: String,
    pub module: String,
    pub priority: u8,
    pub leading: Option<Leading>,
    pub trailing: Option<Trailing>,
    pub wide: Option<StripMessage>,
    /// How long the notice holds the strip; `0` means [`NOTICE_HOLD`].
    pub hold_ms: u32,
}

impl Notice {
    /// The hold as a duration, with the default applied.
    #[must_use]
    pub fn hold(&self) -> Duration {
        if self.hold_ms == 0 {
            NOTICE_HOLD
        } else {
            Duration::from_millis(u64::from(self.hold_ms))
        }
    }
}

/// What the closed strip renders right now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StripContent {
    /// Nothing to show: the strip is the bare black shape.
    Idle,
    /// An activity; `wide` says whether its text is showing (the 2.5 s burst after a change).
    Activity { activity: Activity, wide: bool },
    /// A held notice; its text, when present, always shows.
    Notice { notice: Notice },
}

impl Trailing {
    /// Whether the slot keeps moving on its own after it arrived: playing audio bars and a
    /// running countdown tick without any new content; everything else animates once, when it
    /// changes.
    #[must_use]
    pub const fn animates(&self) -> bool {
        matches!(
            self,
            Self::Waveform { playing: true } | Self::Timer { running: true, .. }
        )
    }
}

impl StripContent {
    /// The id of the item on the strip, if any.
    #[must_use]
    pub fn item_id(&self) -> Option<&str> {
        match self {
            Self::Idle => None,
            Self::Activity { activity, .. } => Some(&activity.id),
            Self::Notice { notice } => Some(&notice.id),
        }
    }

    /// Whether the strip keeps animating without further changes: the wide text burst (its
    /// marquee), a playing waveform or a running timer, or any notice (short-lived, its text
    /// may scroll). A paused chip or a plain icon is still; the shell may trim the webviews
    /// while it shows.
    #[must_use]
    pub fn animates(&self) -> bool {
        match self {
            Self::Idle => false,
            Self::Activity { activity, wide } => {
                *wide || activity.trailing.as_ref().is_some_and(Trailing::animates)
            }
            Self::Notice { .. } => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_content_serialises_with_kind_tags() {
        let json = serde_json::to_value(StripContent::Idle).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "idle" }));

        let activity = Activity {
            id: "media:now-playing".into(),
            module: "media".into(),
            priority: priority::MEDIA_PLAYING,
            leading: Some(Leading::Image {
                src: "data:,".into(),
                glow: None,
            }),
            trailing: Some(Trailing::Progress { percent: 40 }),
            wide: Some(StripMessage::Text {
                value: "Song".into(),
            }),
        };
        let json = serde_json::to_value(StripContent::Activity {
            activity,
            wide: true,
        })
        .unwrap();
        assert_eq!(json["kind"], "activity");
        assert_eq!(json["wide"], true);
        assert_eq!(json["activity"]["leading"]["kind"], "image");
        assert_eq!(json["activity"]["trailing"]["kind"], "progress");
        assert_eq!(json["activity"]["wide"]["kind"], "text");
        assert_eq!(json["activity"]["wide"]["value"], "Song");
    }

    #[test]
    fn an_image_without_a_glow_still_deserialises() {
        // Producers that predate the halo omit the field; the strip draws none.
        let leading: Leading =
            serde_json::from_value(serde_json::json!({ "kind": "image", "src": "data:," }))
                .unwrap();
        assert_eq!(
            leading,
            Leading::Image {
                src: "data:,".into(),
                glow: None
            }
        );
    }

    #[test]
    fn built_in_messages_carry_facts_not_sentences() {
        let json = serde_json::to_value(StripMessage::BluetoothConnected {
            name: "AirPods".into(),
            battery_percent: Some(80),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "bluetoothConnected", "name": "AirPods", "batteryPercent": 80 })
        );
        let json = serde_json::to_value(Trailing::Battery {
            percent: 57,
            charging: true,
        })
        .unwrap();
        assert_eq!(json["kind"], "battery");
        assert_eq!(json["charging"], true);
        let json = serde_json::to_value(Trailing::Level {
            percent: 42,
            muted: false,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "level", "percent": 42, "muted": false })
        );
        assert_eq!(
            serde_json::to_value(Glyph::VolumeMuted).unwrap(),
            serde_json::json!("volumeMuted")
        );
    }

    #[test]
    fn notice_hold_defaults_to_the_motion_spec() {
        let mut notice = Notice {
            id: "x".into(),
            module: "x".into(),
            priority: 1,
            leading: None,
            trailing: None,
            wide: None,
            hold_ms: 0,
        };
        assert_eq!(notice.hold(), NOTICE_HOLD);
        notice.hold_ms = 1500;
        assert_eq!(notice.hold(), Duration::from_millis(1500));
    }

    #[test]
    fn only_moving_content_animates_without_changes() {
        let chip = |trailing: Option<Trailing>| Activity {
            id: "media:now-playing".into(),
            module: "media".into(),
            priority: priority::MEDIA_PLAYING,
            leading: None,
            trailing,
            wide: Some(StripMessage::Text {
                value: "Song".into(),
            }),
        };
        let still = |activity: Activity| StripContent::Activity {
            activity,
            wide: false,
        };
        assert!(!StripContent::Idle.animates());
        assert!(!still(chip(None)).animates());
        assert!(!still(chip(Some(Trailing::Waveform { playing: false }))).animates());
        assert!(!still(chip(Some(Trailing::Progress { percent: 40 }))).animates());
        assert!(
            !still(chip(Some(Trailing::Timer {
                remaining_ms: 5000,
                total_ms: 9000,
                running: false,
            })))
            .animates()
        );
        assert!(still(chip(Some(Trailing::Waveform { playing: true }))).animates());
        assert!(
            still(chip(Some(Trailing::Timer {
                remaining_ms: 5000,
                total_ms: 9000,
                running: true,
            })))
            .animates()
        );
        assert!(
            StripContent::Activity {
                activity: chip(None),
                wide: true,
            }
            .animates(),
            "the wide burst scrolls its text"
        );
        assert!(
            StripContent::Notice {
                notice: Notice {
                    id: "hud:volume".into(),
                    module: "hud".into(),
                    priority: 1,
                    leading: None,
                    trailing: None,
                    wide: None,
                    hold_ms: 0,
                },
            }
            .animates()
        );
    }
}
