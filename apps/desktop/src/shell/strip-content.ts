import {
  type DropActionKind,
  HUD_NOTICE_IDS,
  type HealthFlow,
  type Leading,
  type PomodoroPhase,
  type StripContent,
  type StripMessage,
  type Trailing,
} from '@muna/contracts';
import type { MessageKey, Translate } from '@muna/i18n';
import { formatCountdown, type StripSlotContent } from '@muna/ui/primitives';

import { glyphLabelKey, stripGlyph } from './strip-glyphs';

export type { Translate };

type PomodoroMessageKey = Extract<MessageKey, `strip.message.pomodoro${string}`>;

/** The wide text for a running pomodoro phase (docs/modules/pomodoro.md, "Strip"). */
export const pomodoroPhaseKey: Readonly<Record<PomodoroPhase, PomodoroMessageKey>> = {
  work: 'strip.message.pomodoroWork',
  shortBreak: 'strip.message.pomodoroShortBreak',
  longBreak: 'strip.message.pomodoroLongBreak',
};

/** The notice text when a pomodoro phase runs out. */
export const pomodoroFinishedKey: Readonly<Record<PomodoroPhase, PomodoroMessageKey>> = {
  work: 'strip.message.pomodoroWorkFinished',
  shortBreak: 'strip.message.pomodoroShortBreakFinished',
  longBreak: 'strip.message.pomodoroLongBreakFinished',
};

type HealthMessageKey = Extract<MessageKey, `strip.message.health${string}`>;

/** The wide text while a guided health flow runs (docs/modules/health.md, "Strip"). */
export const healthFlowKey: Readonly<Record<HealthFlow, HealthMessageKey>> = {
  move: 'strip.message.healthFlowMove',
  breathe: 'strip.message.healthFlowBreathe',
  stretch: 'strip.message.healthFlowStretch',
  eyeRest: 'strip.message.healthFlowEyeRest',
};

/** The notice text when a guided health flow ran its course. */
export const healthFlowFinishedKey: Readonly<Record<HealthFlow, HealthMessageKey>> = {
  move: 'strip.message.healthFlowMoveFinished',
  breathe: 'strip.message.healthFlowBreatheFinished',
  stretch: 'strip.message.healthFlowStretchFinished',
  eyeRest: 'strip.message.healthFlowEyeRestFinished',
};

/**
 * The drop-actions texts are one message per action, pluralised on the item count
 * (`strip.message.dropRunning.copy_one` / `_other` in the catalog; i18next resolves the plural
 * from the base key). The catalog nests them under the message kind.
 */
export const dropRunningKey = (action: DropActionKind) =>
  `strip.message.dropRunning.${action}` as const;
export const dropFinishedKey = (action: DropActionKind) =>
  `strip.message.dropFinished.${action}` as const;
export const dropFailedKey = (action: DropActionKind) =>
  `strip.message.dropFailed.${action}` as const;

/** What `StripView` needs, derived from one `StripContent` (docs/modules/live-activities.md). */
export interface StripPresentation {
  itemId: string | null;
  kind: StripContent['kind'];
  leading: StripSlotContent | null;
  trailing: StripSlotContent | null;
  /** Localised wide-form text, or `null` when the content is glyph-only. */
  text: string | null;
  /** Whether the strip should take its wide form right now. */
  wide: boolean;
  /** Spoken description for the live region. */
  description: string;
}

/** How the HUD's level track presents and what a drag on it does (docs/modules/hud.md). */
export interface HudPresentation {
  /** *Show level text*: the percentage beside the track. */
  readonly showLevelText: boolean;
  /** Live drag; the shell forwards it to the platform. Absent: the track is display-only. */
  readonly onLevelChange?: ((percent: number) => void) | undefined;
  /** Pointer or key released. */
  readonly onLevelChangeEnd?: ((percent: number) => void) | undefined;
}

export interface PresentOptions {
  readonly hud?: HudPresentation | undefined;
  readonly decision?: DecisionPresentation | undefined;
}

/**
 * How a `decision` slot answers (docs/modules/ai-coding.md): the shell forwards *Allow* /
 * *Deny* to the module's command with the slot's session. Absent: the pills show but do
 * nothing (Storybook, tests).
 */
export interface DecisionPresentation {
  readonly onDecide: (session: string, allow: boolean) => void;
  /** The session an answer is already on its way for: its pills stop taking presses. */
  readonly pending?: string | null | undefined;
}

