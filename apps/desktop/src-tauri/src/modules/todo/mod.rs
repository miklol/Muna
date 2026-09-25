//! The `todo` module backend (docs/modules/todo.md): a local-first task list in SQLite with
//! lists, due dates and a trash with retention. The strip shows the next task due within the
//! hour and announces a task at its due time; the panel and settings pane talk to
//! [`TodoService`] through the IPC commands.
//!
//! Time is read from `muna_core::Clock` and passed in, so `tests/todo.rs` drives the service
//! with a `FakeClock`. Nothing here ticks: the backend sleeps until the next due boundary (or
//! forever when no timed task is open) and re-evaluates after every command and on unlock.

pub mod settings;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use muna_core::{
    Activity, Clock, Due, Glyph, Hub, Int53, Leading, NewTask, Notice, Settings, Store, StoreError,
    StripMessage, Task, TaskList, TaskPatch, Tint, Trailing, activities::priority,
};
use muna_platform::PlatformEvent;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tokio::sync::Notify;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use settings::TodoSettings;

pub const ID: &str = "todo";
/// The activity for the next task due within [`LEAD`].
pub const DUE_ACTIVITY_ID: &str = "todo:due";

/// How far ahead of its time a task takes the strip.
pub const LEAD: Duration = Duration::from_mins(60);
/// How long an overdue task stays in the strip after its time.
pub const GRACE: Duration = Duration::from_mins(15);

/// The notice id for a task that just became due.
#[must_use]
pub fn due_notice_id(task_id: &str) -> String {
    format!("todo:due:{task_id}")
}

/// What the panel renders: every list and every task that has not been purged. A personal
/// list stays small enough to ship whole; the UI filters by list and state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodoSnapshot {
    pub lists: Vec<TaskList>,
    pub tasks: Vec<Task>,
    /// `settings.modules.todo.retentionDays`, so the trash can say when a task goes.
    pub retention_days: u16,
}

/// A due date as the UI sends it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TaskDue {
    /// Unix milliseconds; a JS `number` holds it exactly.
    #[specta(type = Int53)]
    pub at_ms: i64,
    /// The date names a day, not a moment; never announced.
    pub all_day: bool,
}

impl From<TaskDue> for Due {
    fn from(due: TaskDue) -> Self {
        Self {
            at_ms: due.at_ms,
            all_day: due.all_day,
        }
    }
}

/// What the panel and the settings pane can ask for. Every command answers with the snapshot
/// after it; commands naming a task or list that no longer exists are no-ops.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TodoCommand {
    /// A new task at the top of `list_id`. A blank title is refused.
    Add {
        list_id: String,
        title: String,
        due: Option<TaskDue>,
    },
    Rename {
        id: String,
        title: String,
    },
    SetNotes {
        id: String,
        notes: String,
    },
    /// `None` clears the due date.
    SetDue {
        id: String,
        due: Option<TaskDue>,
    },
    Complete {
        id: String,
        completed: bool,
    },
    /// To the trash.
    Delete {
        id: String,
    },
    Restore {
        id: String,
    },
    /// Out of the trash for good.
    Purge {
        id: String,
    },
    EmptyTrash,
    /// The named tasks take this order at the top of the list.
    Reorder {
        list_id: String,
        ids: Vec<String>,
    },
    AddList {
        name: String,
    },
    RenameList {
        id: String,
        name: String,
    },
    /// The list's tasks move to the default list's trash.
    DeleteList {
        id: String,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum TodoError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("a task needs a title")]
    EmptyTitle,
    #[error("a list needs a name")]
    EmptyName,
}

/// Where the module reports changes; the shell bridges it to a Tauri event.
pub trait TodoSink: Send + Sync {
    fn changed(&self, snapshot: &TodoSnapshot);
}

pub struct TodoService {
    hub: Arc<Hub>,
    store: Arc<Store>,
    clock: Arc<dyn Clock>,
    settings: Mutex<TodoSettings>,
    sink: Mutex<Option<Arc<dyn TodoSink>>>,
    /// Wall time of the last evaluation; dues that fell in `(last, now]` are announced.
    last_evaluated_ms: Mutex<Option<i64>>,
    /// Task id → the due time already announced, so an edited due time announces again.
    announced: Mutex<HashMap<String, i64>>,
    /// The task (and its due time) the strip activity shows right now.
    showing: Mutex<Option<(String, i64)>>,
    /// Wakes the loop after a command so a new due boundary is honoured at once.
    wake: Notify,
}

impl std::fmt::Debug for TodoService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TodoService")
            .field("settings", &*self.settings.lock())
            .field("showing", &*self.showing.lock())
            .finish_non_exhaustive()
    }
}

