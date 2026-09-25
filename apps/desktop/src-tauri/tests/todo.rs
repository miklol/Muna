//! The `todo` module against `FakeClock` and an in-memory store (docs/modules/todo.md
//! acceptance criteria, docs/build-plan/m3-daily-modules.md E2). Integration tests because the
//! `muna` lib cannot host unit tests (Common Controls manifest on Tauri-linked tests).

use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use muna_core::{
    Clock, FakeClock, Glyph, Hub, INBOX_LIST_ID, Leading, Settings, Store, StripContent,
    StripMessage, StripSink, Task, Tint, Trailing, activities::priority,
};
use muna_lib::modules::todo::{
    DUE_ACTIVITY_ID, GRACE, LEAD, TaskDue, TodoCommand, TodoError, TodoService, TodoSettings,
    TodoSink, TodoSnapshot, due_notice_id,
};
use parking_lot::Mutex;

const MINUTE: Duration = Duration::from_secs(60);
const HOUR: Duration = Duration::from_hours(1);
const DAY: Duration = Duration::from_hours(24);

#[derive(Default)]
struct Recorder {
    snapshots: Mutex<Vec<TodoSnapshot>>,
    strip: Mutex<Vec<StripContent>>,
}

impl TodoSink for Recorder {
    fn changed(&self, snapshot: &TodoSnapshot) {
        self.snapshots.lock().push(snapshot.clone());
    }
}

impl StripSink for Recorder {
    fn strip_changed(&self, content: &StripContent) {
        self.strip.lock().push(content.clone());
    }
}

struct Rig {
    clock: Arc<FakeClock>,
    hub: Arc<Hub>,
    service: Arc<TodoService>,
    recorder: Arc<Recorder>,
}

impl Rig {
    fn new() -> Self {
        Self::with_settings(&TodoSettings::default())
    }

    fn with_settings(settings: &TodoSettings) -> Self {
        let clock = Arc::new(FakeClock::new());
        let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
        let store = Arc::new(Store::open_in_memory().expect("in-memory store"));
        let service = Arc::new(TodoService::new(
            Arc::clone(&hub),
            store,
            Arc::clone(&clock) as Arc<dyn Clock>,
        ));
        let recorder = Arc::new(Recorder::default());
        service.set_sink(Arc::clone(&recorder) as Arc<dyn TodoSink>);
        hub.add_sink(Arc::clone(&recorder) as Arc<dyn StripSink>);
        let mut document = Settings::default();
        settings.write(&mut document).expect("settings serialise");
        service.apply_settings(&document);
        // What the backend loop does first.
        service.evaluate();
        Self {
            clock,
            hub,
            service,
            recorder,
        }
    }

    fn now_ms(&self) -> i64 {
        i64::try_from(
            self.clock
                .system_time()
                .duration_since(UNIX_EPOCH)
                .expect("after the epoch")
                .as_millis(),
        )
        .expect("fits")
    }

    /// Lets time pass and evaluates the way the loop would when its sleep ends.
    fn pass(&self, by: Duration) {
        self.clock.advance(by);
        self.hub.refresh();
        self.service.evaluate();
    }

    fn command(&self, command: TodoCommand) -> TodoSnapshot {
        self.service.command(command).expect("command applies")
    }

    fn add(&self, title: &str, due: Option<TaskDue>) -> Task {
        let snapshot = self.command(TodoCommand::Add {
            list_id: INBOX_LIST_ID.into(),
            title: title.into(),
            due,
        });
        snapshot
            .tasks
            .into_iter()
            .find(|task| task.title == title.trim())
            .expect("the task was added")
    }

    fn task(&self, id: &str) -> Option<Task> {
        self.snapshot().tasks.into_iter().find(|task| task.id == id)
    }

    fn snapshot(&self) -> TodoSnapshot {
        self.service.snapshot().expect("snapshot")
    }

    fn strip_activity(&self) -> Option<muna_core::Activity> {
        self.hub
            .activities()
            .into_iter()
            .map(|held| held.activity)
            .find(|activity| activity.id == DUE_ACTIVITY_ID)
    }

