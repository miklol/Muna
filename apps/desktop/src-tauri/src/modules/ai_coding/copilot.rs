//! GitHub Copilot CLI sessions (docs/modules/ai-coding.md, *Sources*): the CLI keeps one folder
//! per session under `%USERPROFILE%\.copilot\session-state\<id>` with `events.jsonl` (appended
//! while the session runs), `workspace.yaml` (the working directory and when it started) and an
//! `inuse.<pid>.lock` while a CLI process holds the session. No hook exists, so the module
//! finds live sessions by their lock files and follows the log with a [`Tail`].
//!
//! Only the event kinds the panel needs are parsed; a line of another kind, or one that fails
//! to parse, is skipped. Message content is read for the *task* line the user typed and never
//! logged.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Deserialize;

use super::jsonl::Tail;

/// The session-state folder relative to the user's profile.
pub const SESSION_STATE: &str = ".copilot\\session-state";
/// The longest *task* line kept from a prompt.
pub const TASK_CHARS: usize = 140;

/// A session folder whose lock names a process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveDir {
    /// The folder name, which is the CLI's session id.
    pub id: String,
    pub dir: PathBuf,
    pub pid: u32,
}

/// Finds live session folders under one root.
#[derive(Debug)]
pub struct CopilotSource {
    root: PathBuf,
    /// When the last scan ran, so later scans look only at folders changed since (a lock file
    /// appearing or disappearing changes its folder's modified time).
    last_scan: Option<SystemTime>,
}

impl CopilotSource {
    /// `%USERPROFILE%\.copilot\session-state`, or `None` without a profile directory.
    #[must_use]
    pub fn default_root() -> Option<PathBuf> {
        std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .map(|home| home.join(SESSION_STATE))
    }

    #[must_use]
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            last_scan: None,
        }
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Session folders holding an `inuse.<pid>.lock`. The first call looks inside every folder;
    /// later calls look only inside folders modified since the previous call (with a minute of
    /// slack), so a root with thousands of old sessions costs one directory listing per scan.
    /// Folders the caller already tracks are checked directly with [`lock_pid`].
    pub fn live_dirs(&mut self) -> Vec<LiveDir> {
        let now = SystemTime::now();
        let since = self
            .last_scan
            .and_then(|last| last.checked_sub(std::time::Duration::from_secs(60)));
        self.last_scan = Some(now);
        let Ok(entries) = fs::read_dir(&self.root) else {
            return Vec::new();
        };
        let mut live = Vec::new();
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if !kind.is_dir() {
                continue;
            }
            if let Some(since) = since {
                let modified = entry.metadata().and_then(|meta| meta.modified()).ok();
                if modified.is_some_and(|modified| modified < since) {
                    continue;
                }
            }
            let dir = entry.path();
            if let Some(pid) = lock_pid(&dir) {
                live.push(LiveDir {
                    id: entry.file_name().to_string_lossy().into_owned(),
                    dir,
                    pid,
                });
            }
        }
        live.sort_by(|a, b| a.id.cmp(&b.id));
        live
    }
}

/// The pid named by `inuse.<pid>.lock` in `dir`, if any.
#[must_use]
pub fn lock_pid(dir: &Path) -> Option<u32> {
    let entries = fs::read_dir(dir).ok()?;
    entries.flatten().find_map(|entry| {
        let name = entry.file_name();
        let name = name.to_str()?;
        let pid = name.strip_prefix("inuse.")?.strip_suffix(".lock")?;
        pid.parse().ok()
    })
}

/// What `workspace.yaml` says about a session.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Workspace {
    pub cwd: Option<PathBuf>,
    /// `created_at`, as Unix milliseconds.
    pub created_at_ms: Option<i64>,
}

/// Reads the top-level scalars of `dir/workspace.yaml`. The file is plain `key: value` lines
/// with one block scalar (the session's name, which is the first prompt and is skipped).
#[must_use]
pub fn read_workspace(dir: &Path) -> Workspace {
    let Ok(text) = fs::read_to_string(dir.join("workspace.yaml")) else {
        return Workspace::default();
    };
    let mut workspace = Workspace::default();
    for line in text.lines() {
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match key.trim() {
            "cwd" if !value.is_empty() => workspace.cwd = Some(PathBuf::from(unquote(value))),
            "created_at" => workspace.created_at_ms = parse_timestamp_ms(unquote(value)),
            _ => {}
        }
    }
    workspace
}

fn unquote(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
        .unwrap_or(value)
}

/// An RFC 3339 timestamp as Unix milliseconds.
#[must_use]
pub fn parse_timestamp_ms(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|time| time.timestamp_millis())
}

/// Where a session is in answering the last prompt.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Turn {
    /// No answer under way: waiting for the user (or never prompted).
    #[default]
    Idle,
    /// Between `assistant.turn_start` (or a prompt) and the response.
    Answering,
    /// The last `assistant.message` asked for tools: the `turn_end` that follows is the CLI
    /// moving on to run them and answer again, not the end of the answer.
    RunningTools,
}

