//! The `ai-coding` module (docs/modules/ai-coding.md, M4-E5): the JSONL tail, the git branch
//! reader, the Copilot CLI log reducer and folder discovery, the Claude Code hook flow with a
//! held permission request, the generic route, settings, the hook installer and the loopback
//! receiver — against `FakePlatform`, a `FakeClock`, an in-memory store and temp folders.
//! Integration tests because the `muna` lib cannot host unit tests (Common Controls manifest
//! on Tauri-linked tests).

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, UNIX_EPOCH};

use muna_core::{
    Clock, FakeClock, Hub, Settings, Store, StripContent, StripMessage, StripSink, Trailing,
};
use muna_lib::modules::ai_coding::{
    AiAgent, AiCodingCommand, AiCodingError, AiCodingPaths, AiCodingService, AiCodingSettings,
    AiCodingSink, AiCodingSnapshot, AiStatus, DEFAULT_PORT, HookError, HookHandler, ID, RECENT_FOR,
    Reply, Route, WaitingKind, activity_id, claude, copilot, git, hook_url, jsonl, receiver,
};
use muna_lib::modules::{ModuleServices, Surface, backends};
use muna_platform::{FakePlatform, Platform};
use parking_lot::Mutex;
use serde_json::{Value, json};
use tempfile::TempDir;

/// 2024-06-12 12:00:00 UTC.
const NOON_MS: i64 = 1_718_193_600_000;
const COPILOT_PID: u32 = 4242;
const CLAUDE_PID: u32 = 5151;
const TERMINAL: isize = 0x77;
const PEER_PORT: u16 = 51_234;

#[derive(Debug, Default)]
struct RecordingSink {
    snapshots: Mutex<Vec<AiCodingSnapshot>>,
}

impl AiCodingSink for RecordingSink {
    fn changed(&self, snapshot: &AiCodingSnapshot) {
        self.snapshots.lock().push(snapshot.clone());
    }
}

/// Records what the strip showed, since the hub only exposes what shows right now.
#[derive(Debug, Default)]
struct StripRecorder {
    notices: Mutex<Vec<StripMessage>>,
}

impl StripSink for StripRecorder {
    fn strip_changed(&self, content: &StripContent) {
        if let StripContent::Notice { notice } = content {
            self.notices.lock().push(
                notice
                    .wide
                    .clone()
                    .expect("a waiting notice carries its message"),
            );
        }
    }
}

struct Rig {
    platform: Arc<FakePlatform>,
    clock: Arc<FakeClock>,
    hub: Arc<Hub>,
    store: Arc<Store>,
    service: Arc<AiCodingService>,
    sink: Arc<RecordingSink>,
    strip: Arc<StripRecorder>,
    /// Stands in for `%USERPROFILE%`: `copilot/` is the session-state root, `claude.json` the
    /// Claude Code settings file.
    home: TempDir,
}

impl Rig {
    fn new() -> Self {
        let home = tempfile::tempdir().unwrap();
        let copilot_root = home.path().join("copilot");
        fs::create_dir_all(&copilot_root).unwrap();
        let platform = Arc::new(FakePlatform::new());
        let clock = Arc::new(FakeClock::at(
            UNIX_EPOCH + Duration::from_millis(u64::try_from(NOON_MS).unwrap()),
        ));
        let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
        let strip = Arc::new(StripRecorder::default());
        hub.add_sink(Arc::clone(&strip) as Arc<dyn StripSink>);
        let store = Arc::new(Store::open_in_memory().unwrap());
        let service = Arc::new(AiCodingService::new(
            Arc::clone(&platform) as Arc<dyn Platform>,
            Arc::clone(&hub),
            Arc::clone(&store),
            Arc::clone(&clock) as Arc<dyn Clock>,
            AiCodingPaths {
                copilot_root: Some(copilot_root),
                claude_settings: Some(home.path().join("claude.json")),
            },
        ));
        let sink = Arc::new(RecordingSink::default());
        service.set_sink(Arc::clone(&sink) as Arc<dyn AiCodingSink>);
        service.apply_settings(&Settings::default());
        Self {
            platform,
            clock,
            hub,
            store,
            service,
            sink,
            strip,
            home,
        }
    }

    fn copilot_root(&self) -> PathBuf {
        self.home.path().join("copilot")
    }

    fn claude_settings(&self) -> PathBuf {
        self.home.path().join("claude.json")
    }

    fn settings(&self, edit: impl FnOnce(&mut AiCodingSettings)) {
        let mut document = Settings::default();
        let mut module = AiCodingSettings::from_document(&document);
        edit(&mut module);
        module.write(&mut document).unwrap();
        self.service.apply_settings(&document);
    }

    /// A Copilot CLI session folder with a lock for `pid`, a workspace file and a log.
    fn copilot_session(&self, id: &str, pid: u32, cwd: &Path) -> PathBuf {
        let dir = self.copilot_root().join(id);
        fs::create_dir_all(&dir).unwrap();
        File::create(dir.join(format!("inuse.{pid}.lock")))
            .unwrap()
            .write_all(pid.to_string().as_bytes())
            .unwrap();
        fs::write(
            dir.join("workspace.yaml"),
            format!(
                "id: {id}\ncwd: {}\nclient_name: copilot-cli\nname: |-\n  fix the tests\n  \
                 second line\ncreated_at: 2024-06-12T11:30:00.000Z\nupdated_at: \
                 2024-06-12T11:59:00.000Z\n",
                cwd.display()
            ),
        )
        .unwrap();
        File::create(copilot::events_path(&dir)).unwrap();
        self.platform.set_process_running(pid, true);
        dir
    }

    fn copilot_log(dir: &Path, lines: &[Value]) {
        let mut file = OpenOptions::new()
            .append(true)
            .open(copilot::events_path(dir))
            .unwrap();
        for line in lines {
            writeln!(file, "{line}").unwrap();
        }
    }

    fn snapshot(&self) -> AiCodingSnapshot {
        self.service.snapshot()
    }