impl TodoService {
    #[must_use]
    pub fn new(hub: Arc<Hub>, store: Arc<Store>, clock: Arc<dyn Clock>) -> Self {
        Self {
            hub,
            store,
            clock,
            settings: Mutex::new(TodoSettings::default()),
            sink: Mutex::new(None),
            last_evaluated_ms: Mutex::new(None),
            announced: Mutex::new(HashMap::new()),
            showing: Mutex::new(None),
            wake: Notify::new(),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn TodoSink>) {
        *self.sink.lock() = Some(sink);
    }

    #[must_use]
    pub fn settings(&self) -> TodoSettings {
        self.settings.lock().clone()
    }

    fn now_ms(&self) -> i64 {
        unix_ms(self.clock.system_time())
    }

    /// Everything the panel shows.
    pub fn snapshot(&self) -> Result<TodoSnapshot, StoreError> {
        Ok(TodoSnapshot {
            lists: self.store.task_lists()?,
            tasks: self.store.tasks()?,
            retention_days: self.settings.lock().retention_days,
        })
    }

    /// Applies a command, re-evaluates the strip and tells the sink. The reply is the snapshot
    /// after the command.
    pub fn command(&self, command: TodoCommand) -> Result<TodoSnapshot, TodoError> {
        let now = self.now_ms();
        match command {
            TodoCommand::Add {
                list_id,
                title,
                due,
            } => {
                let title = title.trim();
                if title.is_empty() {
                    return Err(TodoError::EmptyTitle);
                }
                self.store.insert_task(
                    &NewTask {
                        list_id: &list_id,
                        title,
                        notes: "",
                        due_ms: due.map(|due| due.at_ms),
                        all_day: due.is_some_and(|due| due.all_day),
                    },
                    now,
                )?;
            }
            TodoCommand::Rename { id, title } => {
                let title = title.trim();
                if title.is_empty() {
                    return Err(TodoError::EmptyTitle);
                }
                self.store.update_task(
                    &id,
                    &TaskPatch {
                        title: Some(title.to_owned()),
                        ..TaskPatch::default()
                    },
                    now,
                )?;
            }
            TodoCommand::SetNotes { id, notes } => {
                self.store.update_task(
                    &id,
                    &TaskPatch {
                        notes: Some(notes),
                        ..TaskPatch::default()
                    },
                    now,
                )?;
            }
            TodoCommand::SetDue { id, due } => {
                self.store.update_task(
                    &id,
                    &TaskPatch {
                        due: Some(due.map(Due::from)),
                        ..TaskPatch::default()
                    },
                    now,
                )?;
                // A moved due time is news again.
                self.announced.lock().remove(&id);
            }
            TodoCommand::Complete { id, completed } => {
                self.store.set_task_completed(&id, completed, now)?;
            }
            TodoCommand::Delete { id } => {
                self.store.set_task_deleted(&id, true, now)?;
            }
            TodoCommand::Restore { id } => {
                self.store.set_task_deleted(&id, false, now)?;
            }
            TodoCommand::Purge { id } => {
                self.store.purge_task(&id)?;
            }
            TodoCommand::EmptyTrash => {
                self.store.purge_trash()?;
            }
            TodoCommand::Reorder { list_id, ids } => {
                self.store.reorder_tasks(&list_id, &ids, now)?;
            }
            TodoCommand::AddList { name } => {
                let name = name.trim();
                if name.is_empty() {
                    return Err(TodoError::EmptyName);
                }
                self.store.insert_task_list(name, now)?;
            }
            TodoCommand::RenameList { id, name } => {
                let name = name.trim();
                if name.is_empty() {
                    return Err(TodoError::EmptyName);
                }
                self.store.rename_task_list(&id, name, now)?;
            }
            TodoCommand::DeleteList { id } => {
                self.store.delete_task_list(&id, now)?;
            }
        }
        self.evaluate();
        let snapshot = self.snapshot()?;
        self.notify(&snapshot);
        self.wake.notify_one();
        Ok(snapshot)
    }

    /// Applies `settings.modules.todo` (start-up and every settings change).
    pub fn apply_settings(&self, settings: &Settings) {
        let next = TodoSettings::from_document(settings);
        {
            let mut current = self.settings.lock();
            if *current == next {
                return;
            }
            *current = next;
        }
        self.evaluate();
        match self.snapshot() {
            Ok(snapshot) => self.notify(&snapshot),
            Err(error) => tracing::warn!(%error, "todo snapshot failed after settings change"),
        }
        self.wake.notify_one();
    }

    /// Purges old trash, announces tasks that became due since the last evaluation and points
    /// the strip activity at the next task due within [`LEAD`]. Called on start, after every
    /// command, at every due boundary and on unlock (a resume the clock may have slept through).
    pub fn evaluate(&self) {
        let now = self.now_ms();
        let settings = self.settings.lock().clone();
        let cutoff = now.saturating_sub(duration_ms(settings.retention()));
        match self.store.purge_tasks_deleted_before(cutoff) {
            Ok(0) => {}
            Ok(purged) => tracing::info!(purged, "todo trash purged past retention"),
            Err(error) => tracing::warn!(%error, "todo trash purge failed"),
        }

        let last = self.last_evaluated_ms.lock().replace(now);
        if settings.due_notices
            && let Some(last) = last
            && last < now
        {
            match self.store.timed_tasks_due_between(last + 1, now) {
                Ok(due) => {
                    let mut announced = self.announced.lock();
                    for task in due {
                        let Some(at) = task.due_ms else { continue };
                        if announced.get(&task.id) == Some(&at) {
                            continue;
                        }
                        announced.insert(task.id.clone(), at);
                        self.hub.publish_notice(due_notice(&task));
                    }
                }
                Err(error) => tracing::warn!(%error, "todo due query failed"),
            }
        }

        let next = if settings.show_due_in_strip {
            self.store
                .next_timed_task_due_from(now.saturating_sub(duration_ms(GRACE)))
                .unwrap_or_else(|error| {
                    tracing::warn!(%error, "todo next-due query failed");
                    None
                })
                .filter(|task| task.due_ms.is_some_and(|at| at <= now + duration_ms(LEAD)))
        } else {
            None
        };
        let mut showing = self.showing.lock();
        match next {
            Some(task) => {
                let at = task.due_ms.unwrap_or(now);
                let key = (task.id.clone(), at);
                if showing.as_ref() != Some(&key) {
                    self.hub.publish_activity(due_activity(&task));
                    *showing = Some(key);
                }
            }
            None => {
                if showing.take().is_some() {
                    self.hub.retract_activity(DUE_ACTIVITY_ID);
                }
            }
        }
    }

    /// How long the loop may sleep: until the next due boundary (a task entering the strip,
    /// becoming due, or dropping off), or forever when no open task has a due time ahead.
    #[must_use]
    pub fn next_wake(&self) -> Option<Duration> {
        let now = self.now_ms();
        let settings = self.settings.lock().clone();
        let mut soonest: Option<i64> = None;
        let mut consider = |at: i64| {
            if at > now {
                soonest = Some(soonest.map_or(at, |current| current.min(at)));
            }
        };
        if settings.show_due_in_strip
            && let Ok(Some(task)) = self
                .store
                .next_timed_task_due_from(now.saturating_sub(duration_ms(GRACE)))
            && let Some(at) = task.due_ms
        {
            // Enters the strip, then drops off.
            consider(at - duration_ms(LEAD));
            consider(at + duration_ms(GRACE));
        }
        if settings.due_notices
            && let Ok(Some(task)) = self.store.next_timed_task_due_from(now + 1)
            && let Some(at) = task.due_ms
        {
            consider(at);
        }
        soonest.map(|at| Duration::from_millis(u64::try_from(at - now).unwrap_or(0)))
    }

    fn notify(&self, snapshot: &TodoSnapshot) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.changed(snapshot);
        }
    }
}

