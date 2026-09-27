//! The `ai-coding` module backend (docs/modules/ai-coding.md): the coding-agent sessions on
//! this machine — which project each works in, on what model, whether it is running, waiting
//! for the user or done — and *Allow* / *Deny* on the strip when an agent asks permission.
//!
//! Two sources feed it. **Claude Code** posts its hook events to the loopback [`receiver`]
//! ([`claude`] parses them; a `PermissionRequest` is held until the user decides). **GitHub
//! Copilot CLI** has no hooks, so [`copilot`] finds live sessions by their lock files and follows
//! each log with a [`jsonl::Tail`] on a short cadence. Any other process may post the documented
//! generic document. [`AiCodingService`] is the reducer: everything that decides is synchronous
//! and takes its clock and platform from the constructor, so `tests/ai_coding.rs` drives it
//! with temp folders, scripted pids and a `FakeClock`.
//!
//! Privacy (`.github/copilot-instructions.md`, "local-first & private"): the receiver listens on
//! `127.0.0.1` only and refuses posts without the per-install token; prompts, file names and
//! commands shown in the panel are the user's own sessions and are never logged; transcripts are
//! read for `usage` and the branch only.

pub mod claude;
pub mod copilot;
pub mod git;
pub mod jsonl;
pub mod receiver;
pub mod settings;

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use muna_core::{
    Activity, Clock, Glyph, Hub, Int53, Leading, Notice, Settings, Store, StoreError, StripMessage,
    Tint, Trailing, activities::priority,
};
use muna_platform::{Platform, PlatformError, WindowHandle};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use tokio::sync::{Notify, oneshot};

use super::{ModuleBackend, ModuleCtx, Surface};
use claude::{HookEvent, HookPayload, NotificationKind, TranscriptStats};
use copilot::{CopilotSource, CopilotState};
use jsonl::Tail;
pub use receiver::{HookError, HookHandler, Reply, Route};
pub use settings::{AiCodingSettings, DEFAULT_PORT};

pub const ID: &str = "ai-coding";

/// The `meta` key the receiver's bearer token is kept under.
pub const TOKEN_KEY: &str = "ai-coding:token";
/// Random bytes in the token (shown as 64 hex digits).
pub const TOKEN_BYTES: u32 = 32;
/// How often Copilot logs are read while a session is in a turn.
pub const POLL_ACTIVE: Duration = Duration::from_secs(2);
/// How often live sessions are looked for and idle logs re-read.
pub const POLL_IDLE: Duration = Duration::from_secs(10);
/// A Claude session that posted nothing for this long is taken as gone (its hooks did not
/// deliver a `SessionEnd`).
pub const CLAUDE_SILENCE: Duration = Duration::from_mins(30);
/// How long a finished session stays under *Recent*.
pub const RECENT_FOR: Duration = Duration::from_hours(24);
/// How many finished sessions *Recent* keeps.
pub const RECENT_MAX: usize = 20;

/// Which agent runs a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AiAgent {
    Claude,
    Copilot,
    Generic,
}

impl AiAgent {
    /// The name the strip and the panel show.
    #[must_use]
    pub const fn display_name(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Copilot => "GitHub Copilot",
            Self::Generic => "Coding agent",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AiStatus {
    Running,
    Waiting,
    Done,
}

/// Why a session stopped for the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum WaitingKind {
    /// The agent asks whether it may run a tool.
    Permission,
    /// The agent finished its turn and waits for the next prompt.
    Input,
    /// The agent has been idle for a while.
    Idle,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiWaiting {
    pub kind: WaitingKind,
    /// The tool the agent wants to run (permission requests).
    pub tool: Option<String>,
    /// What the tool would do: the command or the file. The user's own session content.
    pub detail: Option<String>,
    /// `true` while *Allow* / *Deny* reach the agent (a held Claude Code hook).
    pub decidable: bool,
    #[specta(type = Int53)]
    pub since_ms: i64,
}

/// One session as the panel shows it (docs/modules/ai-coding.md, *Reference*).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiSession {
    /// `<agent>:<the agent's own session id>`.
    pub id: String,
    pub agent: AiAgent,
    /// The working directory's name.
    pub project: Option<String>,
    pub branch: Option<String>,
    pub model: Option<String>,
    pub status: AiStatus,
    pub waiting: Option<AiWaiting>,
    /// The first line of the last prompt.
    pub task: Option<String>,
    /// The file the agent last read or edited, relative to the project when inside it.
    pub file: Option<String>,
    #[specta(type = Int53)]
    pub started_at_ms: i64,
    #[specta(type = Int53)]
    pub updated_at_ms: i64,
    /// Prompts and answers so far; `None` when the log was too large to count from its start.
    pub messages: Option<u32>,
    /// Tokens the agent reported; `None` when the agent does not report them.
    #[specta(type = Option<Int53>)]
    pub tokens: Option<i64>,
    /// `true` when *Show* can bring the session's terminal forward.
    pub can_focus: bool,
}

/// The hook receiver as the pane shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReceiverState {
    /// The port asked for, or the one actually bound while listening.
    pub port: u16,
    pub listening: bool,
    /// The URL Claude Code's hooks post to.
    pub hook_url: String,
    /// `true` when `%USERPROFILE%\.claude\settings.json` has our hooks for this URL.
    pub claude_hooks_installed: bool,
}

/// What the UI renders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiCodingSnapshot {
    pub enabled: bool,
    /// Live sessions: waiting first (decidable first), then running, newest change first.
    pub sessions: Vec<AiSession>,
    /// Finished sessions of the last [`RECENT_FOR`], newest first.
    pub recent: Vec<AiSession>,
    pub receiver: ReceiverState,
    #[specta(type = Int53)]
    pub generated_at_ms: i64,
}

/// What the UI can ask for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AiCodingCommand {
    /// Look for sessions and read their logs now.
    Refresh,
    /// Answer a held permission request.
    Allow {
        session: String,
    },
    Deny {
        session: String,
    },
    /// Bring the session's terminal forward.
    Focus {
        session: String,
    },
    /// Take a waiting session off the strip, or a finished one out of *Recent*.
    Dismiss {
        session: String,
    },
    /// Write or remove our hooks in Claude Code's settings file.
    InstallClaudeHooks,
    RemoveClaudeHooks,
}