    fn session(&self, id: &str) -> Option<muna_lib::modules::ai_coding::AiSession> {
        self.snapshot()
            .sessions
            .into_iter()
            .find(|session| session.id == id)
    }

    fn claude(&self, payload: Value) -> Result<Reply, HookError> {
        self.service.handle(Route::Claude, payload, PEER_PORT)
    }

    fn generic(&self, payload: Value) -> Result<Reply, HookError> {
        self.service.handle(Route::Generic, payload, PEER_PORT)
    }

    fn activity_ids(&self) -> Vec<String> {
        self.hub
            .activities()
            .into_iter()
            .map(|state| state.activity.id)
            .collect()
    }
}

fn event(kind: &str, at: &str, data: &Value) -> Value {
    json!({ "type": kind, "data": data, "id": "e", "timestamp": at, "parentId": null })
}

fn claude_hook(event_name: &str, session: &str, extra: &Value) -> Value {
    let mut payload = json!({
        "session_id": session,
        "hook_event_name": event_name,
        "cwd": "C:\\Work\\muna",
    });
    if let (Some(base), Some(more)) = (payload.as_object_mut(), extra.as_object()) {
        for (key, value) in more {
            base.insert(key.clone(), value.clone());
        }
    }
    payload
}

// --- jsonl -----------------------------------------------------------------------------------

#[test]
fn tail_reads_whole_lines_and_carries_the_rest() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    fs::write(&path, "{\"a\":1}\n{\"b\":2}\n{\"c\"").unwrap();
    let mut tail = jsonl::Tail::open(path.clone());
    assert_eq!(tail.read_new().unwrap(), vec!["{\"a\":1}", "{\"b\":2}"]);
    assert!(!tail.is_partial(), "a small file is read from its start");
    let mut file = OpenOptions::new().append(true).open(&path).unwrap();
    write!(file, ":3}}\r\n{{\"d\":4}}\n").unwrap();
    assert_eq!(tail.read_new().unwrap(), vec!["{\"c\":3}", "{\"d\":4}"]);
    assert!(tail.read_new().unwrap().is_empty());
}

#[test]
fn tail_restarts_when_the_file_shrinks() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    fs::write(&path, "one\ntwo\nthree\n").unwrap();
    let mut tail = jsonl::Tail::open(path.clone());
    assert_eq!(tail.read_new().unwrap().len(), 3);
    fs::write(&path, "new\n").unwrap();
    assert_eq!(tail.read_new().unwrap(), vec!["new"]);
}

#[test]
fn tail_of_a_huge_file_starts_at_the_end_and_is_partial() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    let file = File::create(&path).unwrap();
    file.set_len(jsonl::FULL_READ_LIMIT + 1).unwrap();
    drop(file);
    let mut tail = jsonl::Tail::open(path.clone());
    assert!(tail.is_partial());
    assert!(tail.read_new().unwrap().is_empty());
    let mut file = OpenOptions::new().append(true).open(&path).unwrap();
    writeln!(file, "{{\"late\":true}}").unwrap();
    // The last byte of the padding was not a newline, so the first line after it is half a
    // line and is dropped; the next one arrives whole.
    tail.read_new().unwrap();
    writeln!(file, "{{\"whole\":true}}").unwrap();
    assert_eq!(tail.read_new().unwrap(), vec!["{\"whole\":true}"]);
}

// --- git -------------------------------------------------------------------------------------

#[test]
fn branch_of_reads_head_in_a_repository_and_a_worktree() {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().join("repo");
    fs::create_dir_all(repo.join(".git")).unwrap();
    fs::write(
        repo.join(".git").join("HEAD"),
        "ref: refs/heads/feature/x\n",
    )
    .unwrap();
    let nested = repo.join("src").join("deep");
    fs::create_dir_all(&nested).unwrap();
    assert_eq!(git::branch_of(&nested).as_deref(), Some("feature/x"));

    let common = dir.path().join("main").join(".git");
    let worktree_git = common.join("worktrees").join("wt");
    fs::create_dir_all(&worktree_git).unwrap();
    fs::write(worktree_git.join("HEAD"), "ref: refs/heads/m4-e5\n").unwrap();
    let worktree = dir.path().join("wt");
    fs::create_dir_all(&worktree).unwrap();
    fs::write(
        worktree.join(".git"),
        format!("gitdir: {}\n", worktree_git.display()),
    )
    .unwrap();
    assert_eq!(git::branch_of(&worktree).as_deref(), Some("m4-e5"));

    fs::write(
        repo.join(".git").join("HEAD"),
        "0123456789abcdef0123456789abcdef01234567\n",
    )
    .unwrap();
    assert_eq!(git::branch_of(&repo).as_deref(), Some("0123456"));
    assert_eq!(git::branch_of(dir.path()), None);
}

// --- copilot ---------------------------------------------------------------------------------

#[test]
fn copilot_workspace_and_timestamps_parse() {
    let rig = Rig::new();
    let cwd = rig.home.path().join("proj");
    let dir = rig.copilot_session("abc", COPILOT_PID, &cwd);
    let workspace = copilot::read_workspace(&dir);
    assert_eq!(workspace.cwd.as_deref(), Some(cwd.as_path()));
    assert_eq!(workspace.created_at_ms, Some(NOON_MS - 30 * 60_000));
    assert_eq!(copilot::lock_pid(&dir), Some(COPILOT_PID));
    assert_eq!(
        copilot::parse_timestamp_ms("2024-06-12T12:00:00.250Z"),
        Some(NOON_MS + 250)
    );
    assert_eq!(copilot::parse_timestamp_ms("yesterday"), None);
    assert_eq!(
        copilot::task_line("  \n\nFix the flaky test\nand more"),
        Some("Fix the flaky test".into())
    );
    assert_eq!(copilot::task_line("\n  \n"), None);
    let long = "x".repeat(300);
    let task = copilot::task_line(&long).unwrap();
    assert_eq!(task.chars().count(), copilot::TASK_CHARS + 1);
    assert!(task.ends_with('…'), "a cut line says so");
}

