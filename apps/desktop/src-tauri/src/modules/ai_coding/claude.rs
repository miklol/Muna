//! Claude Code (docs/modules/ai-coding.md, *Sources*): the CLI posts its hook events to the
//! module's loopback receiver, one JSON document per event, and reads a JSON answer. Every
//! payload names the session, its working directory and its transcript; a `PermissionRequest`
//! may be answered with a decision while the CLI waits, which is how the strip's *Allow* /
//! *Deny* reach it. Tokens and message counts come from the transcript (`message.usage` on the
//! assistant's lines), read incrementally with a [`Tail`].
//!
//! Hooks are configured in `%USERPROFILE%\.claude\settings.json`; [`install_hooks`] writes HTTP
//! hook entries for the events below and [`remove_hooks`] takes exactly those out again, leaving
//! the rest of the file as it was.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{Map, Value, json};

use super::copilot::task_line;
use super::jsonl::Tail;

/// The settings file relative to the user's profile.
pub const SETTINGS_FILE: &str = ".claude\\settings.json";
/// The receiver route the hooks post to.
pub const ROUTE: &str = "/hooks/claude";
/// The hook events installed, with the seconds Claude waits for each answer. The permission
/// request is held while the strip shows *Allow* / *Deny*; the rest are notifications.
pub const HOOK_EVENTS: [(&str, u32); 7] = [
    ("SessionStart", 5),
    ("UserPromptSubmit", 5),
    ("PreToolUse", 5),
    ("PermissionRequest", 30),
    ("Notification", 5),
    ("Stop", 5),
    ("SessionEnd", 5),
];

/// One hook post, with the fields the module reads; everything else is ignored.
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct HookPayload {
    pub hook_event_name: String,
    pub session_id: String,
    pub cwd: Option<String>,
    pub transcript_path: Option<String>,
    pub tool_name: Option<String>,
    pub tool_input: Option<Value>,
    pub notification_type: Option<String>,
    pub message: Option<String>,
    pub prompt: Option<String>,
    pub model: Option<String>,
    pub reason: Option<String>,
}

/// The hook events the module acts on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookEvent {
    SessionStart,
    UserPromptSubmit,
    PreToolUse,
    PostToolUse,
    PermissionRequest,
    Notification,
    Stop,
    SessionEnd,
    /// Any other event: the session is alive, nothing else is known.
    Other,
}

impl HookEvent {
    #[must_use]
    pub fn parse(name: &str) -> Self {
        match name {
            "SessionStart" => Self::SessionStart,
            "UserPromptSubmit" => Self::UserPromptSubmit,
            "PreToolUse" => Self::PreToolUse,
            "PostToolUse" => Self::PostToolUse,
            "PermissionRequest" => Self::PermissionRequest,
            "Notification" => Self::Notification,
            "Stop" => Self::Stop,
            "SessionEnd" => Self::SessionEnd,
            _ => Self::Other,
        }
    }
}

/// The kinds of `Notification` the module distinguishes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationKind {
    /// Claude is showing its own permission dialog (the hook was not answered in time, or
    /// the request hook is not installed).
    PermissionPrompt,
    /// Claude has been idle, waiting for a prompt.
    IdlePrompt,
    Other,
}

impl NotificationKind {
    #[must_use]
    pub fn parse(kind: Option<&str>) -> Self {
        match kind {
            Some("permission_prompt") => Self::PermissionPrompt,
            Some("idle_prompt") => Self::IdlePrompt,
            _ => Self::Other,
        }
    }
}

/// The file a tool call is about, when its input names one.
#[must_use]
pub fn tool_file(input: Option<&Value>) -> Option<String> {
    let input = input?.as_object()?;
    ["file_path", "path", "notebook_path"]
        .iter()
        .find_map(|key| input.get(*key).and_then(Value::as_str))
        .map(str::to_owned)
}

/// One line describing what the tool would do, for the permission notice: a shell command
/// or the file, trimmed to [`super::copilot::TASK_CHARS`] characters.
#[must_use]
pub fn tool_detail(input: Option<&Value>) -> Option<String> {
    let object = input?.as_object()?;
    object
        .get("command")
        .and_then(Value::as_str)
        .and_then(task_line)
        .or_else(|| tool_file(input))
}

/// The answer to a `PermissionRequest`: allow or deny, in the shape the CLI reads.
#[must_use]
pub fn permission_response(allow: bool) -> Value {
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": { "behavior": if allow { "allow" } else { "deny" } }
        }
    })
}

/// The answer that changes nothing: an empty object.
#[must_use]
pub fn empty_response() -> Value {
    Value::Object(Map::new())
}

/// Running totals from a transcript.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TranscriptStats {
    /// User prompts and assistant messages (tool results and progress lines excluded).
    pub messages: u32,
    /// Input, output and cache tokens of every assistant message, summed.
    pub tokens: u64,
    pub model: Option<String>,
    pub branch: Option<String>,
}

#[derive(Deserialize)]
struct TranscriptLine {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default, rename = "gitBranch")]
    git_branch: Option<String>,
    #[serde(default)]
    message: Option<TranscriptMessage>,
}

#[derive(Deserialize)]
struct TranscriptMessage {
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    content: Option<Value>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Deserialize, Default)]
struct Usage {
    #[serde(default, rename = "input_tokens")]
    input: u64,
    #[serde(default, rename = "output_tokens")]
    output: u64,
    #[serde(default, rename = "cache_creation_input_tokens")]
    cache_creation: u64,
    #[serde(default, rename = "cache_read_input_tokens")]
    cache_read: u64,
}

impl Usage {
    fn total(&self) -> u64 {
        self.input
            .saturating_add(self.output)
            .saturating_add(self.cache_creation)
            .saturating_add(self.cache_read)
    }
}

