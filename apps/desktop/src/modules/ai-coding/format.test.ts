import { describe, expect, it } from 'vitest';

import { i18n } from '../../lib/i18n';
import {
  fileName,
  formatElapsed,
  formatTokens,
  stateSince,
  statusTint,
  usageLine,
  waitingText,
} from './format';
import { claudeIdle, claudeWaiting, copilotRunning, SAMPLE_NOW } from './sample-snapshot';

const t = i18n.t.bind(i18n);

describe('ai coding format', () => {
  it('writes an elapsed time in whole units, seconds under a minute', () => {
    expect(formatElapsed(0, t)).toBe('0 s');
    expect(formatElapsed(40_000, t)).toBe('40 s');
    expect(formatElapsed(59_999, t)).toBe('59 s');
    expect(formatElapsed(60_000, t)).toBe('1 min');
    expect(formatElapsed(23 * 60_000 + 30_000, t)).toBe('23 min');
    expect(formatElapsed(2 * 3_600_000, t)).toBe('2 h');
    expect(formatElapsed(2 * 3_600_000 + 5 * 60_000, t)).toBe('2 h 5 min');
    expect(formatElapsed(-5000, t)).toBe('0 s');
  });

  it('compacts token counts the way the CLIs print them', () => {
    expect(formatTokens(950, 'en')).toBe('950');
    expect(formatTokens(1200, 'en')).toBe('1.2k');
    expect(formatTokens(50_400, 'en')).toBe('50.4k');
    expect(formatTokens(1_250_000, 'en')).toBe('1.3M');
  });

  it('joins the messages and the tokens the agent reports, and nothing when it reports neither', () => {
    expect(usageLine(claudeWaiting, t, 'en')).toBe('28 msgs · 50.4k tok');
    expect(usageLine(copilotRunning, t, 'en')).toBe('412 msgs');
    expect(usageLine(claudeIdle, t, 'en')).toBe('950 tok');
    expect(usageLine({ messages: 1, tokens: null }, t, 'en')).toBe('1 msg');
    expect(usageLine({ messages: null, tokens: null }, t, 'en')).toBeNull();
  });

  it('says why a session stopped', () => {
    expect(waitingText(claudeWaiting.waiting!, t)).toBe('Wants to run Bash');
    expect(waitingText({ ...claudeWaiting.waiting!, tool: null }, t)).toBe('Wants your permission');
    expect(waitingText(claudeIdle.waiting!, t)).toBe('Waiting for your prompt');
    expect(waitingText({ ...claudeIdle.waiting!, kind: 'idle' }, t)).toBe('Idle for a while');
  });

  it('measures a waiting session from when it stopped and a running one from its start', () => {
    expect(stateSince(claudeWaiting)).toBe(SAMPLE_NOW - 40_000);
    expect(stateSince(copilotRunning)).toBe(copilotRunning.startedAtMs);
  });

  it('tints the status dot green while working, orange while waiting, none once done', () => {
    expect(statusTint('running')).toBe('green');
    expect(statusTint('waiting')).toBe('orange');
    expect(statusTint('done')).toBeNull();
  });

  it('keeps the last segment of a path whichever way its slashes lean', () => {
    expect(fileName('packages/contracts/src/schemas.test.ts')).toBe('schemas.test.ts');
    expect(fileName('src-tauri\\src\\lib.rs')).toBe('lib.rs');
    expect(fileName('README.md')).toBe('README.md');
  });
});