    fn shown_notice(&self) -> Option<muna_core::Notice> {
        match self.hub.current() {
            StripContent::Notice { notice } => Some(notice),
            _ => None,
        }
    }

    /// Every notice the strip showed for `task_id`, in order.
    fn notices_for(&self, task_id: &str) -> Vec<muna_core::Notice> {
        let id = due_notice_id(task_id);
        self.recorder
            .strip
            .lock()
            .iter()
            .filter_map(|content| match content {
                StripContent::Notice { notice } if notice.id == id => Some(notice.clone()),
                _ => None,
            })
            .collect()
    }
}

fn ms(duration: Duration) -> i64 {
    i64::try_from(duration.as_millis()).expect("fits")
}

fn timed(at_ms: i64) -> TaskDue {
    TaskDue {
        at_ms,
        all_day: false,
    }
}

fn all_day(at_ms: i64) -> TaskDue {
    TaskDue {
        at_ms,
        all_day: true,
    }
}

// --- tasks ------------------------------------------------------------------------------------

#[test]
fn a_fresh_profile_has_the_default_list_and_no_tasks() {
    let rig = Rig::new();
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.lists.len(), 1);
    assert_eq!(snapshot.lists[0].id, INBOX_LIST_ID);
    assert_eq!(
        snapshot.lists[0].name, None,
        "the UI localises the default list"
    );
    assert!(snapshot.tasks.is_empty());
    assert_eq!(snapshot.retention_days, 30);
    assert_eq!(rig.hub.current(), StripContent::Idle);
    assert_eq!(rig.service.next_wake(), None, "nothing due means no timer");
}

#[test]
fn a_new_task_goes_on_top_and_the_sink_hears_about_it() {
    let rig = Rig::new();
    let first = rig.add("Buy milk", None);
    let second = rig.add("Call Sam", None);
    let snapshot = rig.snapshot();
    let ids: Vec<&str> = snapshot.tasks.iter().map(|task| task.id.as_str()).collect();
    assert_eq!(ids, [second.id.as_str(), first.id.as_str()]);
    assert!(second.sort_order < first.sort_order);
    assert_eq!(second.list_id, INBOX_LIST_ID);
    assert_eq!(second.created_at_ms, rig.now_ms());
    assert_eq!(
        rig.recorder.snapshots.lock().len(),
        2,
        "one snapshot per command"
    );
    assert_eq!(rig.recorder.snapshots.lock().last(), Some(&snapshot));
}

#[test]
fn a_blank_title_is_refused_and_changes_nothing() {
    let rig = Rig::new();
    let result = rig.service.command(TodoCommand::Add {
        list_id: INBOX_LIST_ID.into(),
        title: "   ".into(),
        due: None,
    });
    assert!(matches!(result, Err(TodoError::EmptyTitle)));
    assert!(rig.snapshot().tasks.is_empty());
    assert!(
        rig.recorder.snapshots.lock().is_empty(),
        "nothing to report"
    );

    let task = rig.add("Keep me", None);
    let result = rig.service.command(TodoCommand::Rename {
        id: task.id.clone(),
        title: String::new(),
    });
    assert!(matches!(result, Err(TodoError::EmptyTitle)));
    assert_eq!(
        rig.task(&task.id).map(|task| task.title),
        Some("Keep me".into())
    );
}

#[test]
fn titles_and_notes_are_trimmed_and_edited_in_place() {
    let rig = Rig::new();
    let task = rig.add("  Water plants  ", None);
    assert_eq!(task.title, "Water plants");
    rig.pass(MINUTE);
    rig.command(TodoCommand::Rename {
        id: task.id.clone(),
        title: " Water the plants ".into(),
    });
    rig.command(TodoCommand::SetNotes {
        id: task.id.clone(),
        notes: "Balcony too".into(),
    });
    let edited = rig.task(&task.id).expect("still there");
    assert_eq!(edited.title, "Water the plants");
    assert_eq!(edited.notes, "Balcony too");
    assert_eq!(edited.updated_at_ms, rig.now_ms());
    assert_eq!(edited.created_at_ms, task.created_at_ms);
}