#[test]
fn copilot_log_reducer_follows_the_turn() {
    let mut state = copilot::CopilotState::default();
    assert!(!copilot::apply_line(&mut state, "not json"));
    assert!(copilot::apply_line(
        &mut state,
        &event(
            "session.start",
            "2024-06-12T12:00:00.000Z",
            &json!({ "sessionId": "abc", "selectedModel": "gpt-5", "startTime": "2024-06-12T11:59:00.000Z" })
        )
        .to_string()
    ));
    assert_eq!(state.model.as_deref(), Some("gpt-5"));
    assert_eq!(state.started_at_ms, Some(NOON_MS - 60_000));
    assert!(!state.in_turn);
    copilot::apply_line(
        &mut state,
        &event(
            "user.message",
            "2024-06-12T12:00:01.000Z",
            &json!({ "content": "Fix the tests\nplease" }),
        )
        .to_string(),
    );
    assert!(state.in_turn);
    assert_eq!(state.task.as_deref(), Some("Fix the tests"));
    assert_eq!(state.messages, 1);
    copilot::apply_line(
        &mut state,
        &event(
            "tool.execution_start",
            "2024-06-12T12:00:02.000Z",
            &json!({ "toolName": "edit", "arguments": { "path": "C:\\Work\\muna\\src\\a.rs" } }),
        )
        .to_string(),
    );
    assert_eq!(state.file.as_deref(), Some("C:\\Work\\muna\\src\\a.rs"));
    copilot::apply_line(
        &mut state,
        &event(
            "assistant.message",
            "2024-06-12T12:00:03.000Z",
            &json!({ "model": "gpt-5-mini", "content": "done" }),
        )
        .to_string(),
    );
    assert_eq!(state.model.as_deref(), Some("gpt-5-mini"));
    assert_eq!(state.messages, 2);
    copilot::apply_line(
        &mut state,
        &event(
            "session.task_complete",
            "2024-06-12T12:00:04.000Z",
            &json!({}),
        )
        .to_string(),
    );
    assert!(state.task_complete);
    assert_eq!(state.last_event_ms, Some(NOON_MS + 4000));
    copilot::apply_line(
        &mut state,
        &event("session.shutdown", "2024-06-12T12:00:05.000Z", &json!({})).to_string(),
    );
    assert!(state.ended);
    assert!(!state.in_turn);
}

#[test]
fn copilot_sessions_are_found_followed_and_retired() {
    let rig = Rig::new();
    let cwd = rig.home.path().join("muna");
    fs::create_dir_all(cwd.join(".git")).unwrap();
    fs::write(cwd.join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
    let dir = rig.copilot_session("s1", COPILOT_PID, &cwd);
    rig.platform.set_process_running(COPILOT_PID, true);
    rig.platform.set_process_window(COPILOT_PID, Some(TERMINAL));
    // A folder with no lock is not a session.
    fs::create_dir_all(rig.copilot_root().join("old")).unwrap();
    // A lock for a dead process is not a session either.
    rig.copilot_session("dead", 9, &cwd);
    rig.platform.set_process_running(9, false);

    rig.service.poll();
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.sessions.len(), 1, "{snapshot:?}");
    let session = &snapshot.sessions[0];
    assert_eq!(session.id, "copilot:s1");
    assert_eq!(session.agent, AiAgent::Copilot);
    assert_eq!(session.project.as_deref(), Some("muna"));
    assert_eq!(session.branch.as_deref(), Some("main"));
    assert_eq!(
        session.status,
        AiStatus::Waiting,
        "an empty log is a prompt"
    );
    assert!(session.can_focus);
    assert_eq!(session.started_at_ms, NOON_MS - 30 * 60_000);
    assert!(
        rig.strip.notices.lock().is_empty(),
        "a session found already waiting is not announced"
    );

    Rig::copilot_log(
        &dir,
        &[
            event(
                "session.start",
                "2024-06-12T12:00:00.000Z",
                &json!({ "selectedModel": "gpt-5" }),
            ),
            event(
                "user.message",
                "2024-06-12T12:00:01.000Z",
                &json!({ "content": "Fix the tests" }),
            ),
            event(
                "tool.execution_start",
                "2024-06-12T12:00:02.000Z",
                &json!({ "arguments": { "path": cwd.join("src").join("lib.rs") } }),
            ),
        ],
    );
    rig.service.poll();
    let session = rig.session("copilot:s1").unwrap();
    assert_eq!(session.status, AiStatus::Running);
    assert_eq!(session.model.as_deref(), Some("gpt-5"));
    assert_eq!(session.task.as_deref(), Some("Fix the tests"));
    assert_eq!(session.file.as_deref(), Some("src/lib.rs"));
    assert_eq!(session.messages, Some(1));
    assert_eq!(session.tokens, None, "Copilot CLI reports no token usage");

    Rig::copilot_log(
        &dir,
        &[event(
            "session.task_complete",
            "2024-06-12T12:00:09.000Z",
            &json!({}),
        )],
    );
    rig.service.poll();
    let session = rig.session("copilot:s1").unwrap();
    assert_eq!(session.status, AiStatus::Waiting);
    let waiting = session.waiting.unwrap();
    assert_eq!(waiting.kind, WaitingKind::Input);
    assert!(!waiting.decidable);
    assert_eq!(session.updated_at_ms, NOON_MS + 9000);
    let notices = rig.strip.notices.lock().clone();
    assert_eq!(
        notices,
        vec![StripMessage::AgentWaiting {
            agent: "GitHub Copilot".into(),
            tool: None,
        }],
        "running → waiting earns one notice"
    );

    // Another poll with nothing new changes nothing and says nothing.
    rig.service.watch("notch", true);
    let before = rig.sink.snapshots.lock().len();
    rig.service.poll();
    assert_eq!(rig.sink.snapshots.lock().len(), before);

    // The CLI exits: the lock goes and the process with it.
    fs::remove_file(dir.join(format!("inuse.{COPILOT_PID}.lock"))).unwrap();
    rig.platform.set_process_running(COPILOT_PID, false);
    rig.service.poll();
    let snapshot = rig.snapshot();
    assert!(snapshot.sessions.is_empty());
    assert_eq!(snapshot.recent.len(), 1);
    assert_eq!(snapshot.recent[0].status, AiStatus::Done);
    assert!(!snapshot.recent[0].can_focus);
    assert_eq!(rig.strip.notices.lock().len(), 1, "finishing is quiet");

    // Recent entries age out.
    rig.clock.advance(RECENT_FOR + Duration::from_secs(1));
    rig.service.poll();
    assert!(rig.snapshot().recent.is_empty());
}