/** What a `level` slot controls, read from the glyph beside it (the sun means brightness). */
export const levelLabelKey = (leading: Leading | null): 'hud.volume' | 'hud.brightness' =>
  leading?.kind === 'icon' && leading.glyph === 'sun' ? 'hud.brightness' : 'hud.volume';

/** `57%` in the window's locale (`57 %` in French, `٥٧٪` in Arabic). */
export const formatPercent = (percent: number, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
    percent / 100,
  );

/** `14:30` or `2:30 PM` in the window's locale: a due time or a start time. */
export const formatTime = (atMs: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(atMs));

/** `3` or `١٢` in the window's locale: a small whole number such as an unread count. */
export const formatCount = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);

/** `3 h 5 min`, `2 h` or `45 min`, from the catalog so every unit is translatable. */
export const formatMinutes = (minutes: number, t: Translate): string => {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return t('strip.duration.minutes', { count: rest });
  if (rest === 0) return t('strip.duration.hours', { count: hours });
  return t('strip.duration.hoursMinutes', { hours, minutes: rest });
};

/** The localised sentence for a message; `text` is already words. */
export const messageText = (message: StripMessage, t: Translate): string => {
  switch (message.kind) {
    case 'text':
      return message.value;
    case 'batteryLow':
      return t('strip.message.batteryLow');
    case 'bluetoothConnected':
      return t('strip.message.bluetoothConnected', { name: message.name });
    case 'bluetoothDisconnected':
      return t('strip.message.bluetoothDisconnected', { name: message.name });
    case 'deviceBatteryLow':
      return t('strip.message.deviceBatteryLow', { name: message.name });
    case 'timerFinished':
      return t('strip.message.timerFinished', { label: message.label });
    case 'nowPlaying':
      return message.artist === ''
        ? t('strip.message.nowPlayingNoArtist', { title: message.title })
        : t('strip.message.nowPlaying', { title: message.title, artist: message.artist });
    case 'pomodoro':
      return t(pomodoroPhaseKey[message.phase]);
    case 'pomodoroFinished':
      return t(pomodoroFinishedKey[message.phase]);
    case 'taskDue':
      // The title is the user's words; the strip shows it as written.
      return message.title;
    case 'eventStarting':
      // The title is the feed's words; an untitled event gets a name.
      return message.title === '' ? t('strip.message.eventUntitled') : message.title;
    case 'notification':
      // Sender and title are the toast's words; a toast without text shows its sender alone.
      return message.title === ''
        ? message.app
        : t('strip.message.notification', { app: message.app, title: message.title });
    case 'dropRunning':
      return t(dropRunningKey(message.action), { count: message.count });
    case 'dropFinished':
      return t(dropFinishedKey(message.action), { count: message.count });
    case 'dropFailed':
      return t(dropFailedKey(message.action));
    case 'reviewRequested':
      // The title is the pull request's words; the strip shows it as written.
      return t('strip.message.reviewRequested', { title: message.title });
    case 'checksFinished':
      return message.passed
        ? t('strip.message.checksPassed', { title: message.title })
        : t('strip.message.checksFailed', { title: message.title });
    case 'screenTimeLimit':
      // The app name is the process's words; the limit is the user's setting.
      return t('strip.message.screenTimeLimit', {
        app: message.app,
        limit: formatMinutes(message.minutes, t),
      });
    case 'agentWaiting':
      // Agent and tool are the agent's own names; the strip shows them as written.
      return message.tool === null
        ? t('strip.message.agentWaiting', { agent: message.agent })
        : t('strip.message.agentPermission', { agent: message.agent, tool: message.tool });
    case 'healthBreak':
      return t('strip.message.healthBreak', { duration: formatMinutes(message.minutes, t) });
    case 'healthFlow':
      return t(healthFlowKey[message.flow]);
    case 'healthFlowFinished':
      return t(healthFlowFinishedKey[message.flow]);
    case 'healthHearing':
      return t('strip.message.healthHearing', {
        percent: message.percent,
        duration: formatMinutes(message.minutes, t),
      });
  }
};

/** What `toSlot` needs beyond the slot itself. */
export interface SlotContext {
  readonly locale: string;
  /** `Date.now()` when the content arrived; anchors local countdowns. */
  readonly receivedAt: number;
  /** Accessible name for a `level` slot ("Volume"). */
  readonly levelLabel: string;
  readonly hud?: HudPresentation | undefined;
  /** The decision pair's labels and what pressing one does. */
  readonly decision?: DecisionSlotContext | undefined;
}

