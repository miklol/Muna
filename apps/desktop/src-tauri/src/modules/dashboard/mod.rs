//! Dashboard module (docs/modules/dashboard.md): the widget grid composing the other modules'
//! widgets. The grid lives entirely in the frontend — every widget reads its own module's
//! snapshot through the contract — so this half owns nothing but the settings namespace that
//! persists the layout. It registers all the same (ADR-0004: every module has both halves, and
//! the id is the settings namespace both read), with no tasks and no platform access.

pub mod settings;

pub use settings::{DashboardSettings, DashboardSlot};

use super::{ModuleBackend, ModuleCtx, Surface};

/// Module id and settings namespace.
pub const ID: &str = "dashboard";

/// The registry entry. Nothing to start: the layout is read by the UI straight from the
/// settings document, and the widgets subscribe to their own modules.
#[derive(Debug, Default, Clone, Copy)]
pub struct DashboardModule;

impl ModuleBackend for DashboardModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Panel]
    }

    fn start(&self, _ctx: ModuleCtx) -> anyhow::Result<()> {
        Ok(())
    }
}