#[derive(Debug, thiserror::Error)]
pub enum AiCodingError {
    #[error("unknown session")]
    Unknown,
    #[error("the session is not waiting for a decision")]
    NotWaiting,
    #[error("the hook installer could not edit Claude Code's settings: {0}")]
    HooksFile(#[source] io::Error),
    #[error("no profile directory: Claude Code's settings file has no path")]
    NoProfile,
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Platform(#[from] PlatformError),
    #[error(transparent)]
    Store(#[from] StoreError),
}

/// Receives the snapshot when it changes.
pub trait AiCodingSink: Send + Sync {
    fn changed(&self, snapshot: &AiCodingSnapshot);
}

/// Where the adapters look. `None` turns a source off (tests, or no profile directory).
#[derive(Debug, Clone, Default)]
pub struct AiCodingPaths {
    /// Copilot CLI's `session-state` folder.
    pub copilot_root: Option<PathBuf>,
    /// Claude Code's `settings.json`.
    pub claude_settings: Option<PathBuf>,
}

impl AiCodingPaths {
    /// The user's profile locations.
    #[must_use]
    pub fn from_profile() -> Self {
        Self {
            copilot_root: CopilotSource::default_root(),
            claude_settings: claude::default_settings_path(),
        }
    }
}

/// What a session reads from.
enum Source {
    Copilot {
        dir: PathBuf,
        tail: Tail,
        state: CopilotState,
        /// `true` once the log was read at least once, so a quiet poll changes nothing.
        primed: bool,
    },
    Claude {
        transcript: Option<Tail>,
        stats: TranscriptStats,
    },
    Generic,
}

/// What a poll decided for one session, applied once its borrow ends.
enum Outcome {
    Finish,
    Settle { was_running: bool },
}

/// What the module has on the strip for a session's current waiting spell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Strip {
    Nothing,
    /// The *Allow* / *Deny* activity.
    Decision,
    /// A notice went out; it dismisses itself.
    Noticed,
}

struct Tracked {
    session: AiSession,
    cwd: Option<PathBuf>,
    pid: Option<u32>,
    window: Option<WindowHandle>,
    source: Source,
    strip: Strip,
    /// The user took this waiting spell off the strip; nothing more until the session runs.
    dismissed: bool,
    /// Wall time of the last sign of life, for the silence rule.
    last_seen_ms: i64,
}

struct Inner {
    settings: AiCodingSettings,
    sessions: BTreeMap<String, Tracked>,
    recent: VecDeque<AiSession>,
    /// Held permission requests, by session id.
    pending: HashMap<String, oneshot::Sender<Value>>,
    receiver: ReceiverState,
    copilot: Option<CopilotSource>,
    watchers: HashSet<String>,
    locked: bool,
}

pub struct AiCodingService {
    platform: Arc<dyn Platform>,
    hub: Arc<Hub>,
    store: Arc<Store>,
    clock: Arc<dyn Clock>,
    claude_settings: Option<PathBuf>,
    sink: Mutex<Option<Arc<dyn AiCodingSink>>>,
    inner: Mutex<Inner>,
    /// Wakes the poll loop when the cadence may have changed.
    pub(crate) wake: Notify,
    /// Wakes the receiver loop when the port or the switch changed.
    pub(crate) receiver_wake: Notify,
}

impl std::fmt::Debug for AiCodingService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let inner = self.inner.lock();
        f.debug_struct("AiCodingService")
            .field("settings", &inner.settings)
            .field("sessions", &inner.sessions.len())
            .field("recent", &inner.recent.len())
            .field("receiver", &inner.receiver)
            .finish_non_exhaustive()
    }
}

