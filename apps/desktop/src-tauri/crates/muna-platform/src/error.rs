use thiserror::Error;

/// Errors surfaced by platform services. Never contains user data (notification bodies,
/// tokens) so it is safe to log.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum PlatformError {
    /// The capability is not implemented on this platform or build (fake, non-Windows, or
    /// not yet landed). Callers degrade gracefully instead of failing.
    #[error("{0} is not supported on this platform")]
    Unsupported(&'static str),

    /// A Win32/WinRT call failed. `code` is the HRESULT / last error for diagnostics.
    #[error("{api} failed with code {code:#010x}")]
    Os { api: &'static str, code: u32 },

    /// The requested device, session or monitor no longer exists.
    #[error("{0} not found")]
    NotFound(String),

    /// The user has not granted the required permission (notification listener, etc.).
    #[error("access to {0} was denied")]
    AccessDenied(&'static str),
}

pub type PlatformResult<T> = Result<T, PlatformError>;
