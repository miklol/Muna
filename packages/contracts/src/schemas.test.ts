import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { Settings, ShellLayout, SourceSetting, StripContent } from './bindings';
import {
  CALENDAR_MAX_NAME_CHARS,
  CALENDAR_REFRESH_CHOICES_MINUTES,
  CALENDAR_SETTINGS_KEY,
  CALENDAR_STRIP_IDS,
  CALENDAR_STRIP_MS,
  DASHBOARD_GRID,
  DASHBOARD_SETTINGS_KEY,
  DAY_PROGRESS_BOUNDS,
  DAY_PROGRESS_GAP_MINUTES,
  DAY_PROGRESS_SETTINGS_KEY,
  DAY_PROGRESS_STRIP_IDS,
  DEFAULT_DASHBOARD_SLOTS,
  HUD_NOTICE_IDS,
  HUD_SETTINGS_KEY,
  HUD_VOLUME_STEP,
  MEDIA_SETTINGS_KEY,
  POMODORO_BOUNDS,
  POMODORO_SETTINGS_KEY,
  POMODORO_STRIP_IDS,
  STRIP_HEIGHT_PX,
  SYSTEM_MONITOR_BOUNDS,
  SYSTEM_MONITOR_PERIODS,
  SYSTEM_MONITOR_SETTINGS_KEY,
  SYSTEM_MONITOR_STRIP_IDS,
  TODO_BOUNDS,
  TODO_INBOX_LIST_ID,
  TODO_SETTINGS_KEY,
  TODO_STRIP_IDS,
  WEATHER_REFRESH_MS,
  WEATHER_SETTINGS_KEY,
  clampDashboardSlots,
  defaultCalendarSettings,
  defaultDashboardSettings,
  defaultDayProgressSettings,
  defaultHudSettings,
  defaultMediaSettings,
  defaultPomodoroSettings,
  defaultSettings,
  defaultSystemMonitorSettings,
  defaultTodoSettings,
  defaultWeatherSettings,
  monitorLayoutSchema,
  readCalendarSettings,
  readDashboardSettings,
  readDayProgressSettings,
  readHudSettings,
  readMediaSettings,
  readPomodoroSettings,
  readSystemMonitorSettings,
  readTodoSettings,
  readWeatherSettings,
  settingsSchema,
  shellLayoutSchema,
  shellSettingsSchema,
  stripContentSchema,
  writeCalendarSettings,
  writeDashboardSettings,
  writeDayProgressSettings,
  writeHudSettings,
  writeMediaSettings,
  writePomodoroSettings,
  writeSystemMonitorSettings,
  writeTodoSettings,
  writeWeatherSettings,
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
          wide: { kind: 'pomodoro', phase: 'work' },
        },
      },
      {
        kind: 'notice',
        notice: {
          id: 'pomodoro:finished',
          module: 'pomodoro',
          priority: 70,
          leading: { kind: 'icon', glyph: 'timer', tint: 'green' },
          trailing: null,
          wide: { kind: 'pomodoroFinished', phase: 'longBreak' },
          holdMs: 0,
        },
      },
      {
        kind: 'activity',
        wide: false,
        activity: {
          id: 'todo:due',
          module: 'todo',
          priority: 55,
          leading: { kind: 'icon', glyph: 'checkCircle', tint: 'blue' },
          trailing: { kind: 'time', atMs: 1_790_000_000_000 },
          wide: { kind: 'taskDue', title: 'Call Sam' },
        },
      },
      {
        kind: 'notice',
        notice: {
          id: 'calendar:starting:src:uid:1790000000000',
          module: 'calendar',
          priority: 65,
          leading: { kind: 'icon', glyph: 'calendar', tint: 'purple' },
          trailing: { kind: 'time', atMs: 1_790_000_000_000 },
          wide: { kind: 'eventStarting', title: 'Design sync' },
          holdMs: 0,
        },
      },
      {
        kind: 'activity',
        wide: false,
        activity: {
          id: 'system-monitor:cpu',
          module: 'system-monitor',
          priority: 10,
          leading: { kind: 'icon', glyph: 'cpu', tint: null },
          trailing: { kind: 'percent', value: 37 },
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

describe('hud settings namespace', () => {
  it('reads the defaults when the namespace is missing', () => {
    expect(readHudSettings(defaultSettings())).toEqual({
      replaceSystemFlyout: true,
      scrollOnStrip: 'panel',
      showLevelText: false,
    });
    expect(defaultHudSettings()).toEqual(readHudSettings(defaultSettings()));
  });

  it('fills in missing keys, ignores unknown ones and falls back when malformed', () => {
    const partial: Settings = {
      ...defaultSettings(),
      modules: { [HUD_SETTINGS_KEY]: { scrollOnStrip: 'volume', keyboardBacklight: true } },
    };
    expect(readHudSettings(partial)).toEqual({
      replaceSystemFlyout: true,
      scrollOnStrip: 'volume',
      showLevelText: false,
    });
    const malformed: Settings = {
      ...defaultSettings(),
      modules: { [HUD_SETTINGS_KEY]: { scrollOnStrip: 'brightness' } },
    };
    expect(readHudSettings(malformed)).toEqual(defaultHudSettings());
  });

  it('writes the namespace without touching the rest of the document', () => {
    const before: Settings = { ...defaultSettings(), modules: { media: { visualiser: 'off' } } };
    const after = writeHudSettings(before, {
      replaceSystemFlyout: false,
      scrollOnStrip: 'volume',
      showLevelText: true,
    });
    expect(after.modules).toEqual({
      media: { visualiser: 'off' },
      hud: { replaceSystemFlyout: false, scrollOnStrip: 'volume', showLevelText: true },
    });
    expect(settingsSchema.parse(after)).toEqual(after);
  });

  it('names the HUD notices and the wheel step the Rust module uses', () => {
    expect(HUD_NOTICE_IDS).toEqual({
      volume: 'hud:volume',
      mic: 'hud:mic',
      brightness: 'hud:brightness',
    });
    expect(HUD_VOLUME_STEP).toBe(2);
  });
});

describe('pomodoro settings namespace', () => {
  it('reads the defaults when the namespace is missing', () => {
    expect(readPomodoroSettings(defaultSettings())).toEqual({
      workMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      autoStartNext: false,
    });
    expect(defaultPomodoroSettings()).toEqual(readPomodoroSettings(defaultSettings()));
  });

  it('fills in missing keys, ignores unknown ones and clamps like the Rust side', () => {
    const partial: Settings = {
      ...defaultSettings(),
      modules: { [POMODORO_SETTINGS_KEY]: { workMinutes: 45, sound: 'chime' } },
    };
    expect(readPomodoroSettings(partial)).toEqual({
      ...defaultPomodoroSettings(),
      workMinutes: 45,
    });
    const outOfRange: Settings = {
      ...defaultSettings(),
      modules: {
        [POMODORO_SETTINGS_KEY]: {
          workMinutes: 500,
          shortBreakMinutes: 0,
          longBreakMinutes: 1000,
          longBreakEvery: 1,
          autoStartNext: true,
        },
      },
    };
    expect(readPomodoroSettings(outOfRange)).toEqual({
      workMinutes: POMODORO_BOUNDS.workMinutes.max,
      shortBreakMinutes: POMODORO_BOUNDS.shortBreakMinutes.min,
      longBreakMinutes: POMODORO_BOUNDS.longBreakMinutes.max,
      longBreakEvery: POMODORO_BOUNDS.longBreakEvery.min,
      autoStartNext: true,
    });
  });

  it('falls back to the defaults for a malformed namespace', () => {
    const malformed: Settings = {
      ...defaultSettings(),
      modules: { [POMODORO_SETTINGS_KEY]: { workMinutes: 'long', shortBreakMinutes: 10 } },
    };
    expect(readPomodoroSettings(malformed)).toEqual(defaultPomodoroSettings());
    const negative: Settings = {
      ...defaultSettings(),
      modules: { [POMODORO_SETTINGS_KEY]: { workMinutes: -5 } },
    };
    expect(readPomodoroSettings(negative)).toEqual(defaultPomodoroSettings());
    const notAnObject: Settings = {
      ...defaultSettings(),
      modules: { [POMODORO_SETTINGS_KEY]: 'nope' },
    };
    expect(readPomodoroSettings(notAnObject)).toEqual(defaultPomodoroSettings());
  });

  it('writes the namespace without touching the rest of the document', () => {
    const before: Settings = { ...defaultSettings(), modules: { hud: { showLevelText: true } } };
    const after = writePomodoroSettings(before, {
      workMinutes: 50,
      shortBreakMinutes: 10,
      longBreakMinutes: 30,
      longBreakEvery: 3,
      autoStartNext: true,
    });
    expect(after.modules).toEqual({
      hud: { showLevelText: true },
      pomodoro: {
        workMinutes: 50,
        shortBreakMinutes: 10,
        longBreakMinutes: 30,
        longBreakEvery: 3,
        autoStartNext: true,
      },
    });
    expect(before.modules).toEqual({ hud: { showLevelText: true } });
    expect(settingsSchema.parse(after)).toEqual(after);
  });

  it('names the strip ids the Rust module uses', () => {
    expect(POMODORO_STRIP_IDS).toEqual({
      activity: 'pomodoro:timer',
      finished: 'pomodoro:finished',
    });
  });
});

describe('todo settings namespace', () => {
  it('reads the defaults when the namespace is missing', () => {
    expect(readTodoSettings(defaultSettings())).toEqual({
      retentionDays: 30,
      dueNotices: true,
      showDueInStrip: true,
    });
    expect(defaultTodoSettings()).toEqual(readTodoSettings(defaultSettings()));
  });

  it('fills in missing keys, ignores unknown ones and clamps like the Rust side', () => {
    const partial: Settings = {
      ...defaultSettings(),
      modules: { [TODO_SETTINGS_KEY]: { dueNotices: false, sync: 'graph' } },
    };
    expect(readTodoSettings(partial)).toEqual({ ...defaultTodoSettings(), dueNotices: false });
    const outOfRange: Settings = {
      ...defaultSettings(),
      modules: { [TODO_SETTINGS_KEY]: { retentionDays: 0 } },
    };
    expect(readTodoSettings(outOfRange).retentionDays).toBe(TODO_BOUNDS.retentionDays.min);
    const tooLong: Settings = {
      ...defaultSettings(),
      modules: { [TODO_SETTINGS_KEY]: { retentionDays: 10_000 } },
    };
    expect(readTodoSettings(tooLong).retentionDays).toBe(TODO_BOUNDS.retentionDays.max);
  });

  it('falls back to the defaults for a malformed namespace', () => {
    const malformed: Settings = {
      ...defaultSettings(),
      modules: { [TODO_SETTINGS_KEY]: { retentionDays: 'forever', dueNotices: false } },
    };
    expect(readTodoSettings(malformed)).toEqual(defaultTodoSettings());
    const notAnObject: Settings = {
      ...defaultSettings(),
      modules: { [TODO_SETTINGS_KEY]: 7 },
    };
    expect(readTodoSettings(notAnObject)).toEqual(defaultTodoSettings());
  });

  it('writes the namespace without touching the rest of the document', () => {
    const before: Settings = { ...defaultSettings(), modules: { hud: { showLevelText: true } } };
    const after = writeTodoSettings(before, {
      retentionDays: 7,
      dueNotices: false,
      showDueInStrip: true,
    });
    expect(after.modules).toEqual({
      hud: { showLevelText: true },
      todo: { retentionDays: 7, dueNotices: false, showDueInStrip: true },
    });
    expect(before.modules).toEqual({ hud: { showLevelText: true } });
    expect(settingsSchema.parse(after)).toEqual(after);
  });

  it('names the strip ids and the default list the Rust module uses', () => {
    expect(TODO_STRIP_IDS).toEqual({ activity: 'todo:due', noticePrefix: 'todo:due:' });
    expect(TODO_INBOX_LIST_ID).toBe('inbox');
  });
});

describe('system monitor settings namespace', () => {
  it('reads the defaults when the namespace is missing', () => {
    expect(readSystemMonitorSettings(defaultSettings())).toEqual({
      showCpuInStrip: false,
      processCount: 5,
    });
    expect(defaultSystemMonitorSettings()).toEqual(readSystemMonitorSettings(defaultSettings()));
  });

  it('fills in missing keys, ignores unknown ones and clamps like the Rust side', () => {
    const partial: Settings = {
      ...defaultSettings(),
      modules: { [SYSTEM_MONITOR_SETTINGS_KEY]: { showCpuInStrip: true, gpu: 'nvml' } },
    };
    expect(readSystemMonitorSettings(partial)).toEqual({
      ...defaultSystemMonitorSettings(),
      showCpuInStrip: true,
    });
    const tooMany: Settings = {
      ...defaultSettings(),
      modules: { [SYSTEM_MONITOR_SETTINGS_KEY]: { processCount: 99 } },
    };
    expect(readSystemMonitorSettings(tooMany).processCount).toBe(
      SYSTEM_MONITOR_BOUNDS.processCount.max,
    );
    const none: Settings = {
      ...defaultSettings(),
      modules: { [SYSTEM_MONITOR_SETTINGS_KEY]: { processCount: 0 } },
    };
    expect(readSystemMonitorSettings(none).processCount).toBe(0);
  });

  it('falls back to the defaults for a malformed namespace', () => {
    const malformed: Settings = {
      ...defaultSettings(),
      modules: { [SYSTEM_MONITOR_SETTINGS_KEY]: { processCount: 'all', showCpuInStrip: true } },
    };
    expect(readSystemMonitorSettings(malformed)).toEqual(defaultSystemMonitorSettings());
    const notAnObject: Settings = {
      ...defaultSettings(),
      modules: { [SYSTEM_MONITOR_SETTINGS_KEY]: 'yes' },
    };
    expect(readSystemMonitorSettings(notAnObject)).toEqual(defaultSystemMonitorSettings());
  });

  it('writes the namespace without touching the rest of the document', () => {
    const before: Settings = { ...defaultSettings(), modules: { hud: { showLevelText: true } } };
    const after = writeSystemMonitorSettings(before, { showCpuInStrip: true, processCount: 3 });
    expect(after.modules).toEqual({
      hud: { showLevelText: true },
      'system-monitor': { showCpuInStrip: true, processCount: 3 },
    });
    expect(before.modules).toEqual({ hud: { showLevelText: true } });
    expect(settingsSchema.parse(after)).toEqual(after);
  });

  it('names the strip id and the cadence the Rust module uses', () => {
    expect(SYSTEM_MONITOR_STRIP_IDS).toEqual({ cpu: 'system-monitor:cpu' });
    expect(SYSTEM_MONITOR_PERIODS).toEqual({ visibleMs: 1000, stripMs: 10_000 });
  });
});

describe('weather settings namespace', () => {
  const berlin = {
    name: 'Berlin',
    region: 'Land Berlin',
    country: 'Germany',
    latitude: 52.52,
    longitude: 13.41,
  };

  it('is off, metric and automatic when the namespace is missing', () => {
    expect(readWeatherSettings(defaultSettings())).toEqual({
      enabled: false,
      units: 'metric',
      location: { kind: 'auto' },
    });
    expect(defaultWeatherSettings()).toEqual(readWeatherSettings(defaultSettings()));
  });

  it('fills in missing keys and ignores unknown ones', () => {
    const partial: Settings = {
      ...defaultSettings(),
      modules: { [WEATHER_SETTINGS_KEY]: { enabled: true, alerts: true } },
    };
    expect(readWeatherSettings(partial)).toEqual({ ...defaultWeatherSettings(), enabled: true });
    const manual: Settings = {
      ...defaultSettings(),
      modules: {
        [WEATHER_SETTINGS_KEY]: {
          enabled: true,
          units: 'imperial',
          location: { kind: 'manual', place: berlin },
        },
      },
    };
    expect(readWeatherSettings(manual)).toEqual({
      enabled: true,
      units: 'imperial',
      location: { kind: 'manual', place: berlin },
    });
  });

  it('falls back to the defaults for a malformed namespace', () => {
    const wrongUnits: Settings = {
      ...defaultSettings(),
      modules: { [WEATHER_SETTINGS_KEY]: { enabled: true, units: 'kelvin' } },
    };
    expect(readWeatherSettings(wrongUnits)).toEqual(defaultWeatherSettings());
    const offTheGlobe: Settings = {
      ...defaultSettings(),
      modules: {
        [WEATHER_SETTINGS_KEY]: {
          location: { kind: 'manual', place: { ...berlin, latitude: 91 } },
        },
      },
    };
    expect(readWeatherSettings(offTheGlobe)).toEqual(defaultWeatherSettings());
    const notAnObject: Settings = {
      ...defaultSettings(),
      modules: { [WEATHER_SETTINGS_KEY]: 'sunny' },
    };
    expect(readWeatherSettings(notAnObject)).toEqual(defaultWeatherSettings());
  });

  it('writes the namespace without touching the rest of the document', () => {
    const before: Settings = { ...defaultSettings(), modules: { hud: { showLevelText: true } } };
    const after = writeWeatherSettings(before, {
      enabled: true,
      units: 'metric',
      location: { kind: 'manual', place: berlin },
    });
    expect(after.modules).toEqual({
      hud: { showLevelText: true },
      weather: { enabled: true, units: 'metric', location: { kind: 'manual', place: berlin } },
    });
    expect(before.modules).toEqual({ hud: { showLevelText: true } });
    expect(settingsSchema.parse(after)).toEqual(after);
  });

  it('names the refresh period the Rust module uses', () => {
    expect(WEATHER_REFRESH_MS).toBe(900_000);
  });
});

describe('calendar settings namespace', () => {
  const work: SourceSetting = {
    id: 'a1b2',
    name: 'Work',
    color: 'purple',
    enabled: true,
    host: 'cal.example.test',
  };

  it('has no sources and the documented options when the namespace is missing', () => {
    expect(readCalendarSettings(defaultSettings())).toEqual({
      sources: [],
      refreshMinutes: 5,
      showNextInStrip: true,
      notices: true,
    });
    expect(defaultCalendarSettings()).toEqual(readCalendarSettings(defaultSettings()));
  });

  it('fills in missing keys and ignores unknown ones', () => {
    const partial: Settings = {
      ...defaultSettings(),
      modules: { [CALENDAR_SETTINGS_KEY]: { sources: [work], refreshMinutes: 30, sync: true } },
    };
    expect(readCalendarSettings(partial)).toEqual({
      ...defaultCalendarSettings(),
      sources: [work],
      refreshMinutes: 30,
    });
  });

  it('reads a refresh period that is not offered as the default, like the Rust side', () => {
    const odd: Settings = {
      ...defaultSettings(),
      modules: { [CALENDAR_SETTINGS_KEY]: { refreshMinutes: 7 } },
    };
    expect(readCalendarSettings(odd).refreshMinutes).toBe(5);
    expect([...CALENDAR_REFRESH_CHOICES_MINUTES]).toEqual([5, 15, 30, 60]);
  });

  it('falls back to the defaults for a malformed namespace', () => {
    const badSource: Settings = {
      ...defaultSettings(),
      modules: { [CALENDAR_SETTINGS_KEY]: { sources: [{ ...work, color: 'mauve' }] } },
    };
    expect(readCalendarSettings(badSource)).toEqual(defaultCalendarSettings());
    const blankId: Settings = {
      ...defaultSettings(),
      modules: { [CALENDAR_SETTINGS_KEY]: { sources: [{ ...work, id: '' }] } },
    };
    expect(readCalendarSettings(blankId)).toEqual(defaultCalendarSettings());
    const notAnObject: Settings = {
      ...defaultSettings(),
      modules: { [CALENDAR_SETTINGS_KEY]: ['work'] },
    };
    expect(readCalendarSettings(notAnObject)).toEqual(defaultCalendarSettings());
  });

  it('writes the namespace without touching the rest of the document', () => {
    const before: Settings = { ...defaultSettings(), modules: { hud: { showLevelText: true } } };
    const after = writeCalendarSettings(before, {
      sources: [work],
      refreshMinutes: 15,
      showNextInStrip: false,
      notices: true,
    });
    expect(after.modules).toEqual({
      hud: { showLevelText: true },
      calendar: {
        sources: [work],
        refreshMinutes: 15,
        showNextInStrip: false,
        notices: true,
      },
    });
    expect(before.modules).toEqual({ hud: { showLevelText: true } });
    expect(settingsSchema.parse(after)).toEqual(after);
  });

  it('names the strip timings, ids and limits the Rust module uses', () => {
    expect(CALENDAR_STRIP_MS).toEqual({ lead: 3_600_000, startingLead: 600_000, grace: 900_000 });
    expect(CALENDAR_STRIP_IDS).toEqual({
      next: 'calendar:next',
      startingPrefix: 'calendar:starting:',
    });
    expect(CALENDAR_MAX_NAME_CHARS).toBe(60);
  });
});

describe('day progress settings namespace', () => {
  it('is a nine-to-six day with the bar off when the namespace is missing', () => {
    expect(readDayProgressSettings(defaultSettings())).toEqual({
      workStartMinutes: 540,
      workEndMinutes: 1080,
      bedtimeMinutes: null,
      showDayInStrip: false,
      showTasks: true,
      showFocusSessions: true,
    });
    expect(defaultDayProgressSettings()).toEqual(readDayProgressSettings(defaultSettings()));
  });

  it('fills in missing keys, ignores unknown ones and clamps times into the day', () => {
    const partial: Settings = {
      ...defaultSettings(),
      modules: { [DAY_PROGRESS_SETTINGS_KEY]: { showDayInStrip: true, calendar: 'outlook' } },
    };
    expect(readDayProgressSettings(partial)).toEqual({
      ...defaultDayProgressSettings(),
      showDayInStrip: true,
    });
    const late: Settings = {
      ...defaultSettings(),
      modules: {
        [DAY_PROGRESS_SETTINGS_KEY]: {
          workStartMinutes: 600,
          workEndMinutes: 5000,
          bedtimeMinutes: 9000,
        },
      },
    };
    expect(readDayProgressSettings(late)).toMatchObject({
      workStartMinutes: 600,
      workEndMinutes: DAY_PROGRESS_BOUNDS.minuteOfDay.max,
      bedtimeMinutes: DAY_PROGRESS_BOUNDS.minuteOfDay.max,
    });
  });

  it('repairs a working day that ends before it starts the way the Rust side does', () => {
    const backwards: Settings = {
      ...defaultSettings(),
      modules: { [DAY_PROGRESS_SETTINGS_KEY]: { workStartMinutes: 600, workEndMinutes: 500 } },
    };
    expect(readDayProgressSettings(backwards)).toMatchObject({
      workStartMinutes: 600,
      workEndMinutes: 600 + DAY_PROGRESS_BOUNDS.minWorkingMinutes,
    });
    const unrepairable: Settings = {
      ...defaultSettings(),
      modules: { [DAY_PROGRESS_SETTINGS_KEY]: { workStartMinutes: 1439, workEndMinutes: 100 } },
    };
    expect(readDayProgressSettings(unrepairable)).toMatchObject({
      workStartMinutes: 540,
      workEndMinutes: 1080,
    });
  });

  it('falls back to the defaults for a malformed namespace', () => {
    const malformed: Settings = {
      ...defaultSettings(),
      modules: { [DAY_PROGRESS_SETTINGS_KEY]: { workStartMinutes: 'nine', showDayInStrip: true } },
    };
    expect(readDayProgressSettings(malformed)).toEqual(defaultDayProgressSettings());
    const notAnObject: Settings = {
      ...defaultSettings(),
      modules: { [DAY_PROGRESS_SETTINGS_KEY]: 'busy' },
    };
    expect(readDayProgressSettings(notAnObject)).toEqual(defaultDayProgressSettings());
  });

  it('writes the namespace without touching the rest of the document', () => {
    const before: Settings = { ...defaultSettings(), modules: { hud: { showLevelText: true } } };
    const day = { ...defaultDayProgressSettings(), bedtimeMinutes: 1380, showDayInStrip: true };
    const after = writeDayProgressSettings(before, day);
    expect(after.modules).toEqual({ hud: { showLevelText: true }, 'day-progress': day });
    expect(before.modules).toEqual({ hud: { showLevelText: true } });
    expect(settingsSchema.parse(after)).toEqual(after);
  });

  it('names the strip id, the step and the gap the module uses', () => {
    expect(DAY_PROGRESS_STRIP_IDS).toEqual({ bar: 'day-progress:bar' });
    expect(DAY_PROGRESS_BOUNDS.stepMinutes).toBe(15);
    expect(DAY_PROGRESS_GAP_MINUTES).toBe(90);
  });
});

describe('dashboard settings namespace', () => {
  it('is the default layout, filling the whole grid, when the namespace is missing', () => {
    const { slots } = readDashboardSettings(defaultSettings());
    expect(slots).toEqual(DEFAULT_DASHBOARD_SLOTS);
    expect(slots.reduce((sum, slot) => sum + slot.span, 0)).toBe(DASHBOARD_GRID.cells);
    expect(DASHBOARD_GRID.cells).toBe(DASHBOARD_GRID.columns * DASHBOARD_GRID.rows);
    expect(defaultDashboardSettings()).toEqual(readDashboardSettings(defaultSettings()));
  });

  it('keeps a custom layout, dropping repeats and whatever no longer fits the grid', () => {
    const custom: Settings = {
      ...defaultSettings(),
      modules: {
        [DASHBOARD_SETTINGS_KEY]: {
          slots: [
            { moduleId: 'todo', span: 2 },
            { moduleId: 'todo', span: 1 },
            { moduleId: 'weather', span: 2 },
            { moduleId: 'media', span: 2 },
            { moduleId: 'pomodoro', span: 2 },
            { moduleId: 'bluetooth', span: 1 },
          ],
          profile: 'work',
        },
      },
    };
    expect(readDashboardSettings(custom).slots).toEqual([
      { moduleId: 'todo', span: 2 },
      { moduleId: 'weather', span: 2 },
      { moduleId: 'media', span: 2 },
      { moduleId: 'pomodoro', span: 2 },
    ]);
    expect(clampDashboardSlots([])).toEqual([]);
    // A narrower slot after a full row still fits when a wider one did not.
    expect(
      clampDashboardSlots([
        { moduleId: 'a', span: 2 },
        { moduleId: 'b', span: 2 },
        { moduleId: 'c', span: 2 },
        { moduleId: 'd', span: 1 },
        { moduleId: 'e', span: 2 },
        { moduleId: 'f', span: 1 },
      ]).map((slot) => slot.moduleId),
    ).toEqual(['a', 'b', 'c', 'd', 'f']);
  });

  it('falls back to the defaults for a malformed entry and round-trips through write', () => {
    const broken: Settings = {
      ...defaultSettings(),
      modules: { [DASHBOARD_SETTINGS_KEY]: { slots: [{ moduleId: 'todo', span: 3 }] } },
    };
    expect(readDashboardSettings(broken)).toEqual(defaultDashboardSettings());
    const empty: Settings = {
      ...defaultSettings(),
      modules: { [DASHBOARD_SETTINGS_KEY]: { slots: [] } },
    };
    expect(readDashboardSettings(empty).slots).toEqual([]);
    const written = writeDashboardSettings(defaultSettings(), {
      slots: [{ moduleId: 'weather', span: 1 }],
    });
    expect(readDashboardSettings(written).slots).toEqual([{ moduleId: 'weather', span: 1 }]);
    expect(written.modules[DASHBOARD_SETTINGS_KEY]).toEqual({
      slots: [{ moduleId: 'weather', span: 1 }],
    });
  });
});
