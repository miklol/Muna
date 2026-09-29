//! Bridges the live-activities [`Hub`] to Tauri: strip changes become `StripContentChanged`
//! events and the hub's deadlines (notice hold, wide burst, tie rotation) are honoured by one
//! sleeping task that the hub wakes whenever its schedule changes. No polling: the task is
//! parked when nothing is due (perf budget, PRD §Performance).

use std::sync::Arc;

use muna_core::{Hub, StripContent, StripSink, Waker};
use tauri::{AppHandle, Manager};
use tauri_specta::Event;
use tokio::sync::Notify;

use crate::ipc::StripContentChanged;
use crate::shell::memory_target::Hold;
use crate::state::AppState;

struct EventSink {
    app: AppHandle,
}

impl StripSink for EventSink {
    fn strip_changed(&self, content: &StripContent) {
        // Content that keeps moving (playing waveform, running timer, the wide burst) holds the
        // webviews at the normal memory target; any change lifts a low target before the frame
        // lands, and a still chip lets the idle trim engage again 30 s later.
        if let Some(state) = self.app.try_state::<Arc<AppState>>()
            && let Some(shell) = &state.shell
        {
            shell.set_memory_hold(&self.app, Hold::StripContent, content.animates());
            shell.wake_webviews(&self.app);
        }
        if let Err(error) = (StripContentChanged {
            content: content.clone(),
        })
        .emit(&self.app)
        {
            tracing::warn!(%error, "failed to emit StripContentChanged");
        }
    }
}

struct NotifyWaker(Arc<Notify>);

impl Waker for NotifyWaker {
    fn wake(&self) {
        self.0.notify_one();
    }
}

/// Connects the hub to the app and starts the deadline task.
pub fn start(app: &AppHandle, hub: &Arc<Hub>) {
    hub.add_sink(Arc::new(EventSink { app: app.clone() }));
    let notify = Arc::new(Notify::new());
    hub.set_waker(Arc::new(NotifyWaker(Arc::clone(&notify))));
    let hub = Arc::clone(hub);
    tauri::async_runtime::spawn(async move {
        loop {
            match hub.next_deadline() {
                Some(deadline) => {
                    let sleep = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline));
                    tokio::select! {
                        () = sleep => { hub.refresh(); }
                        () = notify.notified() => {}
                    }
                }
                None => notify.notified().await,
            }
        }
    });
}
