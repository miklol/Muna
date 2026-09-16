import type { StripContent } from '@muna/contracts';
import { describe, expect, it } from 'vitest';

import { i18n } from '../lib/i18n';
import { formatPercent, messageText, present, toSlot, wantsWide } from './strip-content';

const t = i18n.t.bind(i18n);

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
    expect(messageText({ kind: 'timerFinished', label: 'Focus' }, t)).toBe('Focus finished');
  });

  it('maps contract slots to the UI vocabulary and anchors timers to their arrival', () => {
    expect(toSlot(null, 'en', 0)).toBeNull();
    expect(toSlot({ kind: 'percent', value: 80 }, 'en', 0)).toEqual({ kind: 'text', value: '80%' });
    expect(toSlot({ kind: 'battery', percent: 80, charging: true }, 'en', 0)).toEqual({
      kind: 'battery',
      percent: 80,
      charging: true,
    });
    expect(
      toSlot({ kind: 'timer', remainingMs: 1000, totalMs: 2000, running: false }, 'en', 1234),
    ).toEqual({
      kind: 'timer',
      remainingMs: 1000,
      totalMs: 2000,
      running: false,
      receivedAt: 1234,
    });
    const icon = toSlot({ kind: 'icon', glyph: 'lock', tint: null }, 'en', 0);
    expect(icon).toMatchObject({ kind: 'icon' });
    expect(icon).not.toHaveProperty('tint');
    expect(toSlot({ kind: 'icon', glyph: 'bluetooth', tint: 'blue' }, 'en', 0)).toMatchObject({
      kind: 'icon',
      tint: 'blue',
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
            wide: { kind: 'text', value: 'Focus' },
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
  });
});