#[test]
fn complete_trash_restore_and_purge_round_trip() {
    let rig = Rig::new();
    let task = rig.add("Send invoice", None);

    rig.command(TodoCommand::Complete {
        id: task.id.clone(),
        completed: true,
    });
    assert_eq!(
        rig.task(&task.id).and_then(|task| task.completed_at_ms),
        Some(rig.now_ms())
    );
    rig.command(TodoCommand::Complete {
        id: task.id.clone(),
        completed: false,
    });
    assert_eq!(
        rig.task(&task.id).and_then(|task| task.completed_at_ms),
        None
    );

    rig.pass(MINUTE);
    rig.command(TodoCommand::Delete {
        id: task.id.clone(),
    });
    assert_eq!(
        rig.task(&task.id).and_then(|task| task.deleted_at_ms),
        Some(rig.now_ms()),
        "the trash keeps the task"
    );
    rig.command(TodoCommand::Restore {
        id: task.id.clone(),
    });
    assert_eq!(rig.task(&task.id).and_then(|task| task.deleted_at_ms), None);

    rig.command(TodoCommand::Delete {
        id: task.id.clone(),
    });
    rig.command(TodoCommand::Purge {
        id: task.id.clone(),
    });
    assert_eq!(rig.task(&task.id), None, "purged for good");
}

#[test]
fn commands_on_unknown_ids_are_no_ops() {
    let rig = Rig::new();
    let task = rig.add("Real", None);
    for command in [
        TodoCommand::Rename {
            id: "ghost".into(),
            title: "Boo".into(),
        },
        TodoCommand::Complete {
            id: "ghost".into(),
            completed: true,
        },
        TodoCommand::Delete { id: "ghost".into() },
        TodoCommand::Restore { id: "ghost".into() },
        TodoCommand::Purge { id: "ghost".into() },
        TodoCommand::RenameList {
            id: "ghost".into(),
            name: "Boo".into(),
        },
        TodoCommand::DeleteList { id: "ghost".into() },
    ] {
        let snapshot = rig.command(command);
        assert_eq!(snapshot.tasks, vec![task.clone()]);
        assert_eq!(snapshot.lists.len(), 1);
    }
}

#[test]
fn empty_trash_purges_only_trashed_tasks() {
    let rig = Rig::new();
    let open = rig.add("Open", None);
    let done = rig.add("Done", None);
    let gone = rig.add("Gone", None);
    rig.command(TodoCommand::Complete {
        id: done.id.clone(),
        completed: true,
    });
    rig.command(TodoCommand::Delete {
        id: gone.id.clone(),
    });
    let snapshot = rig.command(TodoCommand::EmptyTrash);
    let ids: Vec<&str> = snapshot.tasks.iter().map(|task| task.id.as_str()).collect();
    assert_eq!(ids, [done.id.as_str(), open.id.as_str()]);
}

#[test]
fn the_trash_is_purged_past_retention_without_a_timer() {
    let rig = Rig::with_settings(&TodoSettings {
        retention_days: 1,
        ..TodoSettings::default()
    });
    let task = rig.add("Old news", None);
    rig.command(TodoCommand::Delete {
        id: task.id.clone(),
    });
    assert_eq!(
        rig.service.next_wake(),
        None,
        "retention rides on other wake-ups"
    );

    rig.pass(DAY.saturating_sub(MINUTE));
    assert!(rig.task(&task.id).is_some(), "still restorable");
    rig.pass(2 * MINUTE);
    assert_eq!(rig.task(&task.id), None, "gone after a day");
}

#[test]
fn retention_is_clamped_to_its_bounds() {
    let rig = Rig::with_settings(&TodoSettings {
        retention_days: 0,
        ..TodoSettings::default()
    });
    assert_eq!(rig.service.settings().retention_days, 1);
    assert_eq!(rig.snapshot().retention_days, 1);
}

