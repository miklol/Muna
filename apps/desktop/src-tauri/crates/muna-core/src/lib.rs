//! Platform-independent core for Muna: the strip scheduler, versioned settings and the SQLite
//! store. Nothing in this crate touches the OS or Tauri, so every type is testable with plain
//! `cargo test` (docs/09-testing-qa.md).

// `unsafe` belongs to `muna-platform::windows` only (docs/03-architecture.md, crate boundaries).
#![forbid(unsafe_code)]

pub mod activities;
pub mod artwork;
pub mod clock;
pub mod settings;
pub mod shell_settings;
pub mod store;
pub mod tasks;
pub mod wire;

pub use activities::{
    Activity, ActivityState, Glyph, Hub, Leading, Notice, PomodoroPhase, Scheduler, StripContent,
    StripMessage, StripSink, Tint, Trailing, Waker,
};
pub use artwork::{ArtCache, Artwork, ArtworkError};
pub use clock::{Clock, FakeClock, SystemClock};
pub use settings::{
    GeneralSettings, JsonValue, ReducedMotion, Settings, SettingsError, SettingsStore,
};
pub use shell_settings::{MonitorLayout, NotchShape, PlacementMode, ShellSettings, StripHeight};
pub use store::{PomodoroSessionRecord, Store, StoreError};
pub use tasks::{Due, INBOX_LIST_ID, NewTask, Task, TaskList, TaskPatch};
pub use wire::{Finite, Int53};
