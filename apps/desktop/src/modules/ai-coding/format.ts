import type { AiAgent, AiSession, AiStatus, AiWaiting, WaitingKind } from '@muna/contracts';
import type { MessageKey, Translate } from '@muna/i18n';
import type { Tint } from '@muna/ui';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

/** The agent's name as the panel and the widget show it (`aiCoding.agent.*`). */
export const agentKey: Readonly<Record<AiAgent, MessageKey>> = {
  claude: 'aiCoding.agent.claude',
  copilot: 'aiCoding.agent.copilot',
  generic: 'aiCoding.agent.generic',
};

/** The status chip's word (`aiCoding.status.*`). */
export const statusKey: Readonly<Record<AiStatus, MessageKey>> = {
  running: 'aiCoding.status.running',
  waiting: 'aiCoding.status.waiting',
  done: 'aiCoding.status.done',
};

/**
 * The status dot's tint (docs/05-design-system.md#colour): green while the agent works, orange
 * when it stopped for the user, and none once it is done.
 */
export const statusTint = (status: AiStatus): Tint | null => {
  switch (status) {
    case 'running':
      return 'green';
    case 'waiting':
      return 'orange';
    case 'done':
      return null;
  }
};

const waitingKey: Readonly<Record<WaitingKind, MessageKey>> = {
  permission: 'aiCoding.waiting.permission',
  input: 'aiCoding.waiting.input',
  idle: 'aiCoding.waiting.idle',
};

/** Why a session stopped, as one line: "Wants to run Bash", "Waiting for your prompt". */
export const waitingText = (waiting: AiWaiting, t: Translate): string => {
  if (waiting.kind === 'permission') {
    return waiting.tool === null
      ? t('aiCoding.waiting.permissionNoTool')
      : t('aiCoding.waiting.permission', { tool: waiting.tool });
  }
  return t(waitingKey[waiting.kind]);
};

/**
 * `2 h 5 min`, `2 h`, `45 min` or `30 s`, every unit from the catalog. Whole minutes once a
 * minute has passed: the rows are not stopwatches.
 */
export const formatElapsed = (ms: number, t: Translate): string => {
  const clamped = Math.max(0, ms);
  if (clamped < MINUTE_MS) {
    return t('aiCoding.duration.seconds', { seconds: Math.floor(clamped / SECOND_MS) });
  }
  const minutes = Math.floor(clamped / MINUTE_MS);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t('aiCoding.duration.minutes', { minutes: rest });
  if (rest === 0) return t('aiCoding.duration.hours', { hours });
  return t('aiCoding.duration.hoursMinutes', { hours, minutes: rest });
};

/**
 * A token count the way the CLIs print it: `950`, `50.4k`, `1.2M` — one decimal under ten of
 * the unit, none above, in the locale's digits.
 */
export const formatTokens = (tokens: number, locale: string): string =>
  new Intl.NumberFormat(locale, {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: tokens >= 10_000 && tokens < 1_000_000 ? 1 : tokens >= 1000 ? 1 : 0,
  })
    .format(Math.max(0, tokens))
    .replace(/K$/u, 'k');

/** A moment as the locale writes the time of day ("14:02", "2:02 PM"). */
export const formatClock = (ms: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(ms));

/**
 * The row's meta line: `28 msgs · 50.4k tok`, either part left out when the agent does not
 * report it, `null` when neither is known.
 */
export const usageLine = (
  session: Pick<AiSession, 'messages' | 'tokens'>,
  t: Translate,
  locale: string,
): string | null => {
  const parts: string[] = [];
  if (session.messages !== null) {
    parts.push(t('aiCoding.row.messages', { count: session.messages }));
  }
  if (session.tokens !== null) {
    parts.push(t('aiCoding.row.tokens', { count: formatTokens(session.tokens, locale) }));
  }
  return parts.length === 0 ? null : parts.join(' · ');
};

/**
 * How long the row's state has lasted, against the snapshot's clock: a waiting session counts
 * from when it stopped, a running one from its start.
 */
export const stateSince = (session: AiSession): number =>
  session.status === 'waiting' && session.waiting !== null
    ? session.waiting.sinceMs
    : session.startedAtMs;

/** The last path segment of a file, for the row when the whole path would not fit. */
export const fileName = (file: string): string => {
  const cut = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return cut === -1 ? file : file.slice(cut + 1);
};

export { MINUTE_MS };
