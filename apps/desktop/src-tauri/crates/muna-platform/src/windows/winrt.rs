//! `WinRT` plumbing shared by the services: a bounded `IAsyncOperation` wait and a bounded
//! stream read. Every wait in this crate has a deadline (see the location module for the
//! broker that was once seen never answering).

use std::sync::mpsc;
use std::time::Duration;

use windows::Storage::Streams::{
    Buffer, DataReader, IRandomAccessStreamReference, InputStreamOptions,
};
use windows::Win32::Foundation::ERROR_TIMEOUT;
use windows::core::RuntimeType;
use windows_future::{AsyncOperationCompletedHandler, IAsyncOperation};

use crate::types::Thumbnail;

/// `FILETIME`/`DateTime` ticks (100 ns) between 1601-01-01 and 1970-01-01.
pub(super) const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;

/// `DateTime.UniversalTime` (100 ns ticks since 1601) → whole Unix milliseconds, clamped at
/// the epoch for the nonsense values a misbehaving sender can report.
pub(super) fn universal_ticks_to_unix_ms(ticks: i64) -> i64 {
    ticks.saturating_sub(UNIX_EPOCH_TICKS).max(0) / 10_000
}

/// `IAsyncOperation::join` with a deadline: past it the operation is cancelled and the result is
/// `ERROR_TIMEOUT`. `WinRT` invokes the completed handler at once for an operation that has
/// already finished, so there is no window to miss.
pub(super) fn join_within<T>(
    operation: &IAsyncOperation<T>,
    wait: Duration,
) -> windows::core::Result<T>
where
    T: RuntimeType + 'static,
{
    let (done, completed) = mpsc::channel::<()>();
    operation.SetCompleted(&AsyncOperationCompletedHandler::new(move |_, _| {
        // The receiver is gone once the wait is over; a late completion is nothing to report.
        let _ = done.send(());
        Ok(())
    }))?;
    if completed.recv_timeout(wait).is_err() {
        let _ = operation.Cancel();
        return Err(windows::core::Error::from_hresult(
            ERROR_TIMEOUT.to_hresult(),
        ));
    }
    operation.GetResults()
}

/// Reads a whole image stream (album art, an app logo). `Ok(None)` for an empty stream or one
/// larger than `max_bytes`.
pub(super) fn read_image(
    reference: &IRandomAccessStreamReference,
    max_bytes: u64,
) -> windows::core::Result<Option<Thumbnail>> {
    let stream = reference.OpenReadAsync()?.join()?;
    let size = stream.Size()?;
    if size == 0 || size > max_bytes {
        return Ok(None);
    }
    let content_type = stream
        .ContentType()
        .map(|s| s.to_string_lossy())
        .unwrap_or_default();
    // Bounded by `max_bytes` (a u32 at most at every call site), so the cast cannot truncate.
    #[allow(clippy::cast_possible_truncation)]
    let size = size as u32;
    let buffer = Buffer::Create(size)?;
    let input = stream.GetInputStreamAt(0)?;
    let filled = input
        .ReadAsync(&buffer, size, InputStreamOptions::ReadAhead)?
        .join()?;
    let reader = DataReader::FromBuffer(&filled)?;
    let length = reader.UnconsumedBufferLength()? as usize;
    let mut bytes = vec![0u8; length];
    reader.ReadBytes(&mut bytes)?;
    Ok(Some(Thumbnail {
        bytes,
        content_type,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn universal_ticks_convert_to_unix_milliseconds() {
        assert_eq!(universal_ticks_to_unix_ms(UNIX_EPOCH_TICKS), 0);
        // 2026-09-26T09:00:00Z.
        assert_eq!(
            universal_ticks_to_unix_ms(UNIX_EPOCH_TICKS + 1_790_413_200 * 10_000_000),
            1_790_413_200_000
        );
        assert_eq!(universal_ticks_to_unix_ms(0), 0, "before 1970 clamps");
        assert_eq!(universal_ticks_to_unix_ms(i64::MIN), 0, "never overflows");
    }

    #[test]
    fn a_finished_operation_is_answered_at_once() {
        let operation = IAsyncOperation::<i32>::ready(Ok(7));
        assert_eq!(
            join_within(&operation, Duration::from_millis(10)).unwrap(),
            7
        );
    }

    #[test]
    fn an_operation_that_completes_in_time_is_answered() {
        let operation = IAsyncOperation::<i32>::spawn(|| {
            std::thread::sleep(Duration::from_millis(20));
            Ok(3)
        });
        assert_eq!(join_within(&operation, Duration::from_secs(5)).unwrap(), 3);
    }

    #[test]
    fn an_operation_that_never_finishes_reports_a_timeout() {
        let operation = IAsyncOperation::<i32>::spawn(|| {
            std::thread::sleep(Duration::from_secs(2));
            Ok(1)
        });
        let started = std::time::Instant::now();
        let error = join_within(&operation, Duration::from_millis(50)).unwrap_err();
        assert_eq!(error.code(), ERROR_TIMEOUT.to_hresult());
        assert!(started.elapsed() < Duration::from_secs(1), "gave up late");
    }
}
