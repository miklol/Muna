//! Notch shell: window placement, hit-testing and (in M0) the window spike that validates
//! ADR-0002 on real hardware. Pure logic lives in [`layout`] and [`hit_test`] so it can be
//! tested against `muna_platform::FakePlatform`; [`spike`] is the Tauri glue.

pub mod hit_test;
pub mod layout;
pub mod spike;
