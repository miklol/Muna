import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { Settings, ShellLayout, StripContent } from './bindings';
import {
  MEDIA_SETTINGS_KEY,
  STRIP_HEIGHT_PX,
  defaultMediaSettings,
  defaultSettings,
  monitorLayoutSchema,
  readMediaSettings,
  settingsSchema,
  shellLayoutSchema,
  shellSettingsSchema,
  stripContentSchema,
  writeMediaSettings,
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
          leading: { kind: 'image', src: 'https://example.invalid/art.png', glow: null },
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
          leading: { kind: 'image', src: 'data:image/png;base64,AA==', glow: '#3060c0' },
          trailing: { kind: 'waveform', playing: true },
          wide: { kind: 'nowPlaying', title: 'Track', artist: 'Artist' },
        },
      },
      {
        kind: 'activity',
        wide: false,
        activity: {
          id: 'media:now-playing',
          module: 'media',
          priority: 20,
          leading: { kind: 'icon', glyph: 'play', tint: null },
          trailing: null,
          wide: { kind: 'nowPlaying', title: 'Track', artist: '' },
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
      {
        kind: 'notice',
        notice: {
          id: 'hud:volume',
          module: 'hud',
          priority: 100,
          leading: { kind: 'icon', glyph: 'volumeHigh', tint: null },
          trailing: { kind: 'level', percent: 80, muted: false },
          wide: null,
          holdMs: 1200,
        },
      },
    ];
    for (const value of cases) {
      expect(stripContentSchema.parse(value)).toEqual(value);
    }
  });

  it('reads an image without a glow (older payloads) as glow null', () => {
    const parsed = stripContentSchema.parse({
      kind: 'notice',
      notice: {
        id: 'n1',
        module: 'media',
        priority: 60,
        leading: { kind: 'image', src: 'a.png' },
        trailing: null,
        wide: null,
        holdMs: 0,
      },
    });
    expect(parsed.kind === 'notice' && parsed.notice.leading).toEqual({
      kind: 'image',
      src: 'a.png',
      glow: null,
    });
  });

  it('matches the specta-generated type exactly', () => {
    // `.branded` resolves the intersections specta emits for internally tagged enums.
    expectTypeOf<z.infer<typeof stripContentSchema>>().branded.toEqualTypeOf<StripContent>();
  });
});

describe('media settings namespace', () => {
  it('reads the defaults when the namespace is missing', () => {
    expect(readMediaSettings(defaultSettings())).toEqual({
      preferredApp: null,
      adaptiveColours: true,
      visualiser: 'bars',
    });
    expect(defaultMediaSettings()).toEqual(readMediaSettings(defaultSettings()));
  });

  it('fills in missing keys and ignores unknown ones, like the Rust side', () => {
    const settings: Settings = {
      ...defaultSettings(),
      modules: { [MEDIA_SETTINGS_KEY]: { preferredApp: 'Spotify.exe', lyrics: true } },
    };
    expect(readMediaSettings(settings)).toEqual({
      preferredApp: 'Spotify.exe',
      adaptiveColours: true,
      visualiser: 'bars',
    });
  });

  it('falls back to the defaults for a malformed namespace', () => {
    const settings: Settings = {
      ...defaultSettings(),
      modules: { [MEDIA_SETTINGS_KEY]: { visualiser: 'spectrum' } },
    };
    expect(readMediaSettings(settings)).toEqual(defaultMediaSettings());
  });

  it('writes the namespace without touching the rest of the document', () => {
    const before: Settings = { ...defaultSettings(), modules: { other: { keep: 1 } } };
    const after = writeMediaSettings(before, {
      preferredApp: 'Edge.exe',
      adaptiveColours: false,
      visualiser: 'off',
    });
    expect(after.modules).toEqual({
      other: { keep: 1 },
      media: { preferredApp: 'Edge.exe', adaptiveColours: false, visualiser: 'off' },
    });
    expect(before.modules).toEqual({ other: { keep: 1 } });
    expect(settingsSchema.parse(after)).toEqual(after);
  });
});
