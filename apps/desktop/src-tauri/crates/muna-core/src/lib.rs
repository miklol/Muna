//! Platform-independent core for Muna: the strip scheduler, versioned settings and the SQLite
//! store. Nothing in this crate touches the OS or Tauri, so every type is testable with plain
//! `cargo test` (docs/09-testing-qa.md).

// `unsafe` belongs to `muna-platform::windows` only (docs/03-architecture.md, crate boundaries).
#![forbid(unsafe_code)]

pub mod activities;
pub mod artwork;
pub mod clock;
pub mod drops;
pub mod health;
pub mod settings;
pub mod shelf;
pub mod shell_settings;
pub mod snap;
pub mod store;
pub mod tasks;
pub mod usage;
pub mod wire;

pub use activities::{
    Activity, ActivityState, DropActionKind, Glyph, HealthFlow, Hub, Leading, Notice,
    PomodoroPhase, Scheduler, StripContent, StripMessage, StripSink, Tint, Trailing, Waker,
};
pub use artwork::{ArtCache, Artwork, ArtworkError};
pub use clock::{Clock, FakeClock, SystemClock};
pub use drops::{DropSession, DropSessionId, DropSessions, SelfDrag};
pub use health::HealthDayRecord;
pub use settings::{
    Contrast, GeneralSettings, JsonValue, ReducedMotion, Settings, SettingsError, SettingsStore,
};
pub use shelf::{NewShelfItem, ShelfIntake, ShelfIntakeError, ShelfItemKind, ShelfRecord};
pub use shell_settings::{MonitorLayout, NotchShape, PlacementMode, ShellSettings, StripHeight};
pub use snap::{SnapSession, SnapSessionId, SnapSessions, SnapWindow};
pub use store::{PomodoroSessionRecord, Store, StoreError};
pub use tasks::{Due, INBOX_LIST_ID, NewTask, Task, TaskList, TaskPatch};
pub use usage::{AppSighting, UsageApp, UsageSession};
pub use wire::{Finite, Int53};
