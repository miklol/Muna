//! The branch a working directory is on, read from the repository's own files
//! (docs/modules/ai-coding.md, the *branch* chip). No `git` process is started: `HEAD` names
//! the branch, and a worktree's `.git` file names the directory that holds it.

use std::fs;
use std::path::Path;

/// How many parent directories are searched for a `.git` entry.
const MAX_DEPTH: usize = 24;
/// A detached `HEAD` shows this many hex digits of its commit.
const SHORT_SHA: usize = 7;

/// The branch checked out at `cwd` (or the nearest ancestor with a `.git`), a detached head's
/// short commit, or `None` when the directory is not inside a repository.
#[must_use]
pub fn branch_of(cwd: &Path) -> Option<String> {
    let mut dir = Some(cwd);
    for _ in 0..MAX_DEPTH {
        let here = dir?;
        let dot_git = here.join(".git");
        if dot_git.is_dir() {
            return read_head(&dot_git);
        }
        if dot_git.is_file() {
            let pointer = fs::read_to_string(&dot_git).ok()?;
            let target = pointer.strip_prefix("gitdir:")?.trim();
            let git_dir = here.join(target);
            return read_head(&git_dir);
        }
        dir = here.parent();
    }
    None
}

fn read_head(git_dir: &Path) -> Option<String> {
    let head = fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let head = head.trim();
    if let Some(reference) = head.strip_prefix("ref:") {
        let reference = reference.trim();
        let name = reference.strip_prefix("refs/heads/").unwrap_or(reference);
        return (!name.is_empty()).then(|| name.to_owned());
    }
    if head.len() >= SHORT_SHA && head.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(head[..SHORT_SHA].to_owned());
    }
    None
}