export interface DecisionSlotContext {
  /** Accessible name for the pair ("Allow or deny"). */
  readonly label: string;
  readonly allowLabel: string;
  readonly denyLabel: string;
  readonly presentation?: DecisionPresentation | undefined;
}

const noDecision = () => {
  // Outside the shell (Storybook, tests) the pills have nowhere to send the answer.
};

/** Maps a contract slot to the UI vocabulary. */
export const toSlot = (
  slot: Leading | Trailing | null,
  { locale, receivedAt, levelLabel, hud, decision }: SlotContext,
): StripSlotContent | null => {
  if (slot === null) return null;
  switch (slot.kind) {
    case 'icon':
      // The glyph is the icon's identity: a swap under the same item crossfades.
      return slot.tint === null
        ? { kind: 'icon', icon: stripGlyph(slot.glyph), id: slot.glyph }
        : { kind: 'icon', icon: stripGlyph(slot.glyph), id: slot.glyph, tint: slot.tint };
    case 'image':
      return slot.glow === null || slot.glow === undefined
        ? { kind: 'image', src: slot.src }
        : { kind: 'image', src: slot.src, tint: slot.glow };
    case 'text':
      return { kind: 'text', value: slot.value };
    case 'percent':
      return { kind: 'text', value: formatPercent(slot.value, locale) };
    case 'battery':
      return { kind: 'battery', percent: slot.percent, charging: slot.charging };
    case 'timer':
      return {
        kind: 'timer',
        remainingMs: slot.remainingMs,
        totalMs: slot.totalMs,
        running: slot.running,
        receivedAt,
      };
    case 'progress':
      return { kind: 'progress', percent: slot.percent };
    case 'waveform':
      return { kind: 'waveform', playing: slot.playing };
    case 'level':
      return {
        kind: 'level',
        percent: slot.percent,
        muted: slot.muted,
        label: levelLabel,
        valueText: hud?.showLevelText === true ? formatPercent(slot.percent, locale) : null,
        onChange: hud?.onLevelChange,
        onChangeEnd: hud?.onLevelChangeEnd,
      };
    case 'time':
      return { kind: 'text', value: formatTime(slot.atMs, locale) };
    case 'count':
      return { kind: 'text', value: formatCount(slot.value, locale) };
    case 'decision': {
      const { session } = slot;
      const onDecide = decision?.presentation?.onDecide;
      return {
        kind: 'decision',
        label: decision?.label ?? '',
        allowLabel: decision?.allowLabel ?? '',
        denyLabel: decision?.denyLabel ?? '',
        onAllow:
          onDecide === undefined
            ? noDecision
            : () => {
                onDecide(session, true);
              },
        onDeny:
          onDecide === undefined
            ? noDecision
            : () => {
                onDecide(session, false);
              },
        isDisabled: decision?.presentation?.pending === session,
      };
    }
  }
};

const describeSlot = (
  slot: Leading | Trailing | null,
  t: Translate,
  locale: string,
): string | null => {
  if (slot === null) return null;
  switch (slot.kind) {
    case 'icon':
      return t(glyphLabelKey[slot.glyph]);
    case 'image':
      return t('strip.describe.image');
    case 'text':
      return slot.value;
    case 'percent':
      return formatPercent(slot.value, locale);
    case 'battery':
      return t(slot.charging ? 'strip.describe.charging' : 'strip.describe.battery', {
        percent: formatPercent(slot.percent, locale),
      });
    case 'timer':
      return t(slot.running ? 'strip.describe.timer' : 'strip.describe.timerPaused', {
        remaining: formatCountdown(slot.remainingMs),
      });
    case 'progress':
      return t('strip.describe.progress', { percent: formatPercent(slot.percent, locale) });
    case 'waveform':
      return t(slot.playing ? 'strip.describe.waveform' : 'strip.describe.waveformPaused');
    case 'level':
      // The leading glyph already names the control (volume, brightness, muted).
      return formatPercent(slot.percent, locale);
    case 'time':
      return t('strip.describe.time', { time: formatTime(slot.atMs, locale) });
    case 'count':
      return t('strip.describe.unread', { count: slot.value });
    case 'decision':
      return t('strip.describe.decision');
  }
};

