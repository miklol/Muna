//! Platform-independent core for Muna: the strip scheduler, versioned settings and the SQLite
//! store. Nothing in this crate touches the OS or Tauri, so every type is testable with plain
//! `cargo test` (docs/09-testing-qa.md).

pub mod clock;
pub mod scheduler;
pub mod settings;
pub mod store;

pub use clock::{Clock, FakeClock, SystemClock};
pub use scheduler::{Activity, Notice, Scheduler, StripContent};
pub use settings::{
    GeneralSettings, JsonValue, ReducedMotion, Settings, SettingsError, SettingsStore,
};
pub use store::{Store, StoreError};
