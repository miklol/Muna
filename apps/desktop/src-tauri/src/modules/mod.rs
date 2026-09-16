//! Module backends (ADR-0004, docs/03-architecture.md "Module contract").
//!
//! A backend is a Rust struct that subscribes to platform events and publishes typed state and
//! strip content through [`ModuleCtx`]; it never touches Tauri windows or the OS directly. The
//! registry in [`backends`] is the only place a module is named — adding one is a new folder
//! here plus one line there, no shell changes.
//!
//! `start` is synchronous and spawns whatever tasks the module needs: the trait must stay
//! dyn-compatible for the registry, which `async fn` in traits is not yet.

pub mod live_activities;
pub mod pomodoro;

use std::sync::Arc;

use muna_core::Hub;
use muna_platform::Platform;

/// A shell surface a module can own, so the shell can route to the single owner
/// (docs/03-architecture.md "Module contract").
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Surface {
    Strip,
    Panel,
    Widget,
    Hud,
    Drop,
    Snap,
}

/// What a backend may use: the platform services and the live-activities hub.
#[derive(Clone)]
pub struct ModuleCtx {
    pub platform: Arc<dyn Platform>,
    pub activities: Arc<Hub>,
}

impl std::fmt::Debug for ModuleCtx {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ModuleCtx")
            .field("platform", &self.platform.name())
            .finish_non_exhaustive()
    }
}

pub trait ModuleBackend: Send + Sync {
    /// Stable id, also the prefix of every activity id the module publishes.
    fn id(&self) -> &'static str;
    /// The surfaces this module renders into.
    fn capabilities(&self) -> &'static [Surface];
    /// Subscribes and spawns; returns once the module is running.
    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()>;
}

impl std::fmt::Debug for dyn ModuleBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ModuleBackend")
            .field("id", &self.id())
            .field("capabilities", &self.capabilities())
            .finish_non_exhaustive()
    }
}

/// Every backend in this build, in start order. Demo-only modules gate themselves.
#[must_use]
pub fn backends() -> Vec<Box<dyn ModuleBackend>> {
    let mut all: Vec<Box<dyn ModuleBackend>> = vec![Box::new(live_activities::LiveActivities)];
    if pomodoro::demo_enabled() {
        all.push(Box::new(pomodoro::PomodoroDemo));
    }
    all
}

/// Starts every backend; a module that fails to start is logged and skipped so one broken
/// source never takes the strip down with it.
pub fn start_all(ctx: &ModuleCtx) -> Vec<&'static str> {
    let mut started = Vec::new();
    for backend in backends() {
        match backend.start(ctx.clone()) {
            Ok(()) => {
                tracing::info!(module = backend.id(), "module started");
                started.push(backend.id());
            }
            Err(error) => {
                tracing::warn!(module = backend.id(), %error, "module failed to start");
            }
        }
    }
    started
}
