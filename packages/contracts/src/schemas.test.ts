import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { Settings, ShellLayout, StripContent } from './bindings';
import {
  STRIP_HEIGHT_PX,
  defaultSettings,
  monitorLayoutSchema,
  settingsSchema,
  shellLayoutSchema,
  shellSettingsSchema,
  stripContentSchema,
} from './schemas';

describe('settings schema', () => {
  it('accepts the default settings and round-trips them unchanged', () => {
    const settings = defaultSettings();
    expect(settingsSchema.parse(settings)).toEqual(settings);
  });

  it('rejects unknown schema versions (migrations run in Rust before parsing)', () => {
    expect(settingsSchema.safeParse({ ...defaultSettings(), version: 99 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...defaultSettings(), version: 1 }).success).toBe(false);
  });

  it('accepts nested JSON in module namespaces', () => {
    const settings: Settings = {
      ...defaultSettings(),
      modules: { media: { showArtwork: true, sources: ['spotify', null, 3] } },
    };
    expect(settingsSchema.parse(settings)).toEqual(settings);
  });

  it('accepts per-monitor shell layouts and rejects unknown presets', () => {
    const settings = defaultSettings();
    settings.shell.monitors['\\\\.\\DISPLAY2'] = {
      enabled: false,
      mode: 'reserved',
      shape: 'island',
      offsetX: -40,
      offsetY: 4,
      stripHeight: 'comfortable',
    };
    expect(settingsSchema.parse(settings)).toEqual(settings);
    expect(
      monitorLayoutSchema.safeParse({ ...settings.shell.defaults, stripHeight: 'huge' }).success,
    ).toBe(false);
    expect(shellSettingsSchema.safeParse({ ...settings.shell, toggleHotkey: '' }).success).toBe(
      false,
    );
  });

  it('matches the specta-generated type exactly', () => {
    expectTypeOf<z.infer<typeof settingsSchema>>().toEqualTypeOf<Settings>();
  });
});

describe('shell layout schema', () => {
  it('parses what the shell emits and matches the generated type', () => {
    const layout: ShellLayout = {
      label: 'notch',
      monitorId: '\\\\.\\DISPLAY1',
      isPrimary: true,
      enabled: true,
      mode: 'overlay',
      shape: 'notch',
      stripHeight: STRIP_HEIGHT_PX.default,
      stripTopOffset: 0,
      panelMaxWidth: 1000,
      scalePercent: 150,
      yieldState: 'none',
    };
    expect(shellLayoutSchema.parse(layout)).toEqual(layout);
    expectTypeOf<z.infer<typeof shellLayoutSchema>>().toEqualTypeOf<ShellLayout>();
  });
});

describe('strip content schema', () => {
  it('parses every variant', () => {
    const cases: StripContent[] = [
      { kind: 'idle' },
      {
        kind: 'activity',
        wide: true,
        activity: {
          id: 'a1',
          module: 'media',
          priority: 60,
          leading: { kind: 'image', src: 'https://example.invalid/art.png' },
          trailing: { kind: 'progress', percent: 42.5 },
          wide: { kind: 'text', value: 'Track — Artist' },
        },
      },
      {
        kind: 'activity',
        wide: false,
        activity: {
          id: 'pomodoro:timer',
          module: 'pomodoro',
          priority: 70,
          leading: { kind: 'icon', glyph: 'timer', tint: 'orange' },
          trailing: { kind: 'timer', remainingMs: 90_000, totalMs: 1_500_000, running: true },
          wide: null,
        },
      },
      {
        kind: 'activity',
        wide: true,
        activity: {
          id: 'media:now-playing',
          module: 'media',
          priority: 60,
          leading: { kind: 'icon', glyph: 'play', tint: null },
          trailing: { kind: 'waveform', playing: true },
          wide: { kind: 'nowPlaying', title: 'Track', artist: 'Artist' },
        },
      },
      {
        kind: 'notice',
        notice: {
          id: 'bluetooth:buds',
          module: 'live-activities',
          priority: 85,
          leading: { kind: 'icon', glyph: 'headphones', tint: 'blue' },
          trailing: { kind: 'battery', percent: 80, charging: false },
          wide: { kind: 'bluetoothConnected', name: 'Buds', batteryPercent: 80 },
          holdMs: 4000,
        },
      },
      {
        kind: 'notice',
        notice: {
          id: 'power:charging',
          module: 'live-activities',
          priority: 90,
          leading: { kind: 'battery', percent: 57, charging: true },
          trailing: { kind: 'percent', value: 57 },
          wide: null,
          holdMs: 0,
        },
      },
    ];
    for (const value of cases) {
      expect(stripContentSchema.parse(value)).toEqual(value);
    }
  });

  it('matches the specta-generated type exactly', () => {
    // `.branded` resolves the intersections specta emits for internally tagged enums.
    expectTypeOf<z.infer<typeof stripContentSchema>>().branded.toEqualTypeOf<StripContent>();
  });
});