#[test]
fn copilot_focus_uses_the_lock_process_window() {
    let rig = Rig::new();
    let cwd = rig.home.path().join("proj");
    rig.copilot_session("s1", COPILOT_PID, &cwd);
    rig.platform.set_process_window(COPILOT_PID, Some(TERMINAL));
    rig.service.poll();
    rig.service
        .command(AiCodingCommand::Focus {
            session: "copilot:s1".into(),
        })
        .unwrap();
    assert_eq!(rig.platform.focus_calls(), vec![TERMINAL]);
    assert!(matches!(
        rig.service.command(AiCodingCommand::Focus {
            session: "copilot:nope".into(),
        }),
        Err(AiCodingError::Unknown)
    ));
}

#[test]
fn copilot_source_can_be_turned_off() {
    let rig = Rig::new();
    let cwd = rig.home.path().join("proj");
    rig.copilot_session("s1", COPILOT_PID, &cwd);
    rig.service.poll();
    assert_eq!(rig.snapshot().sessions.len(), 1);
    rig.settings(|s| s.copilot_cli = false);
    assert!(rig.snapshot().sessions.is_empty());
    rig.service.poll();
    assert!(rig.snapshot().sessions.is_empty());
    assert_eq!(rig.service.cadence(), None, "nothing left to poll");
}

// --- claude ----------------------------------------------------------------------------------

#[test]
fn claude_permission_request_is_held_and_answered() {
    let rig = Rig::new();
    rig.platform.set_port_owner(PEER_PORT, Some(CLAUDE_PID));
    rig.platform.set_process_window(CLAUDE_PID, Some(TERMINAL));

    let reply = rig
        .claude(claude_hook(
            "SessionStart",
            "c1",
            &json!({ "model": "claude-sonnet-4-5" }),
        ))
        .unwrap();
    assert!(matches!(reply, Reply::Now(_)));
    let session = rig.session("claude:c1").unwrap();
    assert_eq!(session.agent, AiAgent::Claude);
    assert_eq!(session.status, AiStatus::Running);
    assert_eq!(session.project.as_deref(), Some("muna"));
    assert_eq!(session.model.as_deref(), Some("claude-sonnet-4-5"));
    assert!(
        session.can_focus,
        "the port traced to a process with a window"
    );

    rig.claude(claude_hook(
        "UserPromptSubmit",
        "c1",
        &json!({ "prompt": "Rename the module\n\nand fix imports" }),
    ))
    .unwrap();
    assert_eq!(
        rig.session("claude:c1").unwrap().task.as_deref(),
        Some("Rename the module")
    );

    let reply = rig
        .claude(claude_hook(
            "PermissionRequest",
            "c1",
            &json!({ "tool_name": "Bash", "tool_input": { "command": "cargo test" } }),
        ))
        .unwrap();
    let Reply::Hold {
        session,
        decision,
        fallback,
    } = reply
    else {
        panic!("a permission request is held, got {reply:?}");
    };
    assert_eq!(session, "claude:c1");
    assert_eq!(fallback, claude::empty_response());
    let waiting = rig.session("claude:c1").unwrap().waiting.unwrap();
    assert_eq!(waiting.kind, WaitingKind::Permission);
    assert_eq!(waiting.tool.as_deref(), Some("Bash"));
    assert_eq!(waiting.detail.as_deref(), Some("cargo test"));
    assert!(waiting.decidable);
    assert_eq!(rig.activity_ids(), vec![activity_id("claude:c1")]);
    let StripContent::Activity { activity, .. } = rig.hub.current() else {
        panic!("the decision shows on the strip");
    };
    assert_eq!(
        activity.trailing,
        Some(Trailing::Decision {
            session: "claude:c1".into()
        })
    );
    assert!(
        rig.strip.notices.lock().is_empty(),
        "held requests are activities, not notices"
    );

    let snapshot = rig
        .service
        .command(AiCodingCommand::Allow {
            session: "claude:c1".into(),
        })
        .unwrap();
    assert_eq!(
        decision.blocking_recv().unwrap(),
        claude::permission_response(true)
    );
    assert_eq!(snapshot.sessions[0].status, AiStatus::Running);
    assert!(snapshot.sessions[0].waiting.is_none());
    assert!(rig.activity_ids().is_empty(), "answered: off the strip");
    assert!(matches!(
        rig.service.command(AiCodingCommand::Deny {
            session: "claude:c1".into(),
        }),
        Err(AiCodingError::NotWaiting)
    ));
}

#[test]
fn claude_denied_request_and_expired_hold() {
    let rig = Rig::new();
    let Reply::Hold { decision, .. } = rig
        .claude(claude_hook(
            "PermissionRequest",
            "c2",
            &json!({ "tool_name": "Edit", "tool_input": { "file_path": "C:\\Work\\muna\\src\\a.rs" } }),
        ))
        .unwrap()
    else {
        panic!("held");
    };
    assert_eq!(
        rig.session("claude:c2").unwrap().file.as_deref(),
        Some("src/a.rs")
    );
    rig.service
        .command(AiCodingCommand::Deny {
            session: "claude:c2".into(),
        })
        .unwrap();
    assert_eq!(
        decision.blocking_recv().unwrap(),
        claude::permission_response(false)
    );

    // A second request nobody answers in time: Claude Code shows its own prompt, so the wait
    // stays but is no longer decidable from the strip.
    let Reply::Hold { .. } = rig
        .claude(claude_hook(
            "PermissionRequest",
            "c2",
            &json!({ "tool_name": "Bash", "tool_input": { "command": "rm -rf build" } }),
        ))
        .unwrap()
    else {
        panic!("held");
    };
    assert_eq!(rig.activity_ids(), vec![activity_id("claude:c2")]);
    rig.service.hold_expired("claude:c2");
    let session = rig.session("claude:c2").unwrap();
    assert_eq!(session.status, AiStatus::Waiting);
    assert!(!session.waiting.unwrap().decidable);
    assert!(rig.activity_ids().is_empty());
    assert_eq!(
        rig.strip.notices.lock().clone(),
        vec![StripMessage::AgentWaiting {
            agent: "Claude Code".into(),
            tool: Some("Bash".into()),
        }],
        "the wait is announced once instead"
    );
    assert!(matches!(
        rig.service.command(AiCodingCommand::Allow {
            session: "claude:c2".into(),
        }),
        Err(AiCodingError::NotWaiting)
    ));
}

