//! The loopback hook receiver (docs/modules/ai-coding.md, `LocalReceiver` in the M4 build plan):
//! an HTTP/1.1 server on `127.0.0.1` that coding agents post their events to. Every request
//! carries the module's bearer token (a per-install secret the hook installer writes into the
//! agent's configuration), bodies are capped at [`BODY_LIMIT`], requests at
//! [`RATE_PER_SECOND`], and every connection closes after one exchange. A `PermissionRequest`
//! is *held*: the answer is written when the user decides on the strip, or after
//! [`HOLD_TIMEOUT`] with the neutral reply so the agent falls back to its own prompt.
//!
//! The server knows nothing about sessions; it parses, checks and hands the JSON to a
//! [`HookHandler`] (the service), which decides synchronously.

use std::convert::Infallible;
use std::io;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use http_body_util::{BodyExt, Full, Limited};
use hyper::body::{Bytes, Incoming};
use hyper::header::{AUTHORIZATION, CONNECTION, CONTENT_TYPE};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use parking_lot::Mutex;
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use super::settings::PORT_ATTEMPTS;

/// The largest request body accepted.
pub const BODY_LIMIT: usize = 64 * 1024;
/// Requests per second across all clients; a burst up to this many is allowed.
pub const RATE_PER_SECOND: u32 = 30;
/// How long a held permission request waits for the user before the neutral reply goes out.
/// Under the 30 s the installer gives the agent's own hook timeout.
pub const HOLD_TIMEOUT: Duration = Duration::from_secs(25);
/// The health route, unauthenticated: it says only that Muna listens here.
pub const HEALTH_ROUTE: &str = "/health";
/// The route Claude Code posts to.
pub const CLAUDE_ROUTE: &str = "/hooks/claude";
/// The documented route for any other process.
pub const GENERIC_ROUTE: &str = "/hooks/generic";

/// Which adapter a post is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Claude,
    Generic,
}

/// What the handler wants sent back.
pub enum Reply {
    /// Answer now.
    Now(Value),
    /// Answer when `decision` resolves; after [`HOLD_TIMEOUT`] (or when the sender is dropped)
    /// answer `fallback`, telling the handler through [`HookHandler::hold_expired`] on a
    /// timeout.
    Hold {
        session: String,
        decision: oneshot::Receiver<Value>,
        fallback: Value,
    },
}

impl std::fmt::Debug for Reply {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Now(_) => f.write_str("Reply::Now"),
            Self::Hold { session, .. } => f
                .debug_struct("Reply::Hold")
                .field("session", session)
                .finish(),
        }
    }
}

/// Why a well-formed post was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HookError {
    /// The document lacks what the route needs (422).
    #[error("{0}")]
    Invalid(String),
    /// The module is turned off (503).
    #[error("module is off")]
    Off,
}

/// The service side of the receiver; called from connection tasks, so it must be quick and
/// must not block on the agent.
pub trait HookHandler: Send + Sync {
    /// `peer_port` is the client's ephemeral port, which traces the post to its process.
    fn handle(&self, route: Route, body: Value, peer_port: u16) -> Result<Reply, HookError>;
    /// A held request went out with its fallback because nobody decided in time.
    fn hold_expired(&self, session: &str);
}

/// Binds `127.0.0.1:preferred`, or the next free port among the following [`PORT_ATTEMPTS`].
/// Returns the listener and the port it got.
pub async fn bind(preferred: u16) -> io::Result<(TcpListener, u16)> {
    let mut last = io::Error::new(io::ErrorKind::AddrInUse, "no port available");
    for offset in 0..=PORT_ATTEMPTS {
        let Some(port) = preferred.checked_add(offset) else {
            break;
        };
        match TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port))).await {
            Ok(listener) => {
                let port = listener.local_addr()?.port();
                return Ok((listener, port));
            }
            Err(error) => last = error,
        }
    }
    Err(last)
}

/// Accepts connections until the future is dropped; each is served on its own task.
pub async fn serve(listener: TcpListener, handler: Arc<dyn HookHandler>, token: Arc<str>) {
    let limiter = Arc::new(Mutex::new(Bucket::new(RATE_PER_SECOND)));
    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(accepted) => accepted,
            Err(error) => {
                tracing::warn!(%error, "hook receiver accept failed");
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        };
        if !peer.ip().is_loopback() {
            continue;
        }
        let handler = Arc::clone(&handler);
        let token = Arc::clone(&token);
        let limiter = Arc::clone(&limiter);
        tokio::spawn(async move {
            let service = service_fn(move |request| {
                let handler = Arc::clone(&handler);
                let token = Arc::clone(&token);
                let limiter = Arc::clone(&limiter);
                async move {
                    Ok::<_, Infallible>(
                        respond(request, peer.port(), &handler, &token, &limiter).await,
                    )
                }
            });
            if let Err(error) = http1::Builder::new()
                .keep_alive(false)
                .serve_connection(TokioIo::new(stream), service)
                .await
            {
                tracing::debug!(%error, "hook connection ended with an error");
            }
        });
    }
}