/// What the log said so far about one session.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CopilotState {
    /// The model the session started with, then the one that last answered.
    pub model: Option<String>,
    /// `session.start`'s `startTime`.
    pub started_at_ms: Option<i64>,
    /// The timestamp of the last event applied.
    pub last_event_ms: Option<i64>,
    /// The CLI logs one turn per model response, so a response that asked for tools ends in
    /// an `assistant.turn_end` the user never sees; only the response without tool requests
    /// brings the session back to [`Turn::Idle`].
    pub turn: Turn,
    /// The CLI reported the task complete: waiting for the user, even if a turn is open.
    pub task_complete: bool,
    /// `session.shutdown` was logged.
    pub ended: bool,
    /// User and assistant messages seen.
    pub messages: u32,
    /// The first line of the last prompt.
    pub task: Option<String>,
    /// The last file a tool was asked to read or edit.
    pub file: Option<String>,
}

impl CopilotState {
    /// `true` while the CLI is answering the last prompt, tool runs included.
    pub fn in_turn(&self) -> bool {
        self.turn != Turn::Idle
    }
}

#[derive(Deserialize)]
struct Envelope {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    timestamp: Option<String>,
}

#[derive(Deserialize)]
struct SessionStart {
    #[serde(default)]
    data: SessionStartData,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SessionStartData {
    #[serde(default)]
    selected_model: Option<String>,
    #[serde(default)]
    start_time: Option<String>,
}

#[derive(Deserialize)]
struct AssistantMessage {
    #[serde(default)]
    data: AssistantMessageData,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AssistantMessageData {
    #[serde(default)]
    model: Option<String>,
    /// Tools the response asked to run; the CLI keeps going while there are any.
    #[serde(default)]
    tool_requests: Option<Vec<serde_json::Value>>,
}

#[derive(Deserialize)]
struct UserMessage {
    #[serde(default)]
    data: UserMessageData,
}

#[derive(Deserialize, Default)]
struct UserMessageData {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Deserialize)]
struct ToolStart {
    #[serde(default)]
    data: ToolStartData,
}

#[derive(Deserialize, Default)]
struct ToolStartData {
    #[serde(default)]
    arguments: Option<ToolArguments>,
}

#[derive(Deserialize, Default)]
struct ToolArguments {
    #[serde(default)]
    path: Option<String>,
}

/// Folds one log line into `state`; `true` when anything the panel shows changed.
pub fn apply_line(state: &mut CopilotState, line: &str) -> bool {
    let Ok(envelope) = serde_json::from_str::<Envelope>(line) else {
        return false;
    };
    let before = state.clone();
    if let Some(at) = envelope.timestamp.as_deref().and_then(parse_timestamp_ms) {
        state.last_event_ms = Some(at);
    }
    match envelope.kind.as_str() {
        "session.start" => {
            if let Ok(event) = serde_json::from_str::<SessionStart>(line) {
                if event.data.selected_model.is_some() {
                    state.model = event.data.selected_model;
                }
                state.started_at_ms = event
                    .data
                    .start_time
                    .as_deref()
                    .and_then(parse_timestamp_ms)
                    .or(state.started_at_ms);
            }
        }
        "assistant.turn_start" => {
            state.turn = Turn::Answering;
            state.task_complete = false;
        }
        // A response that asked for tools ends in a `turn_end` the CLI follows with the tool
        // runs and another turn; the answer is only over when the last response asked for
        // nothing.
        "assistant.turn_end" => {
            if state.turn == Turn::Answering {
                state.turn = Turn::Idle;
            }
        }
        "abort" | "session.error" => state.turn = Turn::Idle,
        "assistant.message" => {
            state.messages = state.messages.saturating_add(1);
            if let Ok(event) = serde_json::from_str::<AssistantMessage>(line) {
                if event.data.model.is_some() {
                    state.model = event.data.model;
                }
                let asked_for_tools = event
                    .data
                    .tool_requests
                    .is_some_and(|requests| !requests.is_empty());
                // A response is always part of a turn, even when the tail joined the log
                // after its `turn_start`.
                state.turn = if asked_for_tools {
                    Turn::RunningTools
                } else {
                    Turn::Answering
                };
            }
        }
        "user.message" => {
            state.messages = state.messages.saturating_add(1);
            state.turn = Turn::Answering;
            state.task_complete = false;
            if let Ok(event) = serde_json::from_str::<UserMessage>(line)
                && let Some(task) = event.data.content.as_deref().and_then(task_line)
            {
                state.task = Some(task);
            }
        }
        "tool.execution_start" => {
            if let Ok(event) = serde_json::from_str::<ToolStart>(line)
                && let Some(path) = event.data.arguments.and_then(|arguments| arguments.path)
            {
                state.file = Some(path);
            }
        }
        "session.task_complete" => state.task_complete = true,
        "session.shutdown" => {
            state.ended = true;
            state.turn = Turn::Idle;
        }
        _ => {}
    }
    *state != before
}

/// The first non-empty line of a prompt, trimmed to [`TASK_CHARS`] characters.
#[must_use]
pub fn task_line(content: &str) -> Option<String> {
    let line = content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let mut task: String = line.chars().take(TASK_CHARS).collect();
    if task.len() < line.len() {
        task.push('…');
    }
    Some(task)
}

/// The path of a session's log.
#[must_use]
pub fn events_path(dir: &Path) -> PathBuf {
    dir.join("events.jsonl")
}

/// Opens a tail on a session's log (see [`Tail::open`] for the size rule).
#[must_use]
pub fn open_tail(dir: &Path) -> Tail {
    Tail::open(events_path(dir))
}
