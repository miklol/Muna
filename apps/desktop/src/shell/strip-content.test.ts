import {
  HUD_NOTICE_IDS,
  type StripContent,
  type StripMessage,
  type Trailing,
} from '@muna/contracts';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '../lib/i18n';
import {
  formatMinutes,
  formatPercent,
  hudNoticeShowing,
  levelLabelKey,
  messageText,
  present,
  type SlotContext,
  toSlot,
  wantsWide,
} from './strip-content';

const t = i18n.t.bind(i18n);
const ctx: SlotContext = { locale: 'en', receivedAt: 0, levelLabel: 'Volume' };

const activity = (wide: boolean): StripContent => ({
  kind: 'activity',
  wide,
  activity: {
    id: 'a1',
    module: 'media',
    priority: 60,
    leading: { kind: 'image', src: 'x.png' },
    trailing: { kind: 'progress', percent: 40 },
    wide: { kind: 'text', value: 'Track' },
  },
});

describe('strip content mapping', () => {
  it('formats percentages for the locale without decimals', () => {
    expect(formatPercent(57, 'en')).toBe('57%');
    expect(formatPercent(57.6, 'en')).toBe('58%');
    // German separates the sign with a (narrow) no-break space.
    expect(formatPercent(57, 'de')).toMatch(/^57\s%$/);
  });

  it('localises every message kind', () => {
    expect(messageText({ kind: 'text', value: 'Copied' }, t)).toBe('Copied');
    expect(messageText({ kind: 'batteryLow', percent: 10 }, t)).toBe('Low battery');
    expect(messageText({ kind: 'bluetoothConnected', name: 'Buds', batteryPercent: null }, t)).toBe(
      'Buds connected',
    );
    expect(messageText({ kind: 'bluetoothDisconnected', name: 'Buds' }, t)).toBe(
      'Buds disconnected',
    );
    expect(messageText({ kind: 'deviceBatteryLow', name: 'Buds', percent: 20 }, t)).toBe(
      'Buds battery low',
    );
    expect(messageText({ kind: 'timerFinished', label: 'Focus' }, t)).toBe('Focus finished');
    expect(messageText({ kind: 'nowPlaying', title: 'Song', artist: 'Artist' }, t)).toBe(
      'Song · Artist',
    );
    expect(messageText({ kind: 'nowPlaying', title: 'Song', artist: '' }, t)).toBe('Song');
    expect(messageText({ kind: 'pomodoro', phase: 'work' }, t)).toBe('Focus');
    expect(messageText({ kind: 'pomodoro', phase: 'shortBreak' }, t)).toBe('Short break');
    expect(messageText({ kind: 'pomodoro', phase: 'longBreak' }, t)).toBe('Long break');
    expect(messageText({ kind: 'pomodoroFinished', phase: 'work' }, t)).toBe('Focus finished');
    expect(messageText({ kind: 'pomodoroFinished', phase: 'longBreak' }, t)).toBe(
      'Long break finished',
    );
    expect(messageText({ kind: 'taskDue', title: 'Call Sam' }, t)).toBe('Call Sam');
    expect(messageText({ kind: 'eventStarting', title: 'Design sync' }, t)).toBe('Design sync');
    expect(messageText({ kind: 'eventStarting', title: '' }, t)).toBe('Untitled event');
    expect(messageText({ kind: 'notification', app: 'Teams', title: 'Standup moved' }, t)).toBe(
      'Teams · Standup moved',
    );
    expect(messageText({ kind: 'notification', app: 'Teams', title: '' }, t)).toBe('Teams');
    expect(messageText({ kind: 'reviewRequested', title: 'Snap zones' }, t)).toBe(
      'Review requested: Snap zones',
    );
    expect(messageText({ kind: 'checksFinished', title: 'Snap zones', passed: true }, t)).toBe(
      'Checks passed: Snap zones',
    );
    expect(messageText({ kind: 'checksFinished', title: 'Snap zones', passed: false }, t)).toBe(
      'Checks failed: Snap zones',
    );
    expect(messageText({ kind: 'screenTimeLimit', app: 'Steam', minutes: 90 }, t)).toBe(
      'Steam · 1 h 30 min limit reached',
    );
    expect(messageText({ kind: 'agentWaiting', agent: 'Claude Code', tool: 'Bash' }, t)).toBe(
      'Claude Code wants to run Bash',
    );
    expect(messageText({ kind: 'agentWaiting', agent: 'GitHub Copilot', tool: null }, t)).toBe(
      'GitHub Copilot is waiting for you',
    );
    expect(messageText({ kind: 'healthBreak', minutes: 50 }, t)).toBe(
      'Time for a break · sitting 50 min',
    );
    expect(messageText({ kind: 'healthFlow', flow: 'move' }, t)).toBe('Move');
    expect(messageText({ kind: 'healthFlow', flow: 'eyeRest' }, t)).toBe('Eye rest');
    expect(messageText({ kind: 'healthFlowFinished', flow: 'breathe' }, t)).toBe('Breathing done');
    expect(messageText({ kind: 'healthHearing', percent: 90, minutes: 10 }, t)).toBe(
      'Loud for 10 min · 90 %',
    );
  });

  it('describes the health reminder, a running flow with its countdown and the hearing warning', () => {
    const notice = (wide: StripMessage, glyph: 'heart' | 'volumeHigh') =>
      present(
        {
          kind: 'notice',
          notice: {
            id: 'health:break',
            module: 'health',
            priority: 44,
            leading: { kind: 'icon', glyph, tint: 'pink' },
            trailing: null,
            wide,
            holdMs: 8000,
          },
        },
        t,
        'en',
        0,
      );
    expect(notice({ kind: 'healthBreak', minutes: 75 }, 'heart')).toMatchObject({
      text: 'Time for a break · sitting 1 h 15 min',
      wide: true,
      description: 'Time for a break, you have been sitting 1 h 15 min',
    });
    expect(notice({ kind: 'healthHearing', percent: 90, minutes: 10 }, 'volumeHigh')).toMatchObject(
      {
        text: 'Loud for 10 min · 90 %',
        description: 'Loud on headphones for 10 min at 90%',
      },
    );
    expect(notice({ kind: 'healthFlowFinished', flow: 'stretch' }, 'heart')).toMatchObject({
      text: 'Stretch done',
      description: 'Stretch done',
    });
    const flow = present(
      {
        kind: 'activity',
        activity: {
          id: 'health:flow',
          module: 'health',
          priority: 64,
          leading: { kind: 'icon', glyph: 'timer', tint: 'green' },
          trailing: { kind: 'timer', remainingMs: 120_000, totalMs: 180_000, running: true },
          wide: { kind: 'healthFlow', flow: 'move' },
        },
        wide: true,
      },
      t,
      'en',
      0,
    );
    expect(flow).toMatchObject({ text: 'Move', description: 'Move, 2:00 left' });
  });

  it('keeps a waiting agent wide while the decision pair shows, and wires the pills to the session', () => {
    const onDecide = vi.fn();
    const waiting = (trailing: Trailing | null, wide: boolean): StripContent => ({
      kind: 'activity',
      wide,
      activity: {
        id: 'ai-coding:waiting:claude:s1',
        module: 'ai-coding',
        priority: 62,
        leading: { kind: 'icon', glyph: 'terminal', tint: 'orange' },
        trailing,
        wide: { kind: 'agentWaiting', agent: 'Claude Code', tool: 'Bash' },
      },
    });
    const decidable = waiting({ kind: 'decision', session: 'claude:s1' }, false);
    expect(wantsWide(decidable)).toBe(true);
    const shown = present(decidable, t, 'en', 0, { decision: { onDecide, pending: null } });
    expect(shown).toMatchObject({
      text: 'Claude Code wants to run Bash',
      wide: true,
      description: 'Claude Code wants to run Bash, allow or deny',
    });
    expect(shown.trailing).toMatchObject({
      kind: 'decision',
      label: 'Allow or deny',
      allowLabel: 'Allow',
      denyLabel: 'Deny',
      isDisabled: false,
    });
    if (shown.trailing?.kind !== 'decision') throw new Error('expected the decision pair');
    shown.trailing.onAllow();
    shown.trailing.onDeny();
    expect(onDecide.mock.calls).toEqual([
      ['claude:s1', true],
      ['claude:s1', false],
    ]);

    // An answer on its way: the pair dims until Rust retracts the activity.
    const pending = present(decidable, t, 'en', 0, {
      decision: { onDecide, pending: 'claude:s1' },
    });
    expect(pending.trailing).toMatchObject({ kind: 'decision', isDisabled: true });

    // Without the pair (the hold expired, or the agent is Copilot) the burst rule applies.
    const plain = waiting(null, false);
    expect(wantsWide(plain)).toBe(false);
    expect(present(plain, t, 'en', 0)).toMatchObject({
      wide: false,
      description: 'Claude Code wants to run Bash',
    });
    const pills = toSlot({ kind: 'decision', session: 'claude:s1' }, ctx);
    expect(pills).toMatchObject({ kind: 'decision', label: '', allowLabel: '', denyLabel: '' });
    if (pills?.kind !== 'decision') throw new Error('expected the decision pair');
    expect(() => {
      pills.onAllow();
    }).not.toThrow();
  });

  it('formats a minute count as hours and minutes', () => {
    expect(formatMinutes(45, t)).toBe('45 min');
    expect(formatMinutes(120, t)).toBe('2 h');
    expect(formatMinutes(125, t)).toBe('2 h 5 min');
    expect(formatMinutes(1, t)).toBe('1 min');
    expect(formatMinutes(0, t)).toBe('0 min');
  });

  it('describes a reached screen time limit as one sentence', () => {
    const shown = present(
      {
        kind: 'notice',
        notice: {
          id: 'screen-time:limit:steam.exe',
          module: 'screen-time',
          priority: 42,
          leading: { kind: 'icon', glyph: 'hourglass', tint: 'orange' },
          trailing: null,
          wide: { kind: 'screenTimeLimit', app: 'Steam', minutes: 60 },
          holdMs: 0,
        },
      },
      t,
      'en',
      0,
    );
    expect(shown).toMatchObject({
      text: 'Steam · 1 h limit reached',
      wide: true,
      description: 'Steam reached its daily limit of 1 h',
    });
  });

  it('describes a review request and finished checks as one sentence each', () => {
    const notice = (glyph: 'pullRequest' | 'checkCircle' | 'xCircle', wide: StripMessage) =>
      present(
        {
          kind: 'notice',
          notice: {
            id: 'code-hosting:review:PR_1',
            module: 'code-hosting',
            priority: 45,
            leading: { kind: 'icon', glyph, tint: 'purple' },
            trailing: null,
            wide,
            holdMs: 0,
          },
        },
        t,
        'en',
        0,
      );
    expect(notice('pullRequest', { kind: 'reviewRequested', title: 'Snap zones' })).toMatchObject({
      text: 'Review requested: Snap zones',
      wide: true,
      description: 'Your review is requested on Snap zones',
    });
    expect(
      notice('checkCircle', { kind: 'checksFinished', title: 'Snap zones', passed: true }),
    ).toMatchObject({ description: 'Checks passed on Snap zones' });
    expect(
      notice('xCircle', { kind: 'checksFinished', title: 'Snap zones', passed: false }),
    ).toMatchObject({ description: 'Checks failed on Snap zones' });
  });

  it('formats an unread count for the locale and describes the glance and the arrival', () => {
    expect(toSlot({ kind: 'count', value: 3 }, ctx)).toEqual({ kind: 'text', value: '3' });
    expect(toSlot({ kind: 'count', value: 12 }, { ...ctx, locale: 'ar-EG' })).toEqual({
      kind: 'text',
      value: '١٢',
    });
    const glance: StripContent = {
      kind: 'activity',
      wide: true,
      activity: {
        id: 'notifications:unread',
        module: 'notifications',
        priority: 40,
        leading: { kind: 'image', src: 'data:image/png;base64,AA==', glow: null },
        trailing: { kind: 'count', value: 3 },
        wide: { kind: 'notification', app: 'Teams', title: 'Standup moved' },
      },
    };
    expect(present(glance, t, 'en', 0)).toMatchObject({
      text: 'Teams · Standup moved',
      wide: true,
      trailing: { kind: 'text', value: '3' },
      description: '3 unread, latest from Teams: Standup moved',
    });
    expect(present({ ...glance, wide: false }, t, 'en', 0)).toMatchObject({ wide: false });
    expect(
      present(
        {
          kind: 'notice',
          notice: {
            id: 'notifications:arrived:7',
            module: 'notifications',
            priority: 40,
            leading: { kind: 'icon', glyph: 'bell', tint: null },
            trailing: null,
            wide: { kind: 'notification', app: 'Mail', title: '' },
            holdMs: 0,
          },
        },
        t,
        'en',
        0,
      ),
    ).toMatchObject({
      text: 'Mail',
      wide: true,
      description: 'New from Mail: Notification',
    });
  });

  it('formats a time slot as a short time for the locale', () => {
    // 14:30 local time on an arbitrary day; the slot carries an instant, not a string.
    const atMs = new Date(2026, 8, 26, 14, 30).getTime();
    const en = toSlot({ kind: 'time', atMs }, ctx);
    // ICU versions differ on the space before the day period.
    expect(en).toMatchObject({ kind: 'text', value: expect.stringMatching(/^2:30\sPM$/) });
    expect(toSlot({ kind: 'time', atMs }, { ...ctx, locale: 'de' })).toEqual({
      kind: 'text',
      value: '14:30',
    });
  });

  it('describes a due task with its time, and the notice at that time without it', () => {
    const atMs = new Date(2026, 8, 26, 14, 30).getTime();
    expect(
      present(
        {
          kind: 'activity',
          wide: true,
          activity: {
            id: 'todo:due',
            module: 'todo',
            priority: 55,
            leading: { kind: 'icon', glyph: 'checkCircle', tint: 'blue' },
            trailing: { kind: 'time', atMs },
            wide: { kind: 'taskDue', title: 'Call Sam' },
          },
        },
        t,
        'en',
        0,
      ),
    ).toMatchObject({
      text: 'Call Sam',
      wide: true,
      description: expect.stringMatching(/^Call Sam is due at 2:30\sPM$/),
    });
    expect(
      present(
        {
          kind: 'notice',
          notice: {
            id: 'todo:due:t1',
            module: 'todo',
            priority: 55,
            leading: { kind: 'icon', glyph: 'checkCircle', tint: 'blue' },
            trailing: null,
            wide: { kind: 'taskDue', title: 'Call Sam' },
            holdMs: 0,
          },
        },
        t,
        'en',
        0,
      ),
    ).toMatchObject({ text: 'Call Sam', wide: true, description: 'Call Sam is due' });
  });

  it('describes the next event with its start, and the ten-minute notice as starting soon', () => {
    const atMs = new Date(2026, 8, 26, 14, 30).getTime();
    expect(
      present(
        {
          kind: 'activity',
          wide: true,
          activity: {
            id: 'calendar:next',
            module: 'calendar',
            priority: 50,
            leading: { kind: 'icon', glyph: 'calendar', tint: 'purple' },
            trailing: { kind: 'time', atMs },
            wide: { kind: 'eventStarting', title: 'Design sync' },
          },
        },
        t,
        'en',
        0,
      ),
    ).toMatchObject({
      text: 'Design sync',
      wide: true,
      description: expect.stringMatching(/^Next, Design sync at 2:30\sPM$/),
    });
    expect(
      present(
        {
          kind: 'notice',
          notice: {
            id: 'calendar:starting:src:uid:1',
            module: 'calendar',
            priority: 65,
            leading: { kind: 'icon', glyph: 'calendar', tint: 'purple' },
            trailing: { kind: 'time', atMs },
            wide: { kind: 'eventStarting', title: '' },
            holdMs: 0,
          },
        },
        t,
        'en',
        0,
      ),
    ).toMatchObject({
      text: 'Untitled event',
      wide: true,
      description: 'Untitled event starts in ten minutes',
    });
  });

  it('maps contract slots to the UI vocabulary and anchors timers to their arrival', () => {
    expect(toSlot(null, ctx)).toBeNull();
    expect(toSlot({ kind: 'percent', value: 80 }, ctx)).toEqual({ kind: 'text', value: '80%' });
    expect(toSlot({ kind: 'battery', percent: 80, charging: true }, ctx)).toEqual({
      kind: 'battery',
      percent: 80,
      charging: true,
    });
    expect(
      toSlot(
        { kind: 'timer', remainingMs: 1000, totalMs: 2000, running: false },
        { ...ctx, receivedAt: 1234 },
      ),
    ).toEqual({
      kind: 'timer',
      remainingMs: 1000,
      totalMs: 2000,
      running: false,
      receivedAt: 1234,
    });
    const icon = toSlot({ kind: 'icon', glyph: 'lock', tint: null }, ctx);
    // The glyph names the icon so a swap under the same item crossfades in `StripView`.
    expect(icon).toMatchObject({ kind: 'icon', id: 'lock' });
    expect(icon).not.toHaveProperty('tint');
    expect(toSlot({ kind: 'icon', glyph: 'bluetooth', tint: 'blue' }, ctx)).toMatchObject({
      kind: 'icon',
      id: 'bluetooth',
      tint: 'blue',
    });
    expect(toSlot({ kind: 'waveform', playing: true }, ctx)).toEqual({
      kind: 'waveform',
      playing: true,
    });
    // The HUD level becomes a display-only track named for what it controls.
    expect(toSlot({ kind: 'level', percent: 42, muted: true }, ctx)).toEqual({
      kind: 'level',
      percent: 42,
      muted: true,
      label: 'Volume',
      valueText: null,
      onChange: undefined,
      onChangeEnd: undefined,
    });
    // Album art carries its palette colour as the halo tint; other images have none.
    expect(toSlot({ kind: 'image', src: 'a.png', glow: '#5ac8fa' }, ctx)).toEqual({
      kind: 'image',
      src: 'a.png',
      tint: '#5ac8fa',
    });
    expect(toSlot({ kind: 'image', src: 'a.png', glow: null }, ctx)).toEqual({
      kind: 'image',
      src: 'a.png',
    });
  });

  it('shows an activity wide only during the burst the scheduler signals', () => {
    expect(wantsWide({ kind: 'idle' })).toBe(false);
    expect(wantsWide(activity(false))).toBe(false);
    expect(wantsWide(activity(true))).toBe(true);
    expect(present(activity(false), t, 'en', 0)).toMatchObject({ text: 'Track', wide: false });
    expect(present(activity(true), t, 'en', 0)).toMatchObject({ text: 'Track', wide: true });
  });

  it('describes glyph-only content from its slots and message content from the message', () => {
    expect(present({ kind: 'idle' }, t, 'en', 0).description).toBe('Muna is running.');
    expect(
      present(
        {
          kind: 'notice',
          notice: {
            id: 'session:locked',
            module: 'live-activities',
            priority: 30,
            leading: { kind: 'icon', glyph: 'lock', tint: null },
            trailing: null,
            wide: null,
            holdMs: 0,
          },
        },
        t,
        'en',
        0,
      ),
    ).toMatchObject({ text: null, wide: false, description: 'Locked' });
    expect(present(activity(false), t, 'en', 0).description).toBe('Track, 40% done');
    expect(
      present(
        {
          kind: 'activity',
          wide: false,
          activity: {
            id: 'pomodoro:timer',
            module: 'pomodoro',
            priority: 70,
            leading: { kind: 'icon', glyph: 'timer', tint: 'orange' },
            trailing: { kind: 'timer', remainingMs: 65_000, totalMs: 90_000, running: false },
            wide: { kind: 'pomodoro', phase: 'work' },
          },
        },
        t,
        'en',
        0,
      ).description,
    ).toBe('Focus, 1:05 left, paused');
    expect(
      present(
        {
          kind: 'notice',
          notice: {
            id: 'pomodoro:finished',
            module: 'pomodoro',
            priority: 70,
            leading: { kind: 'icon', glyph: 'timer', tint: 'green' },
            trailing: null,
            wide: { kind: 'pomodoroFinished', phase: 'shortBreak' },
            holdMs: 0,
          },
        },
        t,
        'en',
        0,
      ),
    ).toMatchObject({
      text: 'Short break finished',
      wide: true,
      description: 'Short break finished',
    });
    expect(
      present(
        {
          kind: 'notice',
          notice: {
            id: 'bluetooth:buds',
            module: 'live-activities',
            priority: 85,
            leading: { kind: 'icon', glyph: 'headphones', tint: 'blue' },
            trailing: { kind: 'battery', percent: 80, charging: false },
            wide: { kind: 'bluetoothConnected', name: 'Buds', batteryPercent: 80 },
            holdMs: 0,
          },
        },
        t,
        'en',
        0,
      ).description,
    ).toBe('Buds connected, battery 80%');
    // A low device battery is one fact: the name, the word, the level.
    expect(
      present(
        {
          kind: 'notice',
          notice: {
            id: 'bluetooth:low:buds',
            module: 'bluetooth',
            priority: 85,
            leading: { kind: 'icon', glyph: 'headphones', tint: 'orange' },
            trailing: { kind: 'battery', percent: 20, charging: false },
            wide: { kind: 'deviceBatteryLow', name: 'Buds', percent: 20 },
            holdMs: 0,
          },
        },
        t,
        'en',
        0,
      ),
    ).toMatchObject({ text: 'Buds battery low', wide: true, description: 'Buds battery low, 20%' });
    // A HUD notice reads its glyph then the level; the glyph names the control.
    expect(
      present(
        {
          kind: 'notice',
          notice: {
            id: 'hud:volume',
            module: 'hud',
            priority: 100,
            leading: { kind: 'icon', glyph: 'volumeMuted', tint: null },
            trailing: { kind: 'level', percent: 42, muted: true },
            wide: null,
            holdMs: 1200,
          },
        },
        t,
        'en',
        0,
      ),
    ).toMatchObject({ text: null, wide: false, description: 'Muted, 42%' });
  });

  it('describes now playing with its playback state', () => {
    const nowPlaying = (trailing: Trailing): StripContent => ({
      kind: 'activity',
      wide: true,
      activity: {
        id: 'media:now-playing',
        module: 'media',
        priority: 60,
        leading: { kind: 'image', src: 'data:,' },
        trailing,
        wide: { kind: 'nowPlaying', title: 'Song', artist: 'Artist' },
      },
    });
    expect(present(nowPlaying({ kind: 'waveform', playing: true }), t, 'en', 0)).toMatchObject({
      text: 'Song · Artist',
      wide: true,
      description: 'Now playing Song by Artist',
    });
    expect(
      present(nowPlaying({ kind: 'icon', glyph: 'play', tint: null }), t, 'en', 0).description,
    ).toBe('Paused, Now playing Song by Artist');
    // Glyph-only (no wide text): the slots are read left to right.
    expect(
      present(
        {
          kind: 'activity',
          wide: false,
          activity: {
            id: 'media:now-playing',
            module: 'media',
            priority: 60,
            leading: { kind: 'icon', glyph: 'music', tint: null },
            trailing: { kind: 'waveform', playing: false },
            wide: null,
          },
        },
        t,
        'en',
        0,
      ).description,
    ).toBe('Music, Paused');
  });

  it('presents the HUD notice as a level track that follows the settings and the drag', () => {
    const hudNotice = (
      glyph: 'volumeMedium' | 'volumeMuted' | 'sun',
      id: string,
    ): StripContent => ({
      kind: 'notice',
      notice: {
        id,
        module: 'hud',
        priority: 80,
        leading: { kind: 'icon', glyph, tint: null },
        trailing: { kind: 'level', percent: 42, muted: glyph === 'volumeMuted' },
        wide: null,
        holdMs: 1500,
      },
    });
    const volume = hudNotice('volumeMedium', HUD_NOTICE_IDS.volume);
    const brightness = hudNotice('sun', HUD_NOTICE_IDS.brightness);

    expect(levelLabelKey({ kind: 'icon', glyph: 'volumeMedium', tint: null })).toBe('hud.volume');
    expect(levelLabelKey({ kind: 'icon', glyph: 'sun', tint: null })).toBe('hud.brightness');
    expect(levelLabelKey(null)).toBe('hud.volume');

    expect(hudNoticeShowing(volume)).toBe('volume');
    expect(hudNoticeShowing(brightness)).toBe('brightness');
    expect(hudNoticeShowing(hudNotice('volumeMedium', 'session:locked'))).toBeNull();
    expect(hudNoticeShowing({ kind: 'idle' })).toBeNull();

    // Display-only by default: no value text, no handlers, the label names what it controls.
    expect(present(volume, t, 'en', 0).trailing).toEqual({
      kind: 'level',
      percent: 42,
      muted: false,
      label: 'Volume',
      valueText: null,
      onChange: undefined,
      onChangeEnd: undefined,
    });
    expect(present(brightness, t, 'en', 0).trailing).toMatchObject({ label: 'Brightness' });
    expect(present(hudNotice('volumeMuted', HUD_NOTICE_IDS.volume), t, 'en', 0)).toMatchObject({
      trailing: { muted: true },
      description: 'Muted, 42%',
    });

    // Settings and the shell's handlers ride along.
    const onLevelChange = vi.fn();
    const onLevelChangeEnd = vi.fn();
    expect(
      present(volume, t, 'en', 0, { hud: { showLevelText: true, onLevelChange, onLevelChangeEnd } })
        .trailing,
    ).toMatchObject({ valueText: '42%', onChange: onLevelChange, onChangeEnd: onLevelChangeEnd });
  });
});