impl AiCodingService {
    #[must_use]
    pub fn new(
        platform: Arc<dyn Platform>,
        hub: Arc<Hub>,
        store: Arc<Store>,
        clock: Arc<dyn Clock>,
        paths: AiCodingPaths,
    ) -> Self {
        let settings = AiCodingSettings::default();
        let receiver = ReceiverState {
            port: settings.port,
            listening: false,
            hook_url: hook_url(settings.port),
            claude_hooks_installed: false,
        };
        Self {
            platform,
            hub,
            store,
            clock,
            claude_settings: paths.claude_settings,
            sink: Mutex::new(None),
            inner: Mutex::new(Inner {
                settings,
                sessions: BTreeMap::new(),
                recent: VecDeque::new(),
                pending: HashMap::new(),
                receiver,
                copilot: paths.copilot_root.map(CopilotSource::new),
                watchers: HashSet::new(),
                locked: false,
            }),
            wake: Notify::new(),
            receiver_wake: Notify::new(),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn AiCodingSink>) {
        *self.sink.lock() = Some(sink);
    }

    #[must_use]
    pub fn settings(&self) -> AiCodingSettings {
        self.inner.lock().settings.clone()
    }

    /// The receiver's bearer token, minted on first use and kept in the profile database.
    pub fn token(&self) -> Result<String, StoreError> {
        self.store.meta_or_random(TOKEN_KEY, TOKEN_BYTES)
    }

    /// A panel in the notch window `label` opened (`true`) or closed (`false`); snapshots are
    /// published while any is open.
    pub fn watch(&self, label: &str, watching: bool) {
        let changed = {
            let mut inner = self.inner.lock();
            if watching {
                inner.watchers.insert(label.to_owned())
            } else {
                inner.watchers.remove(label)
            }
        };
        if changed {
            self.wake.notify_one();
        }
    }

    /// A notch window went away without closing its panel.
    pub fn forget_window(&self, label: &str) {
        if self.inner.lock().watchers.remove(label) {
            self.wake.notify_one();
        }
    }

    #[must_use]
    pub fn is_watched(&self) -> bool {
        !self.inner.lock().watchers.is_empty()
    }

    /// Applies `settings.modules["ai-coding"]` (start-up and every settings change). Turning
    /// the module off forgets every session and answers held requests with the neutral reply.
    pub fn apply_settings(&self, settings: &Settings) {
        let next = AiCodingSettings::from_document(settings);
        let mut retract = Vec::new();
        {
            let mut inner = self.inner.lock();
            if inner.settings == next {
                return;
            }
            let previous = std::mem::replace(&mut inner.settings, next.clone());
            if previous.enabled && !next.enabled {
                inner.pending.clear();
                retract.extend(
                    inner
                        .sessions
                        .values()
                        .filter(|tracked| tracked.strip == Strip::Decision)
                        .map(|tracked| activity_id(&tracked.session.id)),
                );
                inner.sessions.clear();
                inner.recent.clear();
            }
            if previous.copilot_cli && !next.copilot_cli {
                let copilot_ids: Vec<String> = inner
                    .sessions
                    .iter()
                    .filter(|(_, tracked)| tracked.session.agent == AiAgent::Copilot)
                    .map(|(id, _)| id.clone())
                    .collect();
                for id in copilot_ids {
                    if let Some(tracked) = inner.sessions.remove(&id)
                        && tracked.strip == Strip::Decision
                    {
                        retract.push(activity_id(&id));
                    }
                }
            }
            if !inner.receiver.listening {
                inner.receiver.port = next.port;
                inner.receiver.hook_url = hook_url(next.port);
            }
            if !next.waiting_notice {
                for tracked in inner.sessions.values_mut() {
                    if tracked.strip == Strip::Decision {
                        retract.push(activity_id(&tracked.session.id));
                    }
                    tracked.strip = Strip::Nothing;
                }
            }
            if previous.enabled != next.enabled || previous.port != next.port {
                self.receiver_wake.notify_one();
            }
        }
        for id in retract {
            self.hub.retract_activity(&id);
        }
        self.wake.notify_one();
        self.emit_if_watched();
    }

    /// The receiver bound `port` (`Some`) or stopped listening (`None`).
    pub fn receiver_bound(&self, port: Option<u16>) {
        {
            let mut inner = self.inner.lock();
            if let Some(port) = port {
                inner.receiver.port = port;
                inner.receiver.listening = true;
            } else {
                inner.receiver.port = inner.settings.port;
                inner.receiver.listening = false;
            }
            inner.receiver.hook_url = hook_url(inner.receiver.port);
            inner.receiver.claude_hooks_installed = self.hooks_installed(&inner.receiver.hook_url);
        }
        self.emit_if_watched();
    }

    /// The session locked or unlocked; nothing is read while locked.
    pub fn set_locked(&self, locked: bool) {
        self.inner.lock().locked = locked;
        self.wake.notify_one();
    }

    /// How often to poll, or `None` when nothing can change without a hook (off, locked, or
    /// no Copilot source and no session to expire). Quick while a Copilot session is in a turn
    /// or a panel watches; slow otherwise.
    #[must_use]
    pub fn cadence(&self) -> Option<Duration> {
        let inner = self.inner.lock();
        if !inner.settings.enabled || inner.locked {
            return None;
        }
        let copilot_on = inner.settings.copilot_cli && inner.copilot.is_some();
        if !copilot_on && inner.sessions.is_empty() && inner.recent.is_empty() {
            return None;
        }
        let in_turn = inner.sessions.values().any(|tracked| {
            tracked.session.agent == AiAgent::Copilot && tracked.session.status == AiStatus::Running
        });
        Some(if in_turn || !inner.watchers.is_empty() {
            POLL_ACTIVE
        } else {
            POLL_IDLE
        })
    }

    /// Looks for Copilot sessions and reads what their logs appended, retires silent Claude
    /// sessions and prunes *Recent*. Blocking file reads: call off the async threads.
    pub fn poll(&self) {
        let now = self.now_ms();
        let mut changed = false;
        let mut strip_ops = Vec::new();
        {
            let mut inner = self.inner.lock();
            if !inner.settings.enabled || inner.locked {
                return;
            }
            if inner.settings.copilot_cli {
                changed |= self.poll_copilot(&mut inner, now, &mut strip_ops);
            }
            changed |= Self::expire(&mut inner, now, &mut strip_ops);
        }
        self.apply_strip(strip_ops);
        if changed {
            self.emit_if_watched();
        }
    }

    fn poll_copilot(&self, inner: &mut Inner, now: i64, ops: &mut Vec<StripOp>) -> bool {
        let Some(live) = self.live_copilot_dirs(inner) else {
            return false;
        };
        let mut changed = false;
        // Sessions whose lock or process went away are done.
        let gone: Vec<String> = inner
            .sessions
            .iter()
            .filter(|(id, tracked)| {
                tracked.session.agent == AiAgent::Copilot && !live.contains_key(*id)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in gone {
            Self::finish(inner, &id, now, ops);
            changed = true;
        }
        for (id, (dir, pid)) in &live {
            if !inner.sessions.contains_key(id) {
                self.adopt_copilot_dir(inner, id, dir, *pid, now);
                changed = true;
            }
        }
        for id in live.keys() {
            if let Some(outcome) = Self::read_copilot_log(inner, id, now) {
                match outcome {
                    Outcome::Finish => Self::finish(inner, id, now, ops),
                    Outcome::Settle { was_running } => Self::settle(inner, id, was_running, ops),
                }
                changed = true;
            }
        }
        changed
    }

    /// Every Copilot session folder whose lock names a running process, by session id.
    /// `None` when the Copilot source is off.
    fn live_copilot_dirs(&self, inner: &mut Inner) -> Option<HashMap<String, (PathBuf, u32)>> {
        let copilot = inner.copilot.as_mut()?;
        let processes = self.platform.processes();
        let mut live: HashMap<String, (PathBuf, u32)> = copilot
            .live_dirs()
            .into_iter()
            .filter(|dir| processes.is_running(dir.pid).unwrap_or(false))
            .map(|dir| (format!("copilot:{}", dir.id), (dir.dir, dir.pid)))
            .collect();
        // Folders the incremental scan skipped: ask them directly.
        let tracked_dirs: Vec<(String, PathBuf)> = inner
            .sessions
            .iter()
            .filter_map(|(id, tracked)| match &tracked.source {
                Source::Copilot { dir, .. } if !live.contains_key(id) => {
                    Some((id.clone(), dir.clone()))
                }
                _ => None,
            })
            .collect();
        for (id, dir) in tracked_dirs {
            if let Some(pid) = copilot::lock_pid(&dir)
                && processes.is_running(pid).unwrap_or(false)
            {
                live.insert(id, (dir, pid));
            }
        }
        Some(live)
    }

    /// Starts tracking a Copilot session folder. Nothing is announced for a session found
    /// already waiting, so it starts dismissed.
    fn adopt_copilot_dir(&self, inner: &mut Inner, id: &str, dir: &Path, pid: u32, now: i64) {
        let workspace = copilot::read_workspace(dir);
        let cwd = workspace.cwd.clone();
        let session = AiSession {
            id: id.to_owned(),
            agent: AiAgent::Copilot,
            project: cwd.as_deref().and_then(project_name),
            branch: cwd.as_deref().and_then(git::branch_of),
            model: None,
            status: AiStatus::Waiting,
            waiting: None,
            task: None,
            file: None,
            started_at_ms: workspace.created_at_ms.unwrap_or(now),
            updated_at_ms: now,
            messages: None,
            tokens: None,
            can_focus: false,
        };
        let window = self.platform.processes().main_window(pid).ok().flatten();
        inner.sessions.insert(
            id.to_owned(),
            Tracked {
                session,
                cwd,
                pid: Some(pid),
                window,
                source: Source::Copilot {
                    dir: dir.to_path_buf(),
                    tail: copilot::open_tail(dir),
                    state: CopilotState::default(),
                    primed: false,
                },
                strip: Strip::Nothing,
                dismissed: true,
                last_seen_ms: now,
            },
        );
    }

    /// Reads what a Copilot session log appended and folds it into the session. `None` when
    /// nothing changed (or the log could not be read).
    fn read_copilot_log(inner: &mut Inner, id: &str, now: i64) -> Option<Outcome> {
        let tracked = inner.sessions.get_mut(id)?;
        let Source::Copilot {
            tail,
            state,
            primed,
            ..
        } = &mut tracked.source
        else {
            return None;
        };
        let lines = match tail.read_new() {
            Ok(lines) => lines,
            Err(error) => {
                tracing::warn!(%error, "copilot session log could not be read");
                return None;
            }
        };
        let mut touched = false;
        for line in &lines {
            touched |= copilot::apply_line(state, line);
        }
        if !touched && *primed {
            return None;
        }
        *primed = true;
        let session = &mut tracked.session;
        if let Some(model) = &state.model {
            session.model = Some(model.clone());
        }
        if let Some(started) = state.started_at_ms {
            session.started_at_ms = started;
        }
        session.task.clone_from(&state.task);
        session.file = state
            .file
            .as_deref()
            .map(|file| relative_file(file, tracked.cwd.as_deref()));
        session.messages = (!tail.is_partial()).then_some(state.messages);
        let at = state.last_event_ms.unwrap_or(now);
        session.updated_at_ms = at;
        tracked.last_seen_ms = now;
        let was_running = session.status == AiStatus::Running;
        let (status, waiting) = copilot_status(state, at);
        if status == AiStatus::Done {
            return Some(Outcome::Finish);
        }
        session.status = status;
        session.waiting = waiting;
        session.can_focus = tracked.window.is_some();
        Some(Outcome::Settle { was_running })
    }

    /// Retires Claude sessions silent for [`CLAUDE_SILENCE`] and drops *Recent* entries older
    /// than [`RECENT_FOR`].
    fn expire(inner: &mut Inner, now: i64, ops: &mut Vec<StripOp>) -> bool {
        let mut changed = false;
        let silent: Vec<String> = inner
            .sessions
            .iter()
            .filter(|(_, tracked)| {
                tracked.session.agent != AiAgent::Copilot
                    && now - tracked.last_seen_ms >= duration_ms(CLAUDE_SILENCE)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in silent {
            Self::finish(inner, &id, now, ops);
            changed = true;
        }
        let before = inner.recent.len();
        inner
            .recent
            .retain(|session| now - session.updated_at_ms < duration_ms(RECENT_FOR));
        changed |= inner.recent.len() != before;
        changed
    }

    /// Moves a session to *Recent* and takes it off the strip.
    fn finish(inner: &mut Inner, id: &str, now: i64, ops: &mut Vec<StripOp>) {
        let Some(mut tracked) = inner.sessions.remove(id) else {
            return;
        };
        inner.pending.remove(id);
        if tracked.strip == Strip::Decision {
            ops.push(StripOp::Retract(activity_id(id)));
        }
        tracked.session.status = AiStatus::Done;
        tracked.session.waiting = None;
        tracked.session.updated_at_ms = now;
        tracked.session.can_focus = false;
        inner.recent.push_front(tracked.session);
        inner.recent.truncate(RECENT_MAX);
    }

    /// Brings the strip in line with a session's status. A decidable wait shows the *Allow* /
    /// *Deny* activity; any other wait entered from *running* earns one notice; running or
    /// done clears what was there.
    fn settle(inner: &mut Inner, id: &str, was_running: bool, ops: &mut Vec<StripOp>) {
        let announce = inner.settings.waiting_notice;
        let Some(tracked) = inner.sessions.get_mut(id) else {
            return;
        };
        let session = &tracked.session;
        match (&session.status, &session.waiting) {
            (AiStatus::Waiting, Some(waiting)) if waiting.decidable => {
                if announce && tracked.strip != Strip::Decision && !tracked.dismissed {
                    ops.push(StripOp::Publish(Box::new(decision_activity(
                        session, waiting,
                    ))));
                    tracked.strip = Strip::Decision;
                }
            }
            (AiStatus::Waiting, Some(waiting)) => {
                if tracked.strip == Strip::Decision {
                    ops.push(StripOp::Retract(activity_id(id)));
                    tracked.strip = Strip::Nothing;
                }
                if announce
                    && tracked.strip == Strip::Nothing
                    && !tracked.dismissed
                    && (was_running || waiting.kind == WaitingKind::Permission)
                {
                    ops.push(StripOp::Notice(Box::new(waiting_notice(session, waiting))));
                    tracked.strip = Strip::Noticed;
                }
            }
            _ => {
                if tracked.strip == Strip::Decision {
                    ops.push(StripOp::Retract(activity_id(id)));
                }
                tracked.strip = Strip::Nothing;
                tracked.dismissed = false;
            }
        }
    }

    fn apply_strip(&self, ops: Vec<StripOp>) {
        for op in ops {
            match op {
                StripOp::Publish(activity) => self.hub.publish_activity(*activity),
                StripOp::Retract(id) => self.hub.retract_activity(&id),
                StripOp::Notice(notice) => self.hub.publish_notice(*notice),
            }
        }
    }

    /// The Claude Code adapter: folds one hook post into its session.
    fn handle_claude(&self, body: Value, peer_port: u16) -> Result<Reply, HookError> {
        let payload: HookPayload = serde_json::from_value(body)
            .map_err(|error| HookError::Invalid(format!("claude hook: {error}")))?;
        if payload.session_id.is_empty() || payload.hook_event_name.is_empty() {
            return Err(HookError::Invalid(
                "claude hook: session_id and hook_event_name are required".into(),
            ));
        }
        let now = self.now_ms();
        let id = format!("claude:{}", payload.session_id);
        let event = HookEvent::parse(&payload.hook_event_name);
        let mut ops = Vec::new();
        let reply = {
            let mut guard = self.inner.lock();
            let inner: &mut Inner = &mut guard;
            if !inner.settings.enabled {
                return Err(HookError::Off);
            }
            if !inner.sessions.contains_key(&id) {
                inner.sessions.insert(
                    id.clone(),
                    self.adopt_claude(&id, payload.cwd.as_deref(), peer_port, now),
                );
            }
            let tracked = inner
                .sessions
                .get_mut(&id)
                .expect("inserted above when missing");
            if tracked.pid.is_none() {
                let processes = self.platform.processes();
                tracked.pid = processes.owner_of_local_port(peer_port).ok().flatten();
                tracked.window = tracked
                    .pid
                    .and_then(|pid| processes.main_window(pid).ok().flatten());
            }
            tracked.last_seen_ms = now;
            Self::fold_claude_transcript(tracked, payload.transcript_path.as_deref());
            if let Some(model) = payload.model.clone() {
                tracked.session.model = Some(model);
            }
            tracked.session.updated_at_ms = now;
            tracked.session.can_focus = tracked.window.is_some();
            let was_running = tracked.session.status == AiStatus::Running;
            let held = inner.pending.contains_key(&id);
            let transition = claude_transition(event, &payload, tracked, held, now);
            match transition {
                Transition::Finished => {
                    Self::finish(inner, &id, now, &mut ops);
                    Reply::Now(claude::empty_response())
                }
                Transition::Hold => {
                    let (sender, receiver) = oneshot::channel();
                    inner.pending.insert(id.clone(), sender);
                    Self::settle(inner, &id, was_running, &mut ops);
                    Reply::Hold {
                        session: id.clone(),
                        decision: receiver,
                        fallback: claude::empty_response(),
                    }
                }
                Transition::Settled => {
                    Self::settle(inner, &id, was_running, &mut ops);
                    Reply::Now(claude::empty_response())
                }
            }
        };
        self.apply_strip(ops);
        self.emit_if_watched();
        Ok(reply)
    }

    /// A Claude Code session seen for the first time: its terminal is the process that owns the
    /// connecting port.
    fn adopt_claude(&self, id: &str, cwd: Option<&str>, peer_port: u16, now: i64) -> Tracked {
        let processes = self.platform.processes();
        let cwd = cwd.map(PathBuf::from);
        let pid = processes.owner_of_local_port(peer_port).ok().flatten();
        let window = pid.and_then(|pid| processes.main_window(pid).ok().flatten());
        Tracked {
            session: AiSession {
                id: id.to_owned(),
                agent: AiAgent::Claude,
                project: cwd.as_deref().and_then(project_name),
                branch: cwd.as_deref().and_then(git::branch_of),
                model: None,
                status: AiStatus::Running,
                waiting: None,
                task: None,
                file: None,
                started_at_ms: now,
                updated_at_ms: now,
                messages: None,
                tokens: None,
                can_focus: window.is_some(),
            },
            cwd,
            pid,
            window,
            source: Source::Claude {
                transcript: None,
                stats: TranscriptStats::default(),
            },
            strip: Strip::Nothing,
            dismissed: false,
            last_seen_ms: now,
        }
    }

    /// Reads what the transcript appended since the last hook and refreshes the counters.
    fn fold_claude_transcript(tracked: &mut Tracked, transcript_path: Option<&str>) {
        let Source::Claude { transcript, stats } = &mut tracked.source else {
            return;
        };
        if transcript.is_none()
            && let Some(path) = transcript_path
        {
            *transcript = Some(claude::open_transcript(Path::new(path)));
        }
        let Some(tail) = transcript.as_mut() else {
            return;
        };
        match tail.read_new() {
            Ok(lines) => {
                for line in &lines {
                    claude::apply_transcript_line(stats, line);
                }
            }
            Err(error) => {
                tracing::warn!(%error, "claude transcript could not be read");
            }
        }
        let session = &mut tracked.session;
        session.messages = (!tail.is_partial()).then_some(stats.messages);
        session.tokens = Some(i64::try_from(Int53::saturate(stats.tokens)).unwrap_or(i64::MAX));
        if let Some(model) = &stats.model {
            session.model = Some(model.clone());
        }
        if let Some(branch) = &stats.branch {
            session.branch = Some(branch.clone());
        }
    }

    /// The generic adapter: any process describing its own session.
    fn handle_generic(&self, body: Value) -> Result<Reply, HookError> {
        let payload: GenericPayload = serde_json::from_value(body)
            .map_err(|error| HookError::Invalid(format!("generic hook: {error}")))?;
        if payload.agent.trim().is_empty() || payload.session_id.trim().is_empty() {
            return Err(HookError::Invalid(
                "generic hook: agent and sessionId are required".into(),
            ));
        }
        let status = match payload.status.as_str() {
            "running" => AiStatus::Running,
            "waiting" => AiStatus::Waiting,
            "done" => AiStatus::Done,
            other => {
                return Err(HookError::Invalid(format!(
                    "generic hook: status must be running, waiting or done, not {other}"
                )));
            }
        };
        let now = self.now_ms();
        let id = format!(
            "generic:{}:{}",
            slug(&payload.agent),
            payload.session_id.trim()
        );
        let mut ops = Vec::new();
        {
            let mut guard = self.inner.lock();
            let inner: &mut Inner = &mut guard;
            if !inner.settings.enabled {
                return Err(HookError::Off);
            }
            if !inner.sessions.contains_key(&id) {
                let window = payload
                    .pid
                    .and_then(|pid| self.platform.processes().main_window(pid).ok().flatten());
                inner.sessions.insert(
                    id.clone(),
                    Tracked {
                        session: AiSession {
                            id: id.clone(),
                            agent: AiAgent::Generic,
                            project: None,
                            branch: None,
                            model: None,
                            status: AiStatus::Running,
                            waiting: None,
                            task: None,
                            file: None,
                            started_at_ms: now,
                            updated_at_ms: now,
                            messages: None,
                            tokens: None,
                            can_focus: window.is_some(),
                        },
                        cwd: None,
                        pid: payload.pid,
                        window,
                        source: Source::Generic,
                        strip: Strip::Nothing,
                        dismissed: false,
                        last_seen_ms: now,
                    },
                );
            }
            let tracked = inner
                .sessions
                .get_mut(&id)
                .expect("inserted above when missing");
            tracked.last_seen_ms = now;
            let was_running = tracked.session.status == AiStatus::Running;
            payload.apply_to(&mut tracked.session, status, now);
            if status == AiStatus::Done {
                Self::finish(inner, &id, now, &mut ops);
            } else {
                Self::settle(inner, &id, was_running, &mut ops);
            }
        }
        self.apply_strip(ops);
        self.emit_if_watched();
        Ok(Reply::Now(claude::empty_response()))
    }

    /// Answers a held permission request. The session runs on either way: Claude Code acts on
    /// the decision and posts what follows.
    fn decide(&self, id: &str, allow: bool) -> Result<(), AiCodingError> {
        let mut ops = Vec::new();
        {
            let mut inner = self.inner.lock();
            if !inner.sessions.contains_key(id) {
                return Err(AiCodingError::Unknown);
            }
            let sender = inner.pending.remove(id).ok_or(AiCodingError::NotWaiting)?;
            // A dropped receiver means the hook already went out with its fallback; the
            // session still moves on.
            let _ = sender.send(claude::permission_response(allow));
            if let Some(tracked) = inner.sessions.get_mut(id) {
                tracked.session.status = AiStatus::Running;
                tracked.session.waiting = None;
                tracked.session.updated_at_ms = self.now_ms();
            }
            Self::settle(&mut inner, id, false, &mut ops);
        }
        self.apply_strip(ops);
        tracing::info!(allow, "ai coding permission answered");
        Ok(())
    }

    fn focus(&self, id: &str) -> Result<(), AiCodingError> {
        let (pid, window) = {
            let inner = self.inner.lock();
            let tracked = inner.sessions.get(id).ok_or(AiCodingError::Unknown)?;
            (tracked.pid, tracked.window)
        };
        let processes = self.platform.processes();
        let window = if let Some(window) = window {
            window
        } else {
            // The terminal was not known when the session appeared: ask once more now.
            let pid = pid.ok_or(AiCodingError::Unknown)?;
            let window = processes
                .main_window(pid)?
                .ok_or(PlatformError::NotFound("terminal window".into()))?;
            if let Some(tracked) = self.inner.lock().sessions.get_mut(id) {
                tracked.window = Some(window);
                tracked.session.can_focus = true;
            }
            window
        };
        processes.focus(window)?;
        Ok(())
    }

    fn dismiss(&self, id: &str) -> Result<(), AiCodingError> {
        let mut ops = Vec::new();
        {
            let mut inner = self.inner.lock();
            if let Some(tracked) = inner.sessions.get_mut(id) {
                if tracked.strip == Strip::Decision {
                    ops.push(StripOp::Retract(activity_id(id)));
                }
                tracked.strip = Strip::Nothing;
                tracked.dismissed = true;
            } else {
                let before = inner.recent.len();
                inner.recent.retain(|session| session.id != id);
                if inner.recent.len() == before {
                    return Err(AiCodingError::Unknown);
                }
            }
        }
        self.apply_strip(ops);
        Ok(())
    }

    fn hooks_installed(&self, url: &str) -> bool {
        self.claude_settings
            .as_deref()
            .is_some_and(|path| claude::hooks_installed(path, url))
    }

    fn install_hooks(&self, install: bool) -> Result<(), AiCodingError> {
        let path = self
            .claude_settings
            .as_deref()
            .ok_or(AiCodingError::NoProfile)?;
        let url = self.inner.lock().receiver.hook_url.clone();
        if install {
            let token = self.token()?;
            claude::install_hooks(path, &url, &token).map_err(AiCodingError::HooksFile)?;
        } else {
            claude::remove_hooks(path).map_err(AiCodingError::HooksFile)?;
        }
        let installed = claude::hooks_installed(path, &url);
        self.inner.lock().receiver.claude_hooks_installed = installed;
        tracing::info!(installed, "claude code hooks updated");
        Ok(())
    }

    /// Runs a UI command and answers with the snapshot after it.
    pub fn command(&self, command: AiCodingCommand) -> Result<AiCodingSnapshot, AiCodingError> {
        match command {
            AiCodingCommand::Refresh => self.poll(),
            AiCodingCommand::Allow { session } => self.decide(&session, true)?,
            AiCodingCommand::Deny { session } => self.decide(&session, false)?,
            AiCodingCommand::Focus { session } => self.focus(&session)?,
            AiCodingCommand::Dismiss { session } => self.dismiss(&session)?,
            AiCodingCommand::InstallClaudeHooks => self.install_hooks(true)?,
            AiCodingCommand::RemoveClaudeHooks => self.install_hooks(false)?,
        }
        let snapshot = self.snapshot();
        self.emit_if_watched();
        Ok(snapshot)
    }

    /// The sessions as the module sees them now.
    #[must_use]
    pub fn snapshot(&self) -> AiCodingSnapshot {
        let inner = self.inner.lock();
        let mut sessions: Vec<AiSession> = inner
            .sessions
            .values()
            .map(|tracked| tracked.session.clone())
            .collect();
        sessions.sort_by(|a, b| {
            rank(a)
                .cmp(&rank(b))
                .then(b.updated_at_ms.cmp(&a.updated_at_ms))
        });
        AiCodingSnapshot {
            enabled: inner.settings.enabled,
            sessions,
            recent: inner.recent.iter().cloned().collect(),
            receiver: inner.receiver.clone(),
            generated_at_ms: self.now_ms(),
        }
    }

    fn now_ms(&self) -> i64 {
        unix_ms(self.clock.system_time())
    }

    fn emit_if_watched(&self) {
        if !self.is_watched() {
            return;
        }
        let snapshot = self.snapshot();
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.changed(&snapshot);
        }
    }
}

impl HookHandler for AiCodingService {
    fn handle(&self, route: Route, body: Value, peer_port: u16) -> Result<Reply, HookError> {
        match route {
            Route::Claude => self.handle_claude(body, peer_port),
            Route::Generic => self.handle_generic(body),
        }
    }

    /// The held request went out unanswered: Claude Code shows its own prompt, so the wait
    /// stays but *Allow* / *Deny* no longer reach it.
    fn hold_expired(&self, session: &str) {
        let mut ops = Vec::new();
        {
            let mut inner = self.inner.lock();
            inner.pending.remove(session);
            let Some(tracked) = inner.sessions.get_mut(session) else {
                return;
            };
            if let Some(waiting) = tracked.session.waiting.as_mut() {
                waiting.decidable = false;
            }
            Self::settle(&mut inner, session, false, &mut ops);
        }
        self.apply_strip(ops);
        self.emit_if_watched();
    }
}

/// The documented body for `POST /hooks/generic`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenericPayload {
    agent: String,
    #[serde(alias = "session_id")]
    session_id: String,
    status: String,
    #[serde(default)]
    project: Option<String>,
    #[serde(default)]
    branch: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    task: Option<String>,
    #[serde(default)]
    file: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default, alias = "waiting_kind")]
    waiting_kind: Option<String>,
    #[serde(default)]
    tool: Option<String>,
    #[serde(default)]
    pid: Option<u32>,
    #[serde(default)]
    messages: Option<u32>,
    #[serde(default)]
    tokens: Option<u64>,
}

impl GenericPayload {
    /// Copies every field the post carried onto the session and sets its status.
    fn apply_to(&self, session: &mut AiSession, status: AiStatus, now: i64) {
        session.updated_at_ms = now;
        if self.project.is_some() {
            session.project.clone_from(&self.project);
        }
        if self.branch.is_some() {
            session.branch.clone_from(&self.branch);
        }
        if self.model.is_some() {
            session.model.clone_from(&self.model);
        }
        if let Some(task) = self.task.as_deref().and_then(copilot::task_line) {
            session.task = Some(task);
        }
        if self.file.is_some() {
            session.file.clone_from(&self.file);
        }
        if let Some(messages) = self.messages {
            session.messages = Some(messages);
        }
        if let Some(tokens) = self.tokens {
            session.tokens = Some(i64::try_from(Int53::saturate(tokens)).unwrap_or(i64::MAX));
        }
        match status {
            AiStatus::Waiting => {
                let kind = match self.waiting_kind.as_deref() {
                    Some("permission") => WaitingKind::Permission,
                    Some("idle") => WaitingKind::Idle,
                    _ => WaitingKind::Input,
                };
                session.status = AiStatus::Waiting;
                session.waiting = Some(AiWaiting {
                    kind,
                    tool: self.tool.clone(),
                    detail: self.message.as_deref().and_then(copilot::task_line),
                    decidable: false,
                    since_ms: now,
                });
            }
            AiStatus::Running | AiStatus::Done => {
                session.status = status;
                session.waiting = None;
            }
        }
    }
}

enum StripOp {
    Publish(Box<Activity>),
    Retract(String),
    Notice(Box<Notice>),
}

/// The URL Claude Code's hooks post to for `port`.
#[must_use]
pub fn hook_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}{}", claude::ROUTE)
}