/**
 * One sentence for assistive technology. Messages that state a whole fact (low battery, a
 * Bluetooth device, a finished timer) stand alone; free text gains the trailing value beside it
 * ("Focus, 1:30 left"); glyph-only content reads its slots left to right. Never empty: idle says
 * the app is running.
 */
export const describe = (content: StripContent, t: Translate, locale: string): string => {
  if (content.kind === 'idle') return t('notch.placeholder');
  const item = content.kind === 'notice' ? content.notice : content.activity;
  if (item.wide !== null) {
    const message = messageText(item.wide, t);
    switch (item.wide.kind) {
      case 'batteryLow':
        return t('strip.describe.batteryLow', {
          percent: formatPercent(item.wide.percent, locale),
        });
      case 'bluetoothConnected':
        return item.wide.batteryPercent === null
          ? message
          : t('strip.describe.bluetoothBattery', {
              message,
              percent: formatPercent(item.wide.batteryPercent, locale),
            });
      case 'deviceBatteryLow':
        return t('strip.describe.deviceBatteryLow', {
          name: item.wide.name,
          percent: formatPercent(item.wide.percent, locale),
        });
      case 'text':
      case 'pomodoro': {
        const fact =
          item.trailing === null || item.trailing.kind === 'icon'
            ? null
            : describeSlot(item.trailing, t, locale);
        return fact === null ? message : `${message}, ${fact}`;
      }
      case 'bluetoothDisconnected':
      case 'timerFinished':
      case 'pomodoroFinished':
        return message;
      case 'taskDue': {
        // An activity carries the due time on the right; the notice fires at that time.
        const fact = item.trailing?.kind === 'time' ? describeSlot(item.trailing, t, locale) : null;
        return fact === null
          ? t('strip.describe.taskDue', { title: message })
          : t('strip.describe.taskDueAt', { title: message, fact });
      }
      case 'eventStarting': {
        // Both forms carry the start time on the right; a notice is the ten-minute mark.
        const fact = item.trailing?.kind === 'time' ? describeSlot(item.trailing, t, locale) : null;
        if (content.kind === 'notice') {
          return t('strip.describe.eventStartingSoon', { title: message });
        }
        return fact === null
          ? t('strip.describe.event', { title: message })
          : t('strip.describe.eventAt', { title: message, fact });
      }
      case 'nowPlaying': {
        // A play glyph on the right means the session is paused (docs/modules/media.md).
        const spoken =
          item.wide.artist === ''
            ? t('strip.describe.nowPlayingNoArtist', { title: item.wide.title })
            : t('strip.describe.nowPlaying', {
                title: item.wide.title,
                artist: item.wide.artist,
              });
        const paused = item.trailing?.kind === 'icon' && item.trailing.glyph === 'play';
        return paused ? t('strip.describe.nowPaused', { message: spoken }) : spoken;
      }
      case 'notification': {
        // A notice is an arrival; the activity is the unread glance, with the count beside it.
        const app = item.wide.app;
        const title =
          item.wide.title === '' ? t('strip.message.notificationUntitled') : item.wide.title;
        if (content.kind === 'notice') {
          return t('strip.describe.notificationArrived', { app, title });
        }
        return item.trailing?.kind === 'count'
          ? t('strip.describe.notificationUnread', { count: item.trailing.value, app, title })
          : t('strip.describe.notificationLatest', { app, title });
      }
      case 'dropRunning': {
        // A zip or unzip carries its progress on the right ("Zipping 3 items, 40% done").
        const fact =
          item.trailing?.kind === 'progress' ? describeSlot(item.trailing, t, locale) : null;
        return fact === null ? message : `${message}, ${fact}`;
      }
      case 'dropFinished':
      case 'dropFailed':
        return message;
      case 'reviewRequested':
        return t('strip.describe.reviewRequested', { title: item.wide.title });
      case 'checksFinished':
        return item.wide.passed
          ? t('strip.describe.checksPassed', { title: item.wide.title })
          : t('strip.describe.checksFailed', { title: item.wide.title });
      case 'screenTimeLimit':
        return t('strip.describe.screenTimeLimit', {
          app: item.wide.app,
          limit: formatMinutes(item.wide.minutes, t),
        });
      case 'agentWaiting': {
        // With the decision pair on the right the sentence says what the buttons do.
        const { agent, tool } = item.wide;
        if (tool === null) return t('strip.describe.agentWaiting', { agent });
        return item.trailing?.kind === 'decision'
          ? t('strip.describe.agentDecision', { agent, tool })
          : t('strip.describe.agentPermission', { agent, tool });
      }
      case 'healthBreak':
        return t('strip.describe.healthBreak', {
          duration: formatMinutes(item.wide.minutes, t),
        });
      case 'healthFlow': {
        // The countdown on the right says how long the flow has to go.
        const fact =
          item.trailing?.kind === 'timer' ? describeSlot(item.trailing, t, locale) : null;
        return fact === null ? message : t('strip.describe.healthFlow', { flow: message, fact });
      }
      case 'healthFlowFinished':
        return message;
      case 'healthHearing':
        return t('strip.describe.healthHearing', {
          percent: formatPercent(item.wide.percent, locale),
          duration: formatMinutes(item.wide.minutes, t),
        });
    }
  }
  // A battery glyph beside its own percentage is one fact, not two.
  const trailing =
    item.leading?.kind === 'battery' && item.trailing?.kind === 'percent' ? null : item.trailing;
  const parts = [item.leading, trailing]
    .map((slot) => describeSlot(slot, t, locale))
    .filter((part): part is string => part !== null && part !== '');
  return parts.length > 0 ? parts.join(', ') : t('notch.placeholder');
};