#[test]
fn claude_stop_notification_and_end() {
    let rig = Rig::new();
    rig.claude(claude_hook("SessionStart", "c3", &json!({})))
        .unwrap();
    rig.claude(claude_hook(
        "PreToolUse",
        "c3",
        &json!({ "tool_name": "Read" }),
    ))
    .unwrap();
    rig.claude(claude_hook("Stop", "c3", &json!({}))).unwrap();
    let session = rig.session("claude:c3").unwrap();
    assert_eq!(session.status, AiStatus::Waiting);
    assert_eq!(session.waiting.unwrap().kind, WaitingKind::Input);
    assert_eq!(rig.strip.notices.lock().len(), 1);

    // Idle after the stop: still waiting, nothing new to say.
    rig.claude(claude_hook(
        "Notification",
        "c3",
        &json!({ "notification_type": "idle_prompt", "message": "waiting" }),
    ))
    .unwrap();
    assert_eq!(rig.strip.notices.lock().len(), 1);
    assert_eq!(
        rig.session("claude:c3").unwrap().waiting.unwrap().kind,
        WaitingKind::Input
    );

    // A permission prompt Claude shows itself (no PermissionRequest hook reached us).
    rig.claude(claude_hook(
        "UserPromptSubmit",
        "c3",
        &json!({ "prompt": "go" }),
    ))
    .unwrap();
    rig.claude(claude_hook(
        "Notification",
        "c3",
        &json!({ "notification_type": "permission_prompt", "tool_name": "Bash", "message": "Claude needs your permission to use Bash" }),
    ))
    .unwrap();
    let waiting = rig.session("claude:c3").unwrap().waiting.unwrap();
    assert_eq!(waiting.kind, WaitingKind::Permission);
    assert!(!waiting.decidable);
    assert_eq!(rig.strip.notices.lock().len(), 2);

    rig.claude(claude_hook(
        "SessionEnd",
        "c3",
        &json!({ "reason": "exit" }),
    ))
    .unwrap();
    let snapshot = rig.snapshot();
    assert!(snapshot.sessions.is_empty());
    assert_eq!(snapshot.recent.len(), 1);
    assert_eq!(snapshot.recent[0].id, "claude:c3");

    // Dismissing a recent entry drops it; an unknown id is an error.
    rig.service
        .command(AiCodingCommand::Dismiss {
            session: "claude:c3".into(),
        })
        .unwrap();
    assert!(rig.snapshot().recent.is_empty());
    assert!(matches!(
        rig.service.command(AiCodingCommand::Dismiss {
            session: "claude:c3".into(),
        }),
        Err(AiCodingError::Unknown)
    ));
}

#[test]
fn claude_transcript_counts_messages_and_tokens() {
    let rig = Rig::new();
    let transcript = rig.home.path().join("transcript.jsonl");
    let lines = [
        json!({ "type": "user", "gitBranch": "m4-e5", "message": { "role": "user", "content": "hello" } }),
        json!({ "type": "assistant", "message": { "model": "claude-opus-4-1", "usage": { "input_tokens": 100, "output_tokens": 20, "cache_creation_input_tokens": 5, "cache_read_input_tokens": 1000 } } }),
        json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": "ok" }] } }),
        json!({ "type": "progress" }),
    ];
    let text = lines.iter().fold(String::new(), |mut text, line| {
        text.push_str(&line.to_string());
        text.push('\n');
        text
    });
    fs::write(&transcript, text).unwrap();
    rig.claude(claude_hook(
        "SessionStart",
        "c4",
        &json!({ "transcript_path": transcript }),
    ))
    .unwrap();
    let session = rig.session("claude:c4").unwrap();
    assert_eq!(session.messages, Some(2), "tool results are not messages");
    assert_eq!(session.tokens, Some(1125));
    assert_eq!(session.model.as_deref(), Some("claude-opus-4-1"));
    assert_eq!(session.branch.as_deref(), Some("m4-e5"));

    let mut stats = claude::TranscriptStats::default();
    claude::apply_transcript_line(&mut stats, "garbage");
    assert_eq!(stats, claude::TranscriptStats::default());
}

#[test]
fn claude_sessions_silent_for_long_are_retired() {
    let rig = Rig::new();
    rig.claude(claude_hook("SessionStart", "c5", &json!({})))
        .unwrap();
    rig.clock.advance(
        muna_lib::modules::ai_coding::CLAUDE_SILENCE
            .checked_sub(Duration::from_secs(1))
            .unwrap(),
    );
    rig.service.poll();
    assert_eq!(rig.snapshot().sessions.len(), 1);
    rig.clock.advance(Duration::from_secs(2));
    rig.service.poll();
    let snapshot = rig.snapshot();
    assert!(snapshot.sessions.is_empty());
    assert_eq!(snapshot.recent.len(), 1);
}