/// Folds one transcript line into `stats`.
pub fn apply_transcript_line(stats: &mut TranscriptStats, line: &str) {
    let Ok(entry) = serde_json::from_str::<TranscriptLine>(line) else {
        return;
    };
    if let Some(branch) = entry.git_branch.filter(|branch| !branch.is_empty()) {
        stats.branch = Some(branch);
    }
    match entry.kind.as_str() {
        "assistant" => {
            stats.messages = stats.messages.saturating_add(1);
            if let Some(message) = entry.message {
                if message.model.is_some() {
                    stats.model = message.model;
                }
                if let Some(usage) = message.usage {
                    stats.tokens = stats.tokens.saturating_add(usage.total());
                }
            }
        }
        "user" => {
            let is_tool_result = entry
                .message
                .as_ref()
                .and_then(|message| message.content.as_ref())
                .and_then(Value::as_array)
                .is_some_and(|parts| {
                    parts
                        .iter()
                        .any(|part| part.get("type").and_then(Value::as_str) == Some("tool_result"))
                });
            if !is_tool_result {
                stats.messages = stats.messages.saturating_add(1);
            }
        }
        _ => {}
    }
}

/// Opens a tail on a transcript (see [`Tail::open`] for the size rule).
#[must_use]
pub fn open_transcript(path: &Path) -> Tail {
    Tail::open(path.to_path_buf())
}

/// `%USERPROFILE%\.claude\settings.json`, or `None` without a profile directory.
#[must_use]
pub fn default_settings_path() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|home| home.join(SETTINGS_FILE))
}

/// Whether a hook of ours points at `url` — any hook whose URL ends in [`ROUTE`] on loopback,
/// so a port change still finds the old entry.
fn is_ours(hook: &Value) -> bool {
    hook.get("type").and_then(Value::as_str) == Some("http")
        && hook
            .get("url")
            .and_then(Value::as_str)
            .is_some_and(|url| url.starts_with("http://127.0.0.1:") && url.ends_with(ROUTE))
}

fn read_settings(path: &Path) -> io::Result<Map<String, Value>> {
    match fs::read_to_string(path) {
        Ok(text) if text.trim().is_empty() => Ok(Map::new()),
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(object)) => Ok(object),
            Ok(_) => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "settings.json is not a JSON object",
            )),
            Err(error) => Err(io::Error::new(io::ErrorKind::InvalidData, error)),
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Map::new()),
        Err(error) => Err(error),
    }
}

fn write_settings(path: &Path, settings: &Map<String, Value>) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut text = serde_json::to_string_pretty(&Value::Object(settings.clone()))
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    text.push('\n');
    let temp = path.with_extension("json.muna-tmp");
    fs::write(&temp, text)?;
    fs::rename(&temp, path)
}

/// `true` when every event in [`HOOK_EVENTS`] has one of our hooks pointing at `url`.
#[must_use]
pub fn hooks_installed(path: &Path, url: &str) -> bool {
    let Ok(settings) = read_settings(path) else {
        return false;
    };
    let Some(hooks) = settings.get("hooks").and_then(Value::as_object) else {
        return false;
    };
    HOOK_EVENTS.iter().all(|(event, _)| {
        hooks
            .get(*event)
            .and_then(Value::as_array)
            .is_some_and(|groups| {
                groups.iter().any(|group| {
                    group
                        .get("hooks")
                        .and_then(Value::as_array)
                        .is_some_and(|list| {
                            list.iter().any(|hook| {
                                is_ours(hook)
                                    && hook.get("url").and_then(Value::as_str) == Some(url)
                            })
                        })
                })
            })
    })
}

/// Writes (or rewrites) our hook entries for every event in [`HOOK_EVENTS`], posting to `url`
/// with `Authorization: Bearer <token>`. Other hooks and settings are kept.
pub fn install_hooks(path: &Path, url: &str, token: &str) -> io::Result<()> {
    let mut settings = read_settings(path)?;
    let mut hooks = match settings.remove("hooks") {
        Some(Value::Object(hooks)) => hooks,
        _ => Map::new(),
    };
    for (event, timeout) in HOOK_EVENTS {
        let mut groups = match hooks.remove(event) {
            Some(Value::Array(groups)) => groups,
            _ => Vec::new(),
        };
        strip_ours(&mut groups);
        groups.push(json!({
            "hooks": [{
                "type": "http",
                "url": url,
                "timeout": timeout,
                "headers": { "Authorization": format!("Bearer {token}") }
            }]
        }));
        hooks.insert(event.to_owned(), Value::Array(groups));
    }
    settings.insert("hooks".to_owned(), Value::Object(hooks));
    write_settings(path, &settings)
}

/// Removes our hook entries wherever they are; events and the `hooks` key are dropped when
/// nothing else is left in them. A missing file is left missing.
pub fn remove_hooks(path: &Path) -> io::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let mut settings = read_settings(path)?;
    let Some(Value::Object(mut hooks)) = settings.remove("hooks") else {
        return Ok(());
    };
    let events: Vec<String> = hooks.keys().cloned().collect();
    for event in events {
        if let Some(Value::Array(mut groups)) = hooks.remove(&event) {
            strip_ours(&mut groups);
            if !groups.is_empty() {
                hooks.insert(event, Value::Array(groups));
            }
        }
    }
    if !hooks.is_empty() {
        settings.insert("hooks".to_owned(), Value::Object(hooks));
    }
    write_settings(path, &settings)
}

/// Drops our hooks from every group and the groups left empty by it.
fn strip_ours(groups: &mut Vec<Value>) {
    groups.retain_mut(|group| {
        let Some(list) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
            return true;
        };
        list.retain(|hook| !is_ours(hook));
        !list.is_empty()
    });
}
