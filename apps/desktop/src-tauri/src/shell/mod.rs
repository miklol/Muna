//! Notch shell (docs/modules/notch-shell.md): window placement, hit-testing, yield rules and
//! the per-monitor window lifecycle. Pure logic lives in [`layout`], [`hit_test`],
//! [`yield_rules`] and [`model`] so it is tested against `muna_platform::FakePlatform` in
//! `tests/`; [`manager`] is the Tauri glue, [`spike`] the M0-E2 diagnostic mode
//! (`MUNA_SPIKE=window`).

pub mod hit_test;
pub mod layout;
pub mod manager;
pub mod model;
pub mod spike;
pub mod yield_rules;