#[test]
fn claude_hook_rejects_bad_payloads_and_a_module_that_is_off() {
    let rig = Rig::new();
    assert!(matches!(
        rig.claude(json!({ "hook_event_name": "Stop" })),
        Err(HookError::Invalid(_))
    ));
    assert!(matches!(
        rig.claude(json!("not an object")),
        Err(HookError::Invalid(_))
    ));
    rig.claude(claude_hook(
        "PermissionRequest",
        "c6",
        &json!({ "tool_name": "Bash" }),
    ))
    .unwrap();
    assert_eq!(rig.activity_ids().len(), 1);
    rig.settings(|s| s.enabled = false);
    assert!(
        rig.activity_ids().is_empty(),
        "turning off clears the strip"
    );
    assert!(rig.snapshot().sessions.is_empty());
    assert!(matches!(
        rig.claude(claude_hook("Stop", "c6", &json!({}))),
        Err(HookError::Off)
    ));
    assert_eq!(rig.service.cadence(), None);
}

#[test]
fn waiting_notice_setting_silences_the_strip() {
    let rig = Rig::new();
    rig.settings(|s| s.waiting_notice = false);
    let reply = rig
        .claude(claude_hook(
            "PermissionRequest",
            "c7",
            &json!({ "tool_name": "Bash" }),
        ))
        .unwrap();
    assert!(matches!(reply, Reply::Hold { .. }), "the hold still works");
    assert!(rig.activity_ids().is_empty());
    rig.service.hold_expired("claude:c7");
    assert!(rig.strip.notices.lock().is_empty());
    assert_eq!(rig.session("claude:c7").unwrap().status, AiStatus::Waiting);
}

// --- generic ---------------------------------------------------------------------------------

#[test]
fn generic_route_describes_any_agent() {
    let rig = Rig::new();
    rig.platform.set_process_window(777, Some(TERMINAL));
    rig.generic(json!({
        "agent": "Aider",
        "sessionId": "x1",
        "status": "running",
        "project": "site",
        "branch": "main",
        "model": "gpt-5",
        "task": "Write docs",
        "pid": 777,
        "messages": 3,
        "tokens": 4200
    }))
    .unwrap();
    let session = rig.session("generic:aider:x1").unwrap();
    assert_eq!(session.agent, AiAgent::Generic);
    assert_eq!(session.status, AiStatus::Running);
    assert_eq!(session.project.as_deref(), Some("site"));
    assert_eq!(session.messages, Some(3));
    assert_eq!(session.tokens, Some(4200));
    assert!(session.can_focus);

    rig.generic(json!({
        "agent": "Aider",
        "session_id": "x1",
        "status": "waiting",
        "waiting_kind": "permission",
        "tool": "shell",
        "message": "Run pytest?"
    }))
    .unwrap();
    let session = rig.session("generic:aider:x1").unwrap();
    assert_eq!(session.status, AiStatus::Waiting);
    let waiting = session.waiting.unwrap();
    assert_eq!(waiting.kind, WaitingKind::Permission);
    assert_eq!(waiting.tool.as_deref(), Some("shell"));
    assert_eq!(waiting.detail.as_deref(), Some("Run pytest?"));
    assert!(!waiting.decidable);
    assert_eq!(
        rig.strip.notices.lock().clone(),
        vec![StripMessage::AgentWaiting {
            agent: "Coding agent".into(),
            tool: Some("shell".into()),
        }]
    );

    rig.generic(json!({ "agent": "Aider", "sessionId": "x1", "status": "done" }))
        .unwrap();
    assert!(rig.snapshot().sessions.is_empty());
    assert_eq!(rig.snapshot().recent.len(), 1);

    assert!(matches!(
        rig.generic(json!({ "agent": "Aider", "sessionId": "x2", "status": "sleeping" })),
        Err(HookError::Invalid(_))
    ));
    assert!(matches!(
        rig.generic(json!({ "agent": "", "sessionId": "x2", "status": "running" })),
        Err(HookError::Invalid(_))
    ));
}

#[test]
fn snapshot_orders_decidable_then_waiting_then_running() {
    let rig = Rig::new();
    rig.claude(claude_hook("SessionStart", "running", &json!({})))
        .unwrap();
    rig.clock.advance(Duration::from_secs(1));
    rig.claude(claude_hook("SessionStart", "waiting", &json!({})))
        .unwrap();
    rig.claude(claude_hook("Stop", "waiting", &json!({})))
        .unwrap();
    rig.clock.advance(Duration::from_secs(1));
    rig.claude(claude_hook(
        "PermissionRequest",
        "deciding",
        &json!({ "tool_name": "Bash" }),
    ))
    .unwrap();
    let ids: Vec<String> = rig
        .snapshot()
        .sessions
        .into_iter()
        .map(|session| session.id)
        .collect();
    assert_eq!(
        ids,
        vec!["claude:deciding", "claude:waiting", "claude:running"]
    );
}

// --- publishing ------------------------------------------------------------------------------

#[test]
fn snapshots_are_published_only_while_watched() {
    let rig = Rig::new();
    rig.claude(claude_hook("SessionStart", "p1", &json!({})))
        .unwrap();
    assert!(rig.sink.snapshots.lock().is_empty());
    rig.service.watch("notch", true);
    rig.claude(claude_hook("Stop", "p1", &json!({}))).unwrap();
    assert_eq!(rig.sink.snapshots.lock().len(), 1);
    rig.service.forget_window("notch");
    rig.claude(claude_hook(
        "UserPromptSubmit",
        "p1",
        &json!({ "prompt": "x" }),
    ))
    .unwrap();
    assert_eq!(rig.sink.snapshots.lock().len(), 1);
    assert_eq!(
        rig.service.cadence(),
        Some(muna_lib::modules::ai_coding::POLL_IDLE)
    );
    rig.service.watch("notch", true);
    assert_eq!(
        rig.service.cadence(),
        Some(muna_lib::modules::ai_coding::POLL_ACTIVE)
    );
}

// --- hooks installer -------------------------------------------------------------------------

