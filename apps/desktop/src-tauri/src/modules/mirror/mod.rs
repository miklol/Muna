//! The `mirror` module backend (docs/modules/mirror.md): a quick camera check. The frames
//! never reach Rust — the panel opens the camera itself with `getUserMedia` — so the backend
//! is small on purpose: it owns the opt-in that lets the app's pages have the camera at all
//! (the [`PermissionPolicy`] the shell installs on every webview), and it knows which windows
//! are showing a preview so the shell keeps the renderer at its normal memory target while
//! frames are being decoded.
//!
//! [`MirrorService`] is the shared object: the IPC layer reaches it for `mirror_watch`, the
//! app hands it every settings change, and it tells a [`PreviewSink`] when the first preview
//! starts and the last one stops. `tests/mirror.rs` drives it directly.

pub mod settings;

use std::collections::HashSet;
use std::sync::Arc;

use muna_core::Settings;
use muna_platform::PermissionPolicy;
use parking_lot::Mutex;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use settings::MirrorSettings;

pub const ID: &str = "mirror";

/// Where the service reports that a preview is running somewhere (the shell lifts the low
/// memory target while one is).
pub trait PreviewSink: Send + Sync {
    fn previewing(&self, active: bool);
}

pub struct MirrorService {
    permissions: Arc<PermissionPolicy>,
    settings: Mutex<MirrorSettings>,
    /// Labels of the windows whose panel or widget has a running preview.
    watchers: Mutex<HashSet<String>>,
    sink: Mutex<Option<Arc<dyn PreviewSink>>>,
}

impl std::fmt::Debug for MirrorService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MirrorService")
            .field("settings", &*self.settings.lock())
            .field("watchers", &self.watchers.lock().len())
            .finish_non_exhaustive()
    }
}

impl Default for MirrorService {
    fn default() -> Self {
        Self::new()
    }
}

impl MirrorService {
    #[must_use]
    pub fn new() -> Self {
        Self {
            permissions: Arc::new(PermissionPolicy::new()),
            settings: Mutex::new(MirrorSettings::default()),
            watchers: Mutex::new(HashSet::new()),
            sink: Mutex::new(None),
        }
    }

    /// The policy the shell installs on its webviews; the camera flag follows
    /// `settings.modules.mirror.enabled`.
    #[must_use]
    pub fn permissions(&self) -> Arc<PermissionPolicy> {
        Arc::clone(&self.permissions)
    }

    pub fn set_sink(&self, sink: Arc<dyn PreviewSink>) {
        *self.sink.lock() = Some(sink);
    }

    #[must_use]
    pub fn settings(&self) -> MirrorSettings {
        self.settings.lock().clone()
    }

    /// Applies `settings.modules.mirror` (start-up and every settings change). Turning the
    /// module off closes the door for the next request and forgets every preview — the pages
    /// stop their streams themselves when the setting changes, but the hold must not outlive
    /// the permission.
    pub fn apply_settings(&self, settings: &Settings) {
        let next = MirrorSettings::from_document(settings);
        let previous = std::mem::replace(&mut *self.settings.lock(), next.clone());
        self.permissions.set_camera_allowed(next.enabled);
        if previous.enabled && !next.enabled {
            let had_watchers = {
                let mut watchers = self.watchers.lock();
                let had = !watchers.is_empty();
                watchers.clear();
                had
            };
            if had_watchers {
                self.emit_previewing(false);
            }
        }
    }

    /// A preview in the window `label` started (`true`) or stopped (`false`). A window that
    /// never had the camera unlocked cannot start one.
    pub fn watch(&self, label: &str, watching: bool) {
        if watching && !self.permissions.camera_allowed() {
            tracing::debug!(label, "mirror preview reported while the camera is off");
            return;
        }
        let transition = {
            let mut watchers = self.watchers.lock();
            let before = !watchers.is_empty();
            if watching {
                watchers.insert(label.to_owned());
            } else {
                watchers.remove(label);
            }
            let after = !watchers.is_empty();
            (before != after).then_some(after)
        };
        if let Some(active) = transition {
            self.emit_previewing(active);
        }
    }

    /// A notch window went away without stopping its preview.
    pub fn forget_window(&self, label: &str) {
        self.watch(label, false);
    }

    /// `true` while any window shows a preview.
    #[must_use]
    pub fn previewing(&self) -> bool {
        !self.watchers.lock().is_empty()
    }

    fn emit_previewing(&self, active: bool) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.previewing(active);
        }
    }
}

/// The backend: a settings namespace, a panel and a widget, no loop.
#[derive(Debug)]
pub struct MirrorModule(pub Arc<MirrorService>);

impl ModuleBackend for MirrorModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Panel, Surface::Widget]
    }

    fn start(&self, _ctx: ModuleCtx) -> anyhow::Result<()> {
        Ok(())
    }
}