/// The strip activity id for a session's held permission request.
#[must_use]
pub fn activity_id(session: &str) -> String {
    format!("{ID}:waiting:{session}")
}

/// *Allow* / *Deny* for a held permission request: stays until answered.
#[must_use]
pub fn decision_activity(session: &AiSession, waiting: &AiWaiting) -> Activity {
    Activity {
        id: activity_id(&session.id),
        module: ID.into(),
        priority: priority::AGENT_WAITING,
        leading: Some(Leading::Icon {
            glyph: Glyph::Terminal,
            tint: Some(Tint::Orange),
        }),
        trailing: Some(Trailing::Decision {
            session: session.id.clone(),
        }),
        wide: Some(StripMessage::AgentWaiting {
            agent: session.agent.display_name().to_owned(),
            tool: waiting.tool.clone(),
        }),
    }
}

/// One notice that a session stopped for the user.
#[must_use]
pub fn waiting_notice(session: &AiSession, waiting: &AiWaiting) -> Notice {
    let permission = waiting.kind == WaitingKind::Permission;
    Notice {
        id: activity_id(&session.id),
        module: ID.into(),
        priority: priority::AGENT_WAITING,
        leading: Some(Leading::Icon {
            glyph: Glyph::Terminal,
            tint: Some(if permission { Tint::Orange } else { Tint::Blue }),
        }),
        trailing: None,
        wide: Some(StripMessage::AgentWaiting {
            agent: session.agent.display_name().to_owned(),
            tool: if permission {
                waiting.tool.clone()
            } else {
                None
            },
        }),
        hold_ms: 0,
    }
}

