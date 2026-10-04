//! Helpers for types that cross the IPC boundary.
//!
//! specta refuses to export 64-bit integers (they would become `bigint`) and exports floats as
//! `number | null` (docs/build-plan/m0-foundations.md, IPC). Values that are provably within
//! ±2^53 — Unix milliseconds, sort orders — are held exactly by a JavaScript `number`, so a
//! field can stay `i64` in Rust and SQLite and still export as a plain `number`:
//!
//! ```text
//! #[specta(type = Int53)]
//! pub created_at_ms: i64,
//! #[specta(type = Option<Int53>)]
//! pub due_ms: Option<i64>,
//! ```
//!
//! Anything that may exceed 2^53 (byte counts of large files, nanoseconds) must either be
//! saturated with [`Int53::saturate`] where it crosses, or not use it.
//!
//! Floats have the same problem in the other direction: `NaN` and the infinities serialise as
//! `null`, so specta writes `f64` as `number | null`. A value that is provably finite — one
//! parsed from JSON, which cannot spell `NaN`, or clamped before it crosses — exports as a plain
//! `number` through [`Finite`]:
//!
//! ```text
//! #[specta(type = Finite)]
//! pub temperature_c: f64,
//! #[specta(type = Option<Finite>)]
//! pub uv_index: Option<f64>,
//! ```

use specta::datatype::{DataType, Primitive};
use specta::{Type, Types};

/// Marker for `#[specta(type = Int53)]`: an `i64` known to fit a JavaScript `number`. Never a
/// runtime type; it only names the TypeScript side.
#[derive(Debug, Clone, Copy)]
pub struct Int53;

impl Int53 {
    /// `Number.MAX_SAFE_INTEGER`: the largest magnitude a JavaScript `number` holds exactly.
    pub const MAX: u64 = (1 << 53) - 1;

    /// Caps an unsigned quantity (a byte count) at [`Self::MAX`] so it can be exported as
    /// `Int53`: for values that are small on every real machine but not provably so.
    #[must_use]
    pub const fn saturate(value: u64) -> u64 {
        if value > Self::MAX { Self::MAX } else { value }
    }
}

impl Type for Int53 {
    fn definition(_: &mut Types) -> DataType {
        // `i32` is the widest signed primitive specta-typescript writes as a bare `number`.
        DataType::Primitive(Primitive::i32)
    }
}

/// Marker for `#[specta(type = Finite)]`: an `f64` known never to be `NaN` or infinite, so
/// the TypeScript side is a plain `number`. Never a runtime type.
#[derive(Debug, Clone, Copy)]
pub struct Finite;

impl Type for Finite {
    fn definition(_: &mut Types) -> DataType {
        // The only primitive specta-typescript writes as a bare `number`; TypeScript does not
        // tell integers from floats.
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
        assert!(matches!(
            Finite::definition(&mut types),
            DataType::Primitive(Primitive::i32)
        ));
    }

    #[test]
    fn saturates_at_the_safe_integer_limit() {
        assert_eq!(Int53::saturate(0), 0);
        assert_eq!(Int53::saturate(Int53::MAX), Int53::MAX);
        assert_eq!(Int53::saturate(u64::MAX), Int53::MAX);
        assert_eq!(Int53::MAX, 9_007_199_254_740_991);
    }
}
