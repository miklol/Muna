//! Helpers for types that cross the IPC boundary.
//!
//! specta refuses to export 64-bit integers (they would become `bigint`) and exports floats as
//! `number | null` (docs/build-plan/m0-foundations.md, IPC). Values that are provably within
//! ±2^53 — Unix milliseconds, sort orders — are held exactly by a JavaScript `number`, so a
//! field can stay `i64` in Rust and SQLite and still export as a plain `number`:
//!
//! ```ignore
//! #[specta(type = Int53)]
//! pub created_at_ms: i64,
//! #[specta(type = Option<Int53>)]
//! pub due_ms: Option<i64>,
//! ```
//!
//! Anything that may exceed 2^53 (byte counts of large files, nanoseconds) must not use it.

use specta::datatype::{DataType, Primitive};
use specta::{Type, Types};

/// Marker for `#[specta(type = Int53)]`: an `i64` known to fit a JavaScript `number`. Never a
/// runtime type; it only names the TypeScript side.
#[derive(Debug, Clone, Copy)]
pub struct Int53;

impl Type for Int53 {
    fn definition(_: &mut Types) -> DataType {
        // `i32` is the widest signed primitive specta-typescript writes as a bare `number`.
        DataType::Primitive(Primitive::i32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exports_as_a_plain_number() {
        let mut types = Types::default();
        assert!(matches!(
            Int53::definition(&mut types),
            DataType::Primitive(Primitive::i32)
        ));
        assert!(matches!(
            <Option<Int53>>::definition(&mut types),
            DataType::Nullable(_)
        ));
    }
}