/// A Copilot session's status from its log.
fn copilot_status(state: &CopilotState, at_ms: i64) -> (AiStatus, Option<AiWaiting>) {
    if state.ended {
        (AiStatus::Done, None)
    } else if state.in_turn && !state.task_complete {
        (AiStatus::Running, None)
    } else {
        (
            AiStatus::Waiting,
            Some(AiWaiting {
                kind: WaitingKind::Input,
                tool: None,
                detail: None,
                decidable: false,
                since_ms: at_ms,
            }),
        )
    }
}

/// What a Claude Code hook did to its session.
enum Transition {
    /// The session ended.
    Finished,
    /// A permission request to hold until the user decides.
    Hold,
    /// Anything else: the status moved (or stayed) and the strip follows.
    Settled,
}

/// Folds one Claude Code hook into the session's status. `held` is whether a permission
/// request for this session is already waiting on the user, which later notifications must
/// not overwrite.
fn claude_transition(
    event: HookEvent,
    payload: &HookPayload,
    tracked: &mut Tracked,
    held: bool,
    now: i64,
) -> Transition {
    let cwd = tracked.cwd.as_deref();
    let session = &mut tracked.session;
    let waiting = |kind: WaitingKind, tool: Option<String>, detail: Option<String>| {
        Some(AiWaiting {
            kind,
            tool,
            detail,
            decidable: false,
            since_ms: now,
        })
    };
    match event {
        HookEvent::SessionStart => {
            session.status = AiStatus::Running;
            session.waiting = None;
        }
        HookEvent::UserPromptSubmit => {
            session.status = AiStatus::Running;
            session.waiting = None;
            if let Some(task) = payload.prompt.as_deref().and_then(copilot::task_line) {
                session.task = Some(task);
            }
        }
        HookEvent::PreToolUse | HookEvent::PostToolUse => {
            session.status = AiStatus::Running;
            session.waiting = None;
            if let Some(file) = claude::tool_file(payload.tool_input.as_ref()) {
                session.file = Some(relative_file(&file, cwd));
            }
        }
        HookEvent::PermissionRequest => {
            session.status = AiStatus::Waiting;
            session.waiting = Some(AiWaiting {
                kind: WaitingKind::Permission,
                tool: payload.tool_name.clone(),
                detail: claude::tool_detail(payload.tool_input.as_ref()),
                decidable: true,
                since_ms: now,
            });
            if let Some(file) = claude::tool_file(payload.tool_input.as_ref()) {
                session.file = Some(relative_file(&file, cwd));
            }
            return Transition::Hold;
        }
        HookEvent::Notification => {
            match NotificationKind::parse(payload.notification_type.as_deref()) {
                NotificationKind::PermissionPrompt if !held => {
                    session.status = AiStatus::Waiting;
                    session.waiting = waiting(
                        WaitingKind::Permission,
                        payload.tool_name.clone(),
                        payload.message.as_deref().and_then(copilot::task_line),
                    );
                }
                NotificationKind::IdlePrompt if session.status != AiStatus::Waiting => {
                    session.status = AiStatus::Waiting;
                    session.waiting = waiting(WaitingKind::Idle, None, None);
                }
                NotificationKind::PermissionPrompt
                | NotificationKind::IdlePrompt
                | NotificationKind::Other => {}
            }
        }
        HookEvent::Stop if !held => {
            session.status = AiStatus::Waiting;
            session.waiting = waiting(WaitingKind::Input, None, None);
        }
        HookEvent::SessionEnd => return Transition::Finished,
        HookEvent::Stop | HookEvent::Other => {}
    }
    Transition::Settled
}