async fn respond(
    request: Request<Incoming>,
    peer_port: u16,
    handler: &Arc<dyn HookHandler>,
    token: &str,
    limiter: &Mutex<Bucket>,
) -> Response<Full<Bytes>> {
    let path = request.uri().path().to_owned();
    if request.method() == Method::GET && path == HEALTH_ROUTE {
        return reply(StatusCode::OK, &json!({ "name": "muna", "ok": true }));
    }
    let route = match path.as_str() {
        CLAUDE_ROUTE => Route::Claude,
        GENERIC_ROUTE => Route::Generic,
        _ => return reply(StatusCode::NOT_FOUND, &error_body("unknown route")),
    };
    if request.method() != Method::POST {
        return reply(StatusCode::METHOD_NOT_ALLOWED, &error_body("post only"));
    }
    if !limiter.lock().take() {
        return reply(
            StatusCode::TOO_MANY_REQUESTS,
            &error_body("too many requests"),
        );
    }
    let authorised = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .is_some_and(|presented| same(presented.trim().as_bytes(), token.as_bytes()));
    if !authorised {
        return reply(
            StatusCode::UNAUTHORIZED,
            &error_body("missing or wrong token"),
        );
    }
    let body = match Limited::new(request.into_body(), BODY_LIMIT)
        .collect()
        .await
    {
        Ok(collected) => collected.to_bytes(),
        Err(_) => return reply(StatusCode::PAYLOAD_TOO_LARGE, &error_body("body too large")),
    };
    let Ok(document) = serde_json::from_slice::<Value>(&body) else {
        return reply(StatusCode::BAD_REQUEST, &error_body("body is not JSON"));
    };
    match handler.handle(route, document, peer_port) {
        Ok(Reply::Now(answer)) => reply(StatusCode::OK, &answer),
        Ok(Reply::Hold {
            session,
            decision,
            fallback,
        }) => match tokio::time::timeout(HOLD_TIMEOUT, decision).await {
            Ok(Ok(answer)) => reply(StatusCode::OK, &answer),
            Ok(Err(_)) => reply(StatusCode::OK, &fallback),
            Err(_) => {
                handler.hold_expired(&session);
                reply(StatusCode::OK, &fallback)
            }
        },
        Err(HookError::Invalid(message)) => {
            reply(StatusCode::UNPROCESSABLE_ENTITY, &error_body(&message))
        }
        Err(HookError::Off) => reply(
            StatusCode::SERVICE_UNAVAILABLE,
            &error_body("module is off"),
        ),
    }
}

fn error_body(message: &str) -> Value {
    json!({ "error": message })
}

fn reply(status: StatusCode, body: &Value) -> Response<Full<Bytes>> {
    let bytes = serde_json::to_vec(body).unwrap_or_else(|_| b"{}".to_vec());
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "application/json")
        .header(CONNECTION, "close")
        .body(Full::new(Bytes::from(bytes)))
        .unwrap_or_else(|_| Response::new(Full::new(Bytes::from_static(b"{}"))))
}

/// Equality that takes the same time for every wrong token of the right length.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// A token bucket: `rate` requests per second, holding at most `rate` at once.
#[derive(Debug)]
pub struct Bucket {
    rate: f64,
    tokens: f64,
    last: Instant,
}

impl Bucket {
    #[must_use]
    pub fn new(rate: u32) -> Self {
        Self {
            rate: f64::from(rate),
            tokens: f64::from(rate),
            last: Instant::now(),
        }
    }

    /// Takes one request's worth if available.
    pub fn take(&mut self) -> bool {
        self.take_at(Instant::now())
    }

    /// [`Self::take`] at a chosen instant, for tests.
    pub fn take_at(&mut self, now: Instant) -> bool {
        let elapsed = now.saturating_duration_since(self.last).as_secs_f64();
        self.last = now;
        self.tokens = (self.tokens + elapsed * self.rate).min(self.rate);
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}