#[test]
fn reorder_puts_the_named_tasks_on_top_in_that_order() {
    let rig = Rig::new();
    let a = rig.add("A", None);
    let b = rig.add("B", None);
    let c = rig.add("C", None);
    // Newest first: c, b, a.
    let snapshot = rig.command(TodoCommand::Reorder {
        list_id: INBOX_LIST_ID.into(),
        ids: vec![a.id.clone(), c.id.clone()],
    });
    let ids: Vec<&str> = snapshot.tasks.iter().map(|task| task.id.as_str()).collect();
    assert_eq!(ids, [a.id.as_str(), c.id.as_str(), b.id.as_str()]);
}

// --- lists ------------------------------------------------------------------------------------

#[test]
fn lists_are_added_renamed_and_deleted_into_the_default_trash() {
    let rig = Rig::new();
    let snapshot = rig.command(TodoCommand::AddList {
        name: "  Work ".into(),
    });
    let work = snapshot
        .lists
        .iter()
        .find(|list| list.name.as_deref() == Some("Work"))
        .expect("trimmed and added")
        .clone();
    assert!(
        work.sort_order > snapshot.lists[0].sort_order,
        "after the default list"
    );

    rig.command(TodoCommand::RenameList {
        id: work.id.clone(),
        name: "Office".into(),
    });
    assert_eq!(
        rig.snapshot()
            .lists
            .iter()
            .find(|list| list.id == work.id)
            .and_then(|list| list.name.clone()),
        Some("Office".into())
    );

    let task = rig.command(TodoCommand::Add {
        list_id: work.id.clone(),
        title: "Review PR".into(),
        due: None,
    });
    let task = task
        .tasks
        .into_iter()
        .find(|task| task.list_id == work.id)
        .expect("in the new list");

    let snapshot = rig.command(TodoCommand::DeleteList {
        id: work.id.clone(),
    });
    assert_eq!(snapshot.lists.len(), 1, "only the default list remains");
    let moved = snapshot
        .tasks
        .iter()
        .find(|candidate| candidate.id == task.id)
        .expect("kept in the trash");
    assert_eq!(moved.list_id, INBOX_LIST_ID);
    assert_eq!(moved.deleted_at_ms, Some(rig.now_ms()));
}

#[test]
fn the_default_list_cannot_be_deleted_and_blank_names_are_refused() {
    let rig = Rig::new();
    let snapshot = rig.command(TodoCommand::DeleteList {
        id: INBOX_LIST_ID.into(),
    });
    assert_eq!(snapshot.lists.len(), 1);
    assert_eq!(snapshot.lists[0].id, INBOX_LIST_ID);

    let result = rig
        .service
        .command(TodoCommand::AddList { name: " ".into() });
    assert!(matches!(result, Err(TodoError::EmptyName)));
    let result = rig.service.command(TodoCommand::RenameList {
        id: INBOX_LIST_ID.into(),
        name: String::new(),
    });
    assert!(matches!(result, Err(TodoError::EmptyName)));
    assert_eq!(rig.snapshot().lists[0].name, None);
}

// --- strip activity ---------------------------------------------------------------------------

#[test]
fn a_task_due_within_the_hour_takes_the_strip_and_drops_off_after_grace() {
    let rig = Rig::new();
    let at = rig.now_ms() + ms(2 * HOUR);
    let task = rig.add("Dentist", Some(timed(at)));
    assert_eq!(rig.strip_activity(), None, "two hours out is too early");
    assert_eq!(
        rig.service.next_wake(),
        Some(HOUR),
        "wake when it enters the strip"
    );

    rig.pass(HOUR);
    let activity = rig.strip_activity().expect("now within the hour");
    assert_eq!(activity.module, "todo");
    assert_eq!(activity.priority, priority::TASK_DUE);
    assert_eq!(
        activity.leading,
        Some(Leading::Icon {
            glyph: Glyph::CheckCircle,
            tint: Some(Tint::Blue),
        })
    );
    assert_eq!(activity.trailing, Some(Trailing::Time { at_ms: at }));
    assert_eq!(
        activity.wide,
        Some(StripMessage::TaskDue {
            title: "Dentist".into()
        })
    );
    assert_eq!(rig.service.next_wake(), Some(HOUR), "wake at the due time");
    assert!(rig.notices_for(&task.id).is_empty(), "not due yet");

    rig.pass(HOUR);
    assert!(rig.strip_activity().is_some(), "overdue tasks linger");
    assert_eq!(rig.service.next_wake(), Some(GRACE), "wake to drop it");

    rig.pass(GRACE + Duration::from_secs(1));
    assert_eq!(rig.strip_activity(), None, "gone after the grace period");
    assert_eq!(rig.service.next_wake(), None);
}