#[test]
fn claude_hooks_are_installed_beside_existing_settings_and_removed_cleanly() {
    let rig = Rig::new();
    let path = rig.claude_settings();
    fs::write(
        &path,
        json!({
            "theme": "dark",
            "hooks": {
                "Stop": [{ "hooks": [{ "type": "command", "command": "say done" }] }]
            }
        })
        .to_string(),
    )
    .unwrap();
    let url = hook_url(DEFAULT_PORT);
    assert!(!claude::hooks_installed(&path, &url));
    assert!(!rig.snapshot().receiver.claude_hooks_installed);

    let snapshot = rig
        .service
        .command(AiCodingCommand::InstallClaudeHooks)
        .unwrap();
    assert!(snapshot.receiver.claude_hooks_installed);
    assert!(claude::hooks_installed(&path, &url));
    let written: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(written["theme"], "dark", "other settings survive");
    let stop = written["hooks"]["Stop"].as_array().unwrap();
    assert_eq!(stop.len(), 2, "the user's own Stop hook survives");
    assert_eq!(stop[0]["hooks"][0]["command"], "say done");
    let ours = &stop[1]["hooks"][0];
    assert_eq!(ours["type"], "http");
    assert_eq!(ours["url"], Value::String(url.clone()));
    let token = rig.service.token().unwrap();
    assert_eq!(token.len(), 64, "32 random bytes as hex");
    assert_eq!(
        ours["headers"]["Authorization"],
        Value::String(format!("Bearer {token}"))
    );
    assert_eq!(
        written["hooks"]["PermissionRequest"][0]["hooks"][0]["timeout"],
        30
    );
    for (event, _) in claude::HOOK_EVENTS {
        assert!(written["hooks"][event].is_array(), "{event} is hooked");
    }
    assert_eq!(
        rig.service.token().unwrap(),
        token,
        "the token is minted once"
    );
    assert_eq!(
        rig.store
            .get_meta(muna_lib::modules::ai_coding::TOKEN_KEY)
            .unwrap()
            .as_deref(),
        Some(token.as_str()),
        "and lives in the profile database"
    );

    // Installing again replaces ours instead of stacking.
    rig.service
        .command(AiCodingCommand::InstallClaudeHooks)
        .unwrap();
    let written: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(written["hooks"]["Stop"].as_array().unwrap().len(), 2);

    let snapshot = rig
        .service
        .command(AiCodingCommand::RemoveClaudeHooks)
        .unwrap();
    assert!(!snapshot.receiver.claude_hooks_installed);
    let written: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(written["theme"], "dark");
    assert_eq!(written["hooks"]["Stop"].as_array().unwrap().len(), 1);
    assert!(written["hooks"].get("PermissionRequest").is_none());

    // A file that is not an object is refused, not clobbered.
    fs::write(&path, "[1, 2]").unwrap();
    assert!(matches!(
        rig.service.command(AiCodingCommand::InstallClaudeHooks),
        Err(AiCodingError::HooksFile(_))
    ));
    assert_eq!(fs::read_to_string(&path).unwrap(), "[1, 2]");
}

#[test]
fn hooks_installer_creates_the_file_and_removing_a_missing_file_is_fine() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(".claude").join("settings.json");
    claude::remove_hooks(&path).unwrap();
    assert!(!path.exists());
    claude::install_hooks(&path, &hook_url(50_000), "secret").unwrap();
    assert!(claude::hooks_installed(&path, &hook_url(50_000)));
    assert!(
        !claude::hooks_installed(&path, &hook_url(50_001)),
        "a different port is a different install"
    );
    claude::remove_hooks(&path).unwrap();
    let written: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(written, json!({}));
}

#[test]
fn without_a_profile_the_installer_says_so() {
    let platform = Arc::new(FakePlatform::new());
    let clock = Arc::new(FakeClock::new());
    let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
    let store = Arc::new(Store::open_in_memory().unwrap());
    let service = AiCodingService::new(
        platform as Arc<dyn Platform>,
        hub,
        store,
        clock as Arc<dyn Clock>,
        AiCodingPaths::default(),
    );
    assert!(matches!(
        service.command(AiCodingCommand::InstallClaudeHooks),
        Err(AiCodingError::NoProfile)
    ));
    service.poll();
    assert!(service.snapshot().sessions.is_empty());
}

// --- settings --------------------------------------------------------------------------------

#[test]
fn settings_round_trip_and_clamp() {
    let defaults = AiCodingSettings::default();
    assert!(defaults.enabled);
    assert_eq!(defaults.port, DEFAULT_PORT);
    assert!(defaults.copilot_cli);
    assert!(defaults.waiting_notice);
    let mut document = Settings::default();
    let custom = AiCodingSettings {
        enabled: true,
        port: 50_505,
        copilot_cli: false,
        waiting_notice: false,
    };
    custom.write(&mut document).unwrap();
    assert_eq!(AiCodingSettings::from_document(&document), custom);
    let low = AiCodingSettings {
        port: 80,
        ..defaults.clone()
    }
    .clamped();
    assert_eq!(low.port, 1024);

    let rig = Rig::new();
    rig.settings(|s| s.port = 50_505);
    let receiver = rig.snapshot().receiver;
    assert_eq!(receiver.port, 50_505);
    assert_eq!(receiver.hook_url, hook_url(50_505));
    assert!(!receiver.listening);
    rig.service.receiver_bound(Some(50_506));
    let receiver = rig.snapshot().receiver;
    assert!(receiver.listening);
    assert_eq!(receiver.port, 50_506);
    assert_eq!(receiver.hook_url, hook_url(50_506));
    rig.service.receiver_bound(None);
    assert_eq!(rig.snapshot().receiver.port, 50_505);
}

#[test]
fn locking_pauses_polling() {
    let rig = Rig::new();
    let cwd = rig.home.path().join("proj");
    rig.copilot_session("s1", COPILOT_PID, &cwd);
    rig.service.set_locked(true);
    rig.service.poll();
    assert!(rig.snapshot().sessions.is_empty());
    assert_eq!(rig.service.cadence(), None);
    rig.service.set_locked(false);
    rig.service.poll();
    assert_eq!(rig.snapshot().sessions.len(), 1);
}

// --- receiver --------------------------------------------------------------------------------

