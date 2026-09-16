//! Lock and unlock notices from `WTS_SESSION_LOCK` / `WTS_SESSION_UNLOCK`.
//!
//! Glyph only, as the module spec draws it: the lock notice plays to a locked screen anyway
//! and the unlock one needs no words.

use muna_core::{Glyph, Leading, Notice, activities::priority};

const MODULE: &str = "live-activities";

/// Turns a lock-state change into its notice. The event only fires on transitions, so no
/// de-duplication is needed here.
#[must_use]
pub fn notice_for(locked: bool) -> Notice {
    let (id, glyph) = if locked {
        ("session:locked", Glyph::Lock)
    } else {
        ("session:unlocked", Glyph::Unlock)
    };
    Notice {
        id: id.into(),
        module: MODULE.into(),
        priority: priority::SESSION,
        leading: Some(Leading::Icon { glyph, tint: None }),
        trailing: None,
        wide: None,
        hold_ms: 0,
    }
}