/// The strip activity for the next task due within the hour: the check glyph, the due time
/// on the right and the title in the wide form.
#[must_use]
pub fn due_activity(task: &Task) -> Activity {
    Activity {
        id: DUE_ACTIVITY_ID.into(),
        module: ID.into(),
        priority: priority::TASK_DUE,
        leading: Some(Leading::Icon {
            glyph: Glyph::CheckCircle,
            tint: Some(Tint::Blue),
        }),
        trailing: task.due_ms.map(|at_ms| Trailing::Time { at_ms }),
        wide: Some(StripMessage::TaskDue {
            title: task.title.clone(),
        }),
    }
}

/// The notice at a task's due time; holds the strip for the default 4 s.
#[must_use]
pub fn due_notice(task: &Task) -> Notice {
    Notice {
        id: due_notice_id(&task.id),
        module: ID.into(),
        priority: priority::TASK_DUE,
        leading: Some(Leading::Icon {
            glyph: Glyph::CheckCircle,
            tint: Some(Tint::Blue),
        }),
        trailing: None,
        wide: Some(StripMessage::TaskDue {
            title: task.title.clone(),
        }),
        hold_ms: 0,
    }
}

fn duration_ms(duration: Duration) -> i64 {
    i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
}

fn unix_ms(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

/// The backend: evaluates once at start, then sleeps until the next due boundary, a command
/// or an unlock.
#[derive(Debug, Clone)]
pub struct TodoModule(pub Arc<TodoService>);

impl ModuleBackend for TodoModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Strip, Surface::Panel]
    }

    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()> {
        let service = Arc::clone(&self.0);
        let mut events = ctx.platform.subscribe();
        tauri::async_runtime::spawn(async move {
            service.evaluate();
            loop {
                let wait = service.next_wake();
                tokio::select! {
                    () = async {
                        match wait {
                            Some(wait) => tokio::time::sleep(wait).await,
                            None => std::future::pending().await,
                        }
                    } => {}
                    () = service.wake.notified() => {}
                    event = events.recv() => match event {
                        // An unlock usually follows a resume the monotonic timer slept through.
                        Ok(PlatformEvent::SessionLockChanged { locked: false }) => {}
                        Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    },
                }
                service.evaluate();
            }
        });
        Ok(())
    }
}