#[test]
fn rate_bucket_refills_over_time() {
    let start = Instant::now();
    let mut bucket = receiver::Bucket::new(3);
    assert!(bucket.take_at(start));
    assert!(bucket.take_at(start));
    assert!(bucket.take_at(start));
    assert!(!bucket.take_at(start));
    assert!(!bucket.take_at(start + Duration::from_millis(100)));
    assert!(bucket.take_at(start + Duration::from_millis(400)));
    assert!(!bucket.take_at(start + Duration::from_millis(400)));
    // A long pause fills it back up, but never past its size.
    assert!(bucket.take_at(start + Duration::from_secs(10)));
    assert!(bucket.take_at(start + Duration::from_secs(10)));
    assert!(bucket.take_at(start + Duration::from_secs(10)));
    assert!(!bucket.take_at(start + Duration::from_secs(10)));
}

/// A live receiver in front of the rig's service, on a free loopback port.
struct Live {
    rig: Arc<Rig>,
    port: u16,
    token: String,
    client: reqwest::Client,
    _server: tokio::task::JoinHandle<()>,
}

impl Live {
    async fn start() -> Self {
        let rig = Arc::new(Rig::new());
        let token = rig.service.token().unwrap();
        let (listener, port) = receiver::bind(0).await.unwrap();
        assert_ne!(port, 0, "bind reports the port it got");
        rig.service.receiver_bound(Some(port));
        let handler: Arc<dyn HookHandler> = Arc::clone(&rig.service) as Arc<dyn HookHandler>;
        let server = tokio::spawn(receiver::serve(listener, handler, Arc::from(token.clone())));
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        Self {
            rig,
            port,
            token,
            client,
            _server: server,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    async fn post(&self, path: &str, body: &Value, token: Option<&str>) -> (u16, Value) {
        let mut request = self.client.post(self.url(path)).json(body);
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        let response = request.send().await.unwrap();
        let status = response.status().as_u16();
        let body = response.json().await.unwrap_or(Value::Null);
        (status, body)
    }
}

#[tokio::test]
async fn receiver_checks_route_method_token_size_and_json() {
    let live = Live::start().await;
    let health = live.client.get(live.url("/health")).send().await.unwrap();
    assert_eq!(health.status().as_u16(), 200);
    assert_eq!(
        health.json::<Value>().await.unwrap(),
        json!({ "name": "muna", "ok": true })
    );

    let payload = claude_hook("SessionStart", "r1", &json!({}));
    assert_eq!(
        live.post("/hooks/nope", &payload, Some(&live.token))
            .await
            .0,
        404
    );
    let get = live
        .client
        .get(live.url("/hooks/claude"))
        .send()
        .await
        .unwrap();
    assert_eq!(get.status().as_u16(), 405);
    assert_eq!(live.post("/hooks/claude", &payload, None).await.0, 401);
    assert_eq!(
        live.post("/hooks/claude", &payload, Some("wrong")).await.0,
        401
    );
    assert!(
        live.rig.snapshot().sessions.is_empty(),
        "nothing reached the service"
    );

    let not_json = live
        .client
        .post(live.url("/hooks/claude"))
        .bearer_auth(&live.token)
        .body("{not json")
        .send()
        .await
        .unwrap();
    assert_eq!(not_json.status().as_u16(), 400);

    let huge = json!({ "hook_event_name": "Stop", "session_id": "r1", "pad": "x".repeat(receiver::BODY_LIMIT) });
    assert_eq!(
        live.post("/hooks/claude", &huge, Some(&live.token)).await.0,
        413
    );

    let (status, body) = live
        .post(
            "/hooks/claude",
            &json!({ "session_id": "r1" }),
            Some(&live.token),
        )
        .await;
    assert_eq!(status, 422);
    assert!(body["error"].as_str().unwrap().contains("hook_event_name"));

    let (status, body) = live
        .post("/hooks/claude", &payload, Some(&live.token))
        .await;
    assert_eq!(status, 200);
    assert_eq!(body, claude::empty_response());
    assert_eq!(live.rig.snapshot().sessions.len(), 1);

    let (status, _) = live
        .post(
            "/hooks/generic",
            &json!({ "agent": "Aider", "sessionId": "g1", "status": "running" }),
            Some(&live.token),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(live.rig.snapshot().sessions.len(), 2);

    live.rig.settings(|s| s.enabled = false);
    assert_eq!(
        live.post("/hooks/claude", &payload, Some(&live.token))
            .await
            .0,
        503
    );
}

#[tokio::test]
async fn receiver_holds_a_permission_request_until_the_user_decides() {
    let live = Live::start().await;
    let rig = Arc::clone(&live.rig);
    let decider = tokio::spawn(async move {
        // Wait for the request to be held, then allow it.
        for _ in 0..200 {
            if rig
                .session("claude:h1")
                .is_some_and(|session| session.waiting.is_some_and(|w| w.decidable))
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        rig.service
            .command(AiCodingCommand::Allow {
                session: "claude:h1".into(),
            })
            .unwrap();
    });
    let (status, body) = live
        .post(
            "/hooks/claude",
            &claude_hook(
                "PermissionRequest",
                "h1",
                &json!({ "tool_name": "Bash", "tool_input": { "command": "pnpm test" } }),
            ),
            Some(&live.token),
        )
        .await;
    decider.await.unwrap();
    assert_eq!(status, 200);
    assert_eq!(body, claude::permission_response(true));
    assert_eq!(
        live.rig.session("claude:h1").unwrap().status,
        AiStatus::Running
    );
}

// --- registry --------------------------------------------------------------------------------

#[test]
fn registry_lists_the_module_with_its_surfaces() {
    let platform = Arc::new(FakePlatform::new()) as Arc<dyn Platform>;
    let clock = Arc::new(FakeClock::new()) as Arc<dyn Clock>;
    let hub = Arc::new(Hub::new(Arc::clone(&clock)));
    let store = Arc::new(Store::open_in_memory().unwrap());
    let services = ModuleServices::new(&platform, &hub, None, &store, &clock);
    let backend = backends(&services)
        .into_iter()
        .find(|backend| backend.id() == ID)
        .expect("ai-coding is registered");
    assert_eq!(
        backend.capabilities(),
        &[Surface::Strip, Surface::Panel, Surface::Widget]
    );
    assert!(
        services.ai_coding.snapshot().sessions.is_empty(),
        "no profile: nothing to read"
    );
}