#[test]
fn the_earliest_open_timed_task_wins_and_completing_it_moves_on() {
    let rig = Rig::new();
    let now = rig.now_ms();
    let later = rig.add("Later", Some(timed(now + ms(30 * MINUTE))));
    let soon = rig.add("Soon", Some(timed(now + ms(10 * MINUTE))));
    assert_eq!(
        rig.strip_activity().and_then(|activity| activity.wide),
        Some(StripMessage::TaskDue {
            title: "Soon".into()
        })
    );
    assert_eq!(rig.service.next_wake(), Some(10 * MINUTE));

    rig.command(TodoCommand::Complete {
        id: soon.id,
        completed: true,
    });
    assert_eq!(
        rig.strip_activity().and_then(|activity| activity.trailing),
        Some(Trailing::Time {
            at_ms: later.due_ms.unwrap()
        }),
        "completed tasks leave the strip"
    );

    rig.command(TodoCommand::Delete { id: later.id });
    assert_eq!(rig.strip_activity(), None, "trashed tasks too");
}

#[test]
fn all_day_tasks_never_take_the_strip_or_announce() {
    let rig = Rig::new();
    let now = rig.now_ms();
    let task = rig.add("Pay rent", Some(all_day(now)));
    assert_eq!(rig.strip_activity(), None);
    assert_eq!(rig.service.next_wake(), None);
    rig.pass(MINUTE);
    assert!(rig.notices_for(&task.id).is_empty());
    assert_eq!(rig.hub.current(), StripContent::Idle);
}

#[test]
fn an_overdue_task_within_grace_shows_at_startup_without_a_notice() {
    let rig = Rig::new();
    let at = rig.now_ms() - ms(5 * MINUTE);
    let task = rig.add("Missed", Some(timed(at)));
    assert!(rig.strip_activity().is_some(), "still within grace");
    assert!(
        rig.notices_for(&task.id).is_empty(),
        "a due time that passed before we looked is not news"
    );
    rig.pass(MINUTE);
    assert!(rig.notices_for(&task.id).is_empty());
}

#[test]
fn hiding_the_strip_activity_retracts_it_at_once() {
    let rig = Rig::new();
    let now = rig.now_ms();
    rig.add("Standup", Some(timed(now + ms(5 * MINUTE))));
    assert!(rig.strip_activity().is_some());

    let mut document = Settings::default();
    TodoSettings {
        show_due_in_strip: false,
        ..TodoSettings::default()
    }
    .write(&mut document)
    .unwrap();
    rig.service.apply_settings(&document);
    assert_eq!(rig.strip_activity(), None);
    assert_eq!(
        rig.service.next_wake(),
        Some(5 * MINUTE),
        "the notice still needs a wake-up"
    );
    assert_eq!(
        rig.recorder.snapshots.lock().len(),
        2,
        "the settings change is reported to the panel"
    );

    TodoSettings::default().write(&mut document).unwrap();
    rig.service.apply_settings(&document);
    assert!(rig.strip_activity().is_some(), "back when re-enabled");
}

// --- notices ----------------------------------------------------------------------------------

#[test]
fn a_task_is_announced_once_at_its_due_time() {
    let rig = Rig::new();
    let at = rig.now_ms() + ms(10 * MINUTE);
    let task = rig.add("Call Sam", Some(timed(at)));

    rig.pass(10 * MINUTE);
    let notice = rig.shown_notice().expect("announced at its time");
    assert_eq!(notice.id, due_notice_id(&task.id));
    assert_eq!(notice.module, "todo");
    assert_eq!(notice.priority, priority::TASK_DUE);
    assert_eq!(
        notice.wide,
        Some(StripMessage::TaskDue {
            title: "Call Sam".into()
        })
    );
    assert_eq!(notice.trailing, None, "the time is now; no need to show it");

    rig.pass(Duration::from_secs(1));
    rig.service.evaluate();
    rig.pass(MINUTE);
    assert_eq!(rig.notices_for(&task.id).len(), 1, "announced exactly once");
    assert!(
        rig.strip_activity().is_some(),
        "the activity stays behind the notice"
    );
}