/// Sort key for live sessions: decidable waits, other waits, running.
fn rank(session: &AiSession) -> u8 {
    match (&session.status, &session.waiting) {
        (AiStatus::Waiting, Some(waiting)) if waiting.decidable => 0,
        (AiStatus::Waiting, _) => 1,
        (AiStatus::Running, _) => 2,
        (AiStatus::Done, _) => 3,
    }
}

/// The last component of a working directory.
fn project_name(cwd: &Path) -> Option<String> {
    cwd.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
}

/// `file` relative to `cwd` when inside it (forward slashes), else as given.
fn relative_file(file: &str, cwd: Option<&Path>) -> String {
    let path = Path::new(file);
    cwd.and_then(|cwd| path.strip_prefix(cwd).ok())
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .filter(|rel| !rel.is_empty())
        .unwrap_or_else(|| file.to_owned())
}

/// A lower-case, dash-separated form of an agent name for ids.
fn slug(name: &str) -> String {
    let mut slug = String::new();
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    slug.trim_matches('-').to_owned()
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

/// The backend: runs the receiver, polls the Copilot logs and follows lock events.
#[derive(Debug, Clone)]
pub struct AiCodingModule(pub Arc<AiCodingService>);

impl ModuleBackend for AiCodingModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Strip, Surface::Panel, Surface::Widget]
    }

    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()> {
        let service = Arc::clone(&self.0);
        tauri::async_runtime::spawn(async move {
            loop {
                let settings = service.settings();
                if !settings.enabled {
                    service.receiver_bound(None);
                    service.receiver_wake.notified().await;
                    continue;
                }
                let token = match service.token() {
                    Ok(token) => token,
                    Err(error) => {
                        tracing::warn!(%error, "ai coding token unavailable; receiver off");
                        tokio::select! {
                            () = tokio::time::sleep(Duration::from_secs(60)) => {}
                            () = service.receiver_wake.notified() => {}
                        }
                        continue;
                    }
                };
                match receiver::bind(settings.port).await {
                    Ok((listener, port)) => {
                        tracing::info!(port, "ai coding hook receiver listening");
                        service.receiver_bound(Some(port));
                        let handler: Arc<dyn HookHandler> =
                            Arc::clone(&service) as Arc<dyn HookHandler>;
                        tokio::select! {
                            () = receiver::serve(listener, handler, Arc::from(token)) => {}
                            () = service.receiver_wake.notified() => {}
                        }
                        service.receiver_bound(None);
                    }
                    Err(error) => {
                        tracing::warn!(port = settings.port, %error, "ai coding hook receiver could not bind");
                        service.receiver_bound(None);
                        tokio::select! {
                            () = tokio::time::sleep(Duration::from_secs(30)) => {}
                            () = service.receiver_wake.notified() => {}
                        }
                    }
                }
            }
        });
        let service = Arc::clone(&self.0);
        tauri::async_runtime::spawn(async move {
            loop {
                let Some(period) = service.cadence() else {
                    service.wake.notified().await;
                    continue;
                };
                let poller = Arc::clone(&service);
                // Directory listings and log reads stay off the async threads.
                if let Err(error) =
                    tauri::async_runtime::spawn_blocking(move || poller.poll()).await
                {
                    tracing::warn!(%error, "ai coding poll task failed");
                }
                tokio::select! {
                    () = tokio::time::sleep(period) => {}
                    () = service.wake.notified() => {}
                }
            }
        });
        let service = Arc::clone(&self.0);
        let mut events = ctx.platform.subscribe();
        tauri::async_runtime::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(muna_platform::PlatformEvent::SessionLockChanged { locked }) => {
                        service.set_locked(locked);
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "ai coding events lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        Ok(())
    }
}