/** Whether the trailing slot asks for the wide form on its own (the decision pair needs room). */
const slotWantsWide = (trailing: Trailing | null): boolean => trailing?.kind === 'decision';

/**
 * Everything the strip renders for one piece of content. Notices always show their text;
 * an activity shows it only during the wide burst the scheduler signals with `wide` — unless
 * its trailing slot is the decision pair, which keeps the wide form while it shows.
 */
export const present = (
  content: StripContent,
  t: Translate,
  locale: string,
  receivedAt: number,
  options: PresentOptions = {},
): StripPresentation => {
  const decision: DecisionSlotContext = {
    label: t('strip.describe.decision'),
    allowLabel: t('strip.decision.allow'),
    denyLabel: t('strip.decision.deny'),
    presentation: options.decision,
  };
  switch (content.kind) {
    case 'idle':
      return {
        itemId: null,
        kind: 'idle',
        leading: null,
        trailing: null,
        text: null,
        wide: false,
        description: describe(content, t, locale),
      };
    case 'notice': {
      const { notice } = content;
      const text = notice.wide === null ? null : messageText(notice.wide, t);
      const context: SlotContext = {
        locale,
        receivedAt,
        levelLabel: t(levelLabelKey(notice.leading)),
        hud: options.hud,
        decision,
      };
      return {
        itemId: notice.id,
        kind: 'notice',
        leading: toSlot(notice.leading, context),
        trailing: toSlot(notice.trailing, context),
        text,
        wide: text !== null,
        description: describe(content, t, locale),
      };
    }
    case 'activity': {
      const { activity } = content;
      const text = activity.wide === null ? null : messageText(activity.wide, t);
      const context: SlotContext = {
        locale,
        receivedAt,
        levelLabel: t(levelLabelKey(activity.leading)),
        hud: options.hud,
        decision,
      };
      return {
        itemId: activity.id,
        kind: 'activity',
        leading: toSlot(activity.leading, context),
        trailing: toSlot(activity.trailing, context),
        text,
        wide: (content.wide || slotWantsWide(activity.trailing)) && text !== null,
        description: describe(content, t, locale),
      };
    }
  }
};

/** Whether this content wants the wide form (the shell morphs the surface to match). */
export const wantsWide = (content: StripContent): boolean => {
  switch (content.kind) {
    case 'idle':
      return false;
    case 'notice':
      return content.notice.wide !== null;
    case 'activity':
      return (
        (content.wide || slotWantsWide(content.activity.trailing)) && content.activity.wide !== null
      );
  }
};

/** The HUD notice showing right now, if any: what the wheel and a drag on the strip control. */
export const hudNoticeShowing = (content: StripContent): 'volume' | 'mic' | 'brightness' | null => {
  if (content.kind !== 'notice') return null;
  switch (content.notice.id) {
    case HUD_NOTICE_IDS.volume:
      return 'volume';
    case HUD_NOTICE_IDS.mic:
      return 'mic';
    case HUD_NOTICE_IDS.brightness:
      return 'brightness';
    default:
      return null;
  }
};
