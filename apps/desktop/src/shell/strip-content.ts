import type { Leading, StripContent, StripMessage, Trailing } from '@muna/contracts';
import { formatCountdown, type StripSlotContent } from '@muna/ui/primitives';
import type { useTranslation } from 'react-i18next';

import { glyphLabelKey, stripGlyph, waveformGlyph } from './strip-glyphs';

/** The typed `t` from `useTranslation()`; keys are checked against the English catalog. */
export type Translate = ReturnType<typeof useTranslation>['t'];

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

/** `57%` in the window's locale (`57 %` in French, `٥٧٪` in Arabic). */
export const formatPercent = (percent: number, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
    percent / 100,
  );

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
    case 'timerFinished':
      return t('strip.message.timerFinished', { label: message.label });
    case 'nowPlaying':
      return message.artist === ''
        ? t('strip.message.nowPlayingNoArtist', { title: message.title })
        : t('strip.message.nowPlaying', { title: message.title, artist: message.artist });
  }
};

/** Maps a contract slot to the UI vocabulary; `receivedAt` anchors local countdowns. */
export const toSlot = (
  slot: Leading | Trailing | null,
  locale: string,
  receivedAt: number,
): StripSlotContent | null => {
  if (slot === null) return null;
  switch (slot.kind) {
    case 'icon':
      return slot.tint === null
        ? { kind: 'icon', icon: stripGlyph(slot.glyph) }
        : { kind: 'icon', icon: stripGlyph(slot.glyph), tint: slot.tint };
    case 'image':
      return { kind: 'image', src: slot.src };
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
      return { kind: 'icon', icon: waveformGlyph() };
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
      case 'text': {
        const fact =
          item.trailing === null || item.trailing.kind === 'icon'
            ? null
            : describeSlot(item.trailing, t, locale);
        return fact === null ? message : `${message}, ${fact}`;
      }
      case 'bluetoothDisconnected':
      case 'timerFinished':
        return message;
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

/**
 * Everything the strip renders for one piece of content. Notices always show their text;
 * an activity shows it only during the wide burst the scheduler signals with `wide`.
 */
export const present = (
  content: StripContent,
  t: Translate,
  locale: string,
  receivedAt: number,
): StripPresentation => {
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
      return {
        itemId: notice.id,
        kind: 'notice',
        leading: toSlot(notice.leading, locale, receivedAt),
        trailing: toSlot(notice.trailing, locale, receivedAt),
        text,
        wide: text !== null,
        description: describe(content, t, locale),
      };
    }
    case 'activity': {
      const { activity } = content;
      const text = activity.wide === null ? null : messageText(activity.wide, t);
      return {
        itemId: activity.id,
        kind: 'activity',
        leading: toSlot(activity.leading, locale, receivedAt),
        trailing: toSlot(activity.trailing, locale, receivedAt),
        text,
        wide: content.wide && text !== null,
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
      return content.wide && content.activity.wide !== null;
  }
};
