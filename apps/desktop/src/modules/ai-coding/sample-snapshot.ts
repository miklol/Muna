import type { AiCodingSnapshot, AiSession } from '@muna/contracts';

/** A fixed "now" (local time, so clock strings read the same in every zone) for stories and tests. */
export const SAMPLE_NOW = new Date(2026, 2, 3, 14, 2, 0).getTime();

const MINUTE_MS = 60_000;

export const claudeWaiting: AiSession = {
  id: 'claude:1f3c-permission',
  agent: 'claude',
  project: 'muna',
  branch: 'm4-e5-ai-coding',
  model: 'claude-sonnet-4.5',
  status: 'waiting',
  waiting: {
    kind: 'permission',
    tool: 'Bash',
    detail: 'pnpm -w test',
    decidable: true,
    sinceMs: SAMPLE_NOW - 40_000,
  },
  task: 'Run the contracts tests and fix what fails',
  file: 'packages/contracts/src/schemas.test.ts',
  startedAtMs: SAMPLE_NOW - 23 * MINUTE_MS,
  updatedAtMs: SAMPLE_NOW - 40_000,
  messages: 28,
  tokens: 50_400,
  canFocus: true,
};

export const copilotRunning: AiSession = {
  id: 'copilot:be9e0462',
  agent: 'copilot',
  project: 'Muna',
  branch: 'main',
  model: 'claude-sonnet-4.5',
  status: 'running',
  waiting: null,
  task: 'Set up the desktop app scaffold with a fake platform layer',
  file: 'apps/desktop/src-tauri/src/lib.rs',
  startedAtMs: SAMPLE_NOW - 2 * 60 * MINUTE_MS - 5 * MINUTE_MS,
  updatedAtMs: SAMPLE_NOW - 3000,
  messages: 412,
  tokens: null,
  canFocus: true,
};

export const claudeIdle: AiSession = {
  id: 'claude:77a0-idle',
  agent: 'claude',
  project: 'site',
  branch: null,
  model: null,
  status: 'waiting',
  waiting: {
    kind: 'input',
    tool: null,
    detail: null,
    decidable: false,
    sinceMs: SAMPLE_NOW - 9 * MINUTE_MS,
  },
  task: null,
  file: null,
  startedAtMs: SAMPLE_NOW - 30 * MINUTE_MS,
  updatedAtMs: SAMPLE_NOW - 9 * MINUTE_MS,
  messages: null,
  tokens: 950,
  canFocus: false,
};

export const finished: AiSession = {
  id: 'copilot:0ab1done',
  agent: 'copilot',
  project: 'Muna',
  branch: 'm4-e8-screen-time',
  model: null,
  status: 'done',
  waiting: null,
  task: 'Add the screen time module',
  file: null,
  startedAtMs: SAMPLE_NOW - 3 * 60 * MINUTE_MS,
  updatedAtMs: SAMPLE_NOW - 50 * MINUTE_MS,
  messages: 96,
  tokens: null,
  canFocus: false,
};

const receiver: AiCodingSnapshot['receiver'] = {
  port: 47_391,
  listening: true,
  hookUrl: 'http://127.0.0.1:47391/hooks/claude',
  claudeHooksInstalled: true,
};

/** Two live agents, one of them holding a permission prompt, and one finished session. */
export const sampleSnapshot: AiCodingSnapshot = {
  enabled: true,
  sessions: [claudeWaiting, claudeIdle, copilotRunning],
  recent: [finished],
  receiver,
  generatedAtMs: SAMPLE_NOW,
};

/** The module is on, hooks are in, nothing runs. */
export const emptySnapshot: AiCodingSnapshot = {
  enabled: true,
  sessions: [],
  recent: [],
  receiver,
  generatedAtMs: SAMPLE_NOW,
};

/** Fresh install: the receiver listens but Claude Code does not post to it yet. */
export const hooksMissingSnapshot: AiCodingSnapshot = {
  ...emptySnapshot,
  receiver: { ...receiver, claudeHooksInstalled: false },
};

/** The module is off in Settings. */
export const offSnapshot: AiCodingSnapshot = {
  enabled: false,
  sessions: [],
  recent: [],
  receiver: { ...receiver, listening: false, claudeHooksInstalled: false },
  generatedAtMs: SAMPLE_NOW,
};