#[test]
fn a_moved_due_time_is_announced_again() {
    let rig = Rig::new();
    let at = rig.now_ms() + ms(10 * MINUTE);
    let task = rig.add("Follow up", Some(timed(at)));
    rig.pass(10 * MINUTE);
    assert_eq!(rig.notices_for(&task.id).len(), 1);

    let moved = rig.now_ms() + ms(20 * MINUTE);
    rig.command(TodoCommand::SetDue {
        id: task.id.clone(),
        due: Some(timed(moved)),
    });
    assert_eq!(
        rig.strip_activity().and_then(|activity| activity.trailing),
        Some(Trailing::Time { at_ms: moved })
    );
    rig.pass(20 * MINUTE);
    assert_eq!(rig.notices_for(&task.id).len(), 2);

    rig.command(TodoCommand::SetDue {
        id: task.id.clone(),
        due: None,
    });
    assert_eq!(rig.strip_activity(), None, "no due time, nothing to show");
    assert_eq!(rig.task(&task.id).and_then(|task| task.due_ms), None);
}

#[test]
fn a_due_time_slept_through_is_announced_on_the_next_evaluation() {
    let rig = Rig::new();
    let at = rig.now_ms() + ms(10 * MINUTE);
    let task = rig.add("Wake up call", Some(timed(at)));
    // The machine slept past the due time; unlock triggers the next evaluation.
    rig.clock.sleep(HOUR);
    rig.hub.refresh();
    rig.service.evaluate();
    assert_eq!(
        rig.notices_for(&task.id).len(),
        1,
        "late is better than never"
    );
    assert_eq!(
        rig.strip_activity(),
        None,
        "but an hour late is past the grace period"
    );
}

#[test]
fn notices_can_be_turned_off() {
    let rig = Rig::with_settings(&TodoSettings {
        due_notices: false,
        ..TodoSettings::default()
    });
    let at = rig.now_ms() + ms(10 * MINUTE);
    let task = rig.add("Quiet", Some(timed(at)));
    assert_eq!(
        rig.service.next_wake(),
        Some(10 * MINUTE + GRACE),
        "only the drop-off boundary remains"
    );
    rig.pass(10 * MINUTE);
    assert!(rig.notices_for(&task.id).is_empty());
    assert!(rig.strip_activity().is_some(), "the activity is separate");
}

#[test]
fn with_everything_off_the_module_sleeps_forever() {
    let rig = Rig::with_settings(&TodoSettings {
        due_notices: false,
        show_due_in_strip: false,
        ..TodoSettings::default()
    });
    let at = rig.now_ms() + ms(10 * MINUTE);
    rig.add("Silent", Some(timed(at)));
    assert_eq!(rig.service.next_wake(), None);
    rig.pass(HOUR);
    assert_eq!(rig.hub.current(), StripContent::Idle);
}

#[test]
fn completed_and_trashed_tasks_schedule_no_wake_up() {
    let rig = Rig::new();
    let now = rig.now_ms();
    let done = rig.add("Done", Some(timed(now + ms(10 * MINUTE))));
    let gone = rig.add("Gone", Some(timed(now + ms(20 * MINUTE))));
    rig.command(TodoCommand::Complete {
        id: done.id,
        completed: true,
    });
    rig.command(TodoCommand::Delete { id: gone.id });
    assert_eq!(rig.service.next_wake(), None);
    assert_eq!(rig.strip_activity(), None);
}

#[test]
fn a_far_off_task_wakes_when_it_enters_the_strip() {
    let rig = Rig::new();
    let at = rig.now_ms() + ms(3 * DAY);
    rig.add("Renew passport", Some(timed(at)));
    assert_eq!(
        rig.service.next_wake(),
        Some((3 * DAY).saturating_sub(LEAD))
    );
}
