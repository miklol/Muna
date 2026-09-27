import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type {
  AiCodingCommand,
  AiCodingSnapshot,
  AiSession,
  AppUsage,
  CodeHostingSnapshot,
  DayUsage,
  DragOutRequest,
  DragOutcome,
  DragSpike,
  DropActionsSnapshot,
  DropEntered,
  DropJob,
  HotkeyBinding,
  NoteContent,
  NoteDraft,
  NotesCommand,
  NotesSnapshot,
  ScreenTimeCommand,
  ScreenTimeSnapshot,
  Settings,
  ShelfCommand,
  ShelfItem,
  ShelfSnapshot,
  ShellLayout,
  SnapDragEnded,
  SnapDragLeft,
  SnapDragMoved,
  SnapZone,
  SnapZoneRef,
  SourceSetting,
  StripContent,
  SupportCommand,
  SupportOutcome,
  SupportSnapshot,
} from './bindings';
import {
  AI_AGENTS,
  AI_CODING_BOUNDS,
  AI_CODING_DEFAULT_PORT,
  AI_CODING_PORT_ATTEMPTS,
  AI_CODING_RECENT_FOR_MS,
  AI_CODING_RECENT_MAX,
  AI_CODING_SETTINGS_KEY,
  APP_CATEGORIES,
  CALENDAR_MAX_NAME_CHARS,
  CALENDAR_REFRESH_CHOICES_MINUTES,
  CALENDAR_SETTINGS_KEY,
  CALENDAR_STRIP_IDS,
  CALENDAR_STRIP_MS,
  CODE_HOSTING_FILTERS,
  CODE_HOSTING_MAX_TOKEN_CHARS,
  CODE_HOSTING_POLL_MS,
  CODE_HOSTING_SETTINGS_KEY,
  CODE_HOSTING_STRIP_IDS,
  CODE_HOSTING_TOKEN_KEY,
  DASHBOARD_GRID,
  DASHBOARD_SETTINGS_KEY,
  DAY_PROGRESS_BOUNDS,
  DAY_PROGRESS_GAP_MINUTES,
  DAY_PROGRESS_SETTINGS_KEY,
  DAY_PROGRESS_STRIP_IDS,
  DEFAULT_DASHBOARD_SLOTS,
  DEFAULT_DROP_TILES,
  DROP_ACTIONS_SETTINGS_KEY,
  DROP_MAX_FOLDERS,
  DROP_TILES_PER_ROW,
  DROP_TILES_PER_ROW_EXPANDED,
  HUD_NOTICE_IDS,
  HUD_SETTINGS_KEY,
  HUD_VOLUME_STEP,
  KEYBOARD_SHORTCUTS_SETTINGS_KEY,
  MEDIA_SETTINGS_KEY,
  NOTES_AUTOSAVE_MS,
  NOTES_INBOX_ID,
  NOTES_MAX_NOTE_BYTES,
  NOTES_SETTINGS_KEY,
  NOTIFICATIONS_POLL_MS,
  NOTIFICATIONS_SETTINGS_KEY,
  NOTIFICATIONS_STRIP_IDS,
  POMODORO_BOUNDS,
  POMODORO_SETTINGS_KEY,
  POMODORO_STRIP_IDS,
  SCREEN_TIME_BOUNDS,
  SCREEN_TIME_LIMIT_PRESETS,
  SCREEN_TIME_SETTINGS_KEY,
  SCREEN_TIME_TOP_APPS,
  SCREEN_TIME_WEEK_DAYS,
  SETTINGS_VERSION,
  SHELF_BOUNDS,
  SHELF_EXPIRY_CHOICES,
  SHELF_PREVIEW_CHARS,
  SHELF_SETTINGS_KEY,
  SHELL_ACTION_IDS,
  SHELL_OPEN_MODULE_SLOTS,
  SNAP_ZONES,
  SNOOZE_MINUTES_CHOICES,
  STRIP_HEIGHT_PX,
  SUPPORT_SETTINGS_KEY,
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
  WINDOW_SNAP_BOUNDS,
  WINDOW_SNAP_SETTINGS_KEY,
  aiCodingChangedSchema,
  aiCodingCommandSchema,
  aiCodingSettingsSchema,
  aiCodingSnapshotSchema,
  aiSessionSchema,
  appUsageSchema,
  categoryShares,
  clampDashboardSlots,
  codeHostingChangedSchema,
  codeHostingCommandSchema,
  codeHostingSettingsSchema,
  codeHostingSnapshotSchema,
  defaultAiCodingSettings,
  defaultCalendarSettings,
  defaultCodeHostingSettings,
  defaultDashboardSettings,
  defaultDayProgressSettings,
  defaultDropActionsSettings,
  defaultHudSettings,
  defaultKeyboardShortcutsSettings,
  defaultMediaSettings,
  defaultNotesSettings,
  defaultNotificationsSettings,
  defaultPomodoroSettings,
  defaultScreenTimeSettings,
  defaultSettings,
  defaultShelfSettings,
  defaultSupportSettings,
  defaultSystemMonitorSettings,
  defaultTodoSettings,
  defaultWeatherSettings,
  defaultWindowSnapSettings,
  dragOutRequestSchema,
  dragOutcomeSchema,
  dragSpikeSchema,
  dropActionSchema,
  dropActionsChangedSchema,
  dropActionsSnapshotSchema,
  dropEnteredSchema,
  dropFolderDisplayName,
  dropJobSchema,
  dropLeftSchema,
  dropMovedSchema,
  dropTilesPerRow,
  droppedSchema,
  filterPullRequests,
  formatBytes,
  hotkeyBindingSchema,
  isSnoozeMinutes,
  limitProgress,
  monitorLayoutSchema,
  normaliseChord,
  normaliseSnapGrid,
  noteContentSchema,
  noteDraftSchema,
  noteSchema,
  notesChangedSchema,
  notesCommandSchema,
  notesSettingsSchema,
  notesSnapshotSchema,
  pullRequestSchema,
  readAiCodingSettings,
  readCalendarSettings,
  readCodeHostingSettings,
  readDashboardSettings,
  readDayProgressSettings,
  readDropActionsSettings,
  readHudSettings,
  readKeyboardShortcutsSettings,
  readMediaSettings,
  readNotesSettings,
  readNotificationsSettings,
  readPomodoroSettings,
  readScreenTimeSettings,
  readShelfSettings,
  readSupportSettings,
  readSystemMonitorSettings,
  readTodoSettings,
  readWeatherSettings,
  readWindowSnapSettings,
  runningSessions,
  screenTimeChangedSchema,
  screenTimeCommandSchema,
  screenTimeSettingsSchema,
  screenTimeSnapshotSchema,
  settingsSchema,
  shelfChangedSchema,
  shelfCommandSchema,
  shelfItemSchema,
  shelfSnapshotSchema,
  shellLayoutSchema,
  shellOpenModuleActionId,
  shellSettingsSchema,
  snapDragEndedSchema,
  snapDragLeftSchema,
  snapDragMovedSchema,
  snapGridSchema,
  snapTileCount,
  snapZoneRefSchema,
  snapZoneSchema,
  stripContentSchema,
  supportChangedSchema,
  supportCommandSchema,
  supportLinkSchema,
  supportOutcomeSchema,
  supportSettingsSchema,
  supportSnapshotSchema,
  waitingSessions,
  weekScaleMs,
  widgetNote,
  windowSnapSettingsSchema,
  writeAiCodingSettings,
  writeCalendarSettings,
  writeCodeHostingSettings,
  writeDashboardSettings,
  writeDayProgressSettings,
  writeDropActionsSettings,
  writeHudSettings,
  writeKeyboardShortcutsSettings,
  writeMediaSettings,
  writeNotesSettings,
  writeNotificationsSettings,
  writePomodoroSettings,
  writeScreenTimeSettings,
  writeShelfSettings,
  writeSupportSettings,
  writeSystemMonitorSettings,
  writeTodoSettings,
  writeWeatherSettings,
  writeWindowSnapSettings,
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
    // The toggle hotkey moved to the keyboard-shortcuts namespace in version 5.
    expect(SETTINGS_VERSION).toBe(5);
    expect(
      shellSettingsSchema.safeParse({ ...settings.shell, toggleHotkey: 'ctrl+alt+space' }).data,
    ).not.toHaveProperty('toggleHotkey');
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
      {
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
      },
      {
        kind: 'notice',
        notice: {
          id: 'notifications:arrived:7',
          module: 'notifications',
          priority: 40,
          leading: { kind: 'icon', glyph: 'bell', tint: null },
          trailing: null,
          wide: { kind: 'notification', app: 'Mail', title: 'Invoice' },
          holdMs: 0,
        },
      },
      {
        kind: 'notice',
        notice: {
          id: 'code-hosting:review:PR_kwDOA1',
          module: 'code-hosting',
          priority: 45,
          leading: { kind: 'icon', glyph: 'pullRequest', tint: 'purple' },
          trailing: null,
          wide: { kind: 'reviewRequested', title: 'Snap zones for dragged windows' },
          holdMs: 0,
        },
      },
      {
        kind: 'notice',
        notice: {
          id: 'code-hosting:checks:PR_kwDOD4',
          module: 'code-hosting',
          priority: 45,
          leading: { kind: 'icon', glyph: 'xCircle', tint: 'red' },
          trailing: null,
          wide: { kind: 'checksFinished', title: 'Review queue', passed: false },
          holdMs: 0,
        },
      },
      {
        kind: 'notice',
        notice: {
          id: 'screen-time:limit:steam.exe',
          module: 'screen-time',
          priority: 42,
          leading: { kind: 'icon', glyph: 'hourglass', tint: 'orange' },
          trailing: null,
          wide: { kind: 'screenTimeLimit', app: 'Steam', minutes: 120 },
          holdMs: 0,
        },
      },
      {
        kind: 'activity',
        wide: true,
        activity: {
          id: 'ai-coding:waiting:claude:s1',
          module: 'ai-coding',
          priority: 62,
          leading: { kind: 'icon', glyph: 'terminal', tint: 'orange' },
          trailing: { kind: 'decision', session: 'claude:s1' },
          wide: { kind: 'agentWaiting', agent: 'Claude Code', tool: 'Bash' },
        },
      },
      {
        kind: 'notice',
        notice: {
          id: 'ai-coding:waiting:copilot:abc',
          module: 'ai-coding',
          priority: 62,
          leading: { kind: 'icon', glyph: 'terminal', tint: null },
          trailing: null,
          wide: { kind: 'agentWaiting', agent: 'GitHub Copilot', tool: null },
          holdMs: 0,
        },
      },
    ];
    for (const value of cases) {
      expect(stripContentSchema.parse(value)).toEqual(value);
    }
    expect(
      stripContentSchema.safeParse({
        kind: 'activity',
        wide: true,
        activity: {
          id: 'ai-coding:waiting:claude:s1',
          module: 'ai-coding',
          priority: 62,
          leading: null,
          trailing: { kind: 'decision', session: '' },
          wide: null,
        },
      }).success,
    ).toBe(false);
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

describe('notifications settings namespace', () => {
  it('announces, glances and mutes nobody when the namespace is missing', () => {
    expect(readNotificationsSettings(defaultSettings())).toEqual({
      arrivalNotices: true,
      showUnreadInStrip: true,
      mutedApps: [],
    });
    expect(defaultNotificationsSettings()).toEqual(readNotificationsSettings(defaultSettings()));
  });

  it('fills in missing keys and ignores unknown ones', () => {
    const partial: Settings = {
      ...defaultSettings(),
      modules: {
        [NOTIFICATIONS_SETTINGS_KEY]: { mutedApps: ['Microsoft.Teams'], reply: true },
      },
    };
    expect(readNotificationsSettings(partial)).toEqual({
      ...defaultNotificationsSettings(),
      mutedApps: ['Microsoft.Teams'],
    });
  });

  it('falls back to the defaults for a malformed namespace', () => {
    const wrongType: Settings = {
      ...defaultSettings(),
      modules: { [NOTIFICATIONS_SETTINGS_KEY]: { arrivalNotices: 'yes', mutedApps: [1] } },
    };
    expect(readNotificationsSettings(wrongType)).toEqual(defaultNotificationsSettings());
    const notAnObject: Settings = {
      ...defaultSettings(),
      modules: { [NOTIFICATIONS_SETTINGS_KEY]: 'quiet' },
    };
    expect(readNotificationsSettings(notAnObject)).toEqual(defaultNotificationsSettings());
  });

  it('writes the namespace without touching the rest of the document', () => {
    const before: Settings = { ...defaultSettings(), modules: { hud: { showLevelText: true } } };
    const after = writeNotificationsSettings(before, {
      arrivalNotices: false,
      showUnreadInStrip: true,
      mutedApps: ['Microsoft.Teams', 'microsoft.windowscommunicationsapps_8wekyb3d8bbwe!mail'],
    });
    expect(after.modules).toEqual({
      hud: { showLevelText: true },
      notifications: {
        arrivalNotices: false,
        showUnreadInStrip: true,
        mutedApps: ['Microsoft.Teams', 'microsoft.windowscommunicationsapps_8wekyb3d8bbwe!mail'],
      },
    });
    expect(before.modules).toEqual({ hud: { showLevelText: true } });
    expect(settingsSchema.parse(after)).toEqual(after);
  });

  it('names the strip ids and the poll period the Rust module uses', () => {
    expect(NOTIFICATIONS_STRIP_IDS).toEqual({
      unread: 'notifications:unread',
      arrivedPrefix: 'notifications:arrived:',
    });
    expect(NOTIFICATIONS_POLL_MS).toBe(1000);
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

describe('keyboard shortcuts settings namespace', () => {
  it('binds only the three shell shortcuts by default, matching the Rust defaults', () => {
    const shortcuts = readKeyboardShortcutsSettings(defaultSettings());
    expect(shortcuts).toEqual({
      bindings: {
        [SHELL_ACTION_IDS.togglePanel]: 'ctrl+alt+space',
        [SHELL_ACTION_IDS.palette]: 'ctrl+shift+space',
        [SHELL_ACTION_IDS.snooze]: 'ctrl+alt+n',
      },
      onlyWhileHovering: false,
      snoozeMinutes: 15,
    });
    expect(defaultKeyboardShortcutsSettings()).toEqual(shortcuts);
    expect(SNOOZE_MINUTES_CHOICES).toEqual([15, 30, 60]);
    expect(isSnoozeMinutes(30)).toBe(true);
    expect(isSnoozeMinutes(20)).toBe(false);
    expect(SHELL_OPEN_MODULE_SLOTS).toBe(9);
    expect(shellOpenModuleActionId(1)).toBe('shell.openModule1');
  });

  it('repairs a hand-edited namespace the way Rust does', () => {
    const edited: Settings = {
      ...defaultSettings(),
      modules: {
        [KEYBOARD_SHORTCUTS_SETTINGS_KEY]: {
          bindings: {
            [SHELL_ACTION_IDS.togglePanel]: ' Ctrl + Alt + Space ',
            'todo.quickAdd': 'ctrl+shift+t',
            [SHELL_ACTION_IDS.palette]: '',
            '  ': 'ctrl+x',
          },
          onlyWhileHovering: true,
          snoozeMinutes: 20,
          extra: 'ignored',
        },
      },
    };
    expect(readKeyboardShortcutsSettings(edited)).toEqual({
      bindings: {
        [SHELL_ACTION_IDS.togglePanel]: 'ctrl+alt+space',
        'todo.quickAdd': 'ctrl+shift+t',
      },
      onlyWhileHovering: true,
      snoozeMinutes: 15,
    });
    expect(normaliseChord('Ctrl + Alt + Space')).toBe('ctrl+alt+space');
    expect(normaliseChord('++')).toBe('');
  });

  it('falls back to the defaults for a malformed entry and round-trips through write', () => {
    const broken: Settings = {
      ...defaultSettings(),
      modules: { [KEYBOARD_SHORTCUTS_SETTINGS_KEY]: { bindings: ['ctrl+alt+space'] } },
    };
    expect(readKeyboardShortcutsSettings(broken)).toEqual(defaultKeyboardShortcutsSettings());
    const written = writeKeyboardShortcutsSettings(defaultSettings(), {
      bindings: {},
      onlyWhileHovering: true,
      snoozeMinutes: 60,
    });
    expect(readKeyboardShortcutsSettings(written)).toEqual({
      bindings: {},
      onlyWhileHovering: true,
      snoozeMinutes: 60,
    });
    expect(settingsSchema.parse(written)).toEqual(written);
  });

  it('parses what get_hotkeys returns and matches the generated type', () => {
    const bindings: HotkeyBinding[] = [
      { action: SHELL_ACTION_IDS.togglePanel, chord: 'ctrl+alt+space', state: 'registered' },
      { action: 'todo.quickAdd', chord: 'ctrl+shift+t', state: 'inUse' },
      { action: 'pomodoro.toggle', chord: 'bogus', state: 'invalid' },
      { action: 'media.playPause', chord: null, state: 'unbound' },
    ];
    for (const binding of bindings) {
      expect(hotkeyBindingSchema.parse(binding)).toEqual(binding);
    }
    expect(
      hotkeyBindingSchema.safeParse({ action: '', chord: null, state: 'registered' }).success,
    ).toBe(false);
    expect(
      hotkeyBindingSchema.safeParse({ action: 'x', chord: null, state: 'taken' }).success,
    ).toBe(false);
    expectTypeOf<z.infer<typeof hotkeyBindingSchema>>().toEqualTypeOf<HotkeyBinding>();
  });
});

describe('drop actions schemas', () => {
  it('defaults to every built-in tile, share first and the destructive ones last', () => {
    const settings = readDropActionsSettings(defaultSettings());
    expect(settings.tiles).toEqual(DEFAULT_DROP_TILES);
    expect(settings.tiles[0]).toEqual({ kind: 'nearbyShare' });
    expect(settings.tiles.slice(-2)).toEqual([{ kind: 'trash' }, { kind: 'eject' }]);
    expect(settings.folders).toEqual([]);
    expect(settings.expandNotch).toBe(false);
    expect(defaultDropActionsSettings()).toEqual(settings);
    expect(dropTilesPerRow(settings)).toBe(DROP_TILES_PER_ROW);
    expect(dropTilesPerRow({ expandNotch: true })).toBe(DROP_TILES_PER_ROW_EXPANDED);
  });

  it('repairs a hand-edited namespace the way Rust does', () => {
    const edited: Settings = {
      ...defaultSettings(),
      modules: {
        [DROP_ACTIONS_SETTINGS_KEY]: {
          tiles: [
            { kind: 'zip' },
            { kind: 'divider' },
            { kind: 'folder', id: 'gone' },
            { kind: 'zip' },
            { kind: 'divider' },
            { kind: 'folder', id: 'one' },
          ],
          folders: [
            { id: 'one', name: '', path: 'C:\\Users\\me\\OneDrive\\', mode: 'copy' },
            { id: 'one', name: 'Twin', path: 'C:\\twin', mode: 'move' },
            { id: ' ', name: 'No id', path: 'C:\\nowhere', mode: 'copy' },
            { id: 'three', name: 'Projects', path: 'D:/work/projects', mode: 'move' },
          ],
        },
      },
    };
    expect(readDropActionsSettings(edited)).toEqual({
      tiles: [
        { kind: 'zip' },
        { kind: 'divider' },
        { kind: 'divider' },
        { kind: 'folder', id: 'one' },
        { kind: 'folder', id: 'three' },
      ],
      folders: [
        { id: 'one', name: 'OneDrive', path: 'C:\\Users\\me\\OneDrive\\', mode: 'copy' },
        { id: 'three', name: 'Projects', path: 'D:/work/projects', mode: 'move' },
      ],
      expandNotch: false,
    });
  });

  it('caps the folders and gives each kept one a tile', () => {
    const folders = Array.from({ length: DROP_MAX_FOLDERS + 3 }, (_, index) => ({
      id: `f${String(index)}`,
      name: '',
      path: `C:\\f${String(index)}`,
      mode: 'copy' as const,
    }));
    const settings = readDropActionsSettings({
      ...defaultSettings(),
      modules: { [DROP_ACTIONS_SETTINGS_KEY]: { tiles: [], folders } },
    });
    expect(settings.folders).toHaveLength(DROP_MAX_FOLDERS);
    expect(settings.tiles).toHaveLength(DROP_MAX_FOLDERS);
    expect(settings.tiles.every((tile) => tile.kind === 'folder')).toBe(true);
  });

  it('falls back to the defaults for a malformed entry and round-trips through write', () => {
    const broken: Settings = {
      ...defaultSettings(),
      modules: { [DROP_ACTIONS_SETTINGS_KEY]: { tiles: 12 } },
    };
    expect(readDropActionsSettings(broken)).toEqual(defaultDropActionsSettings());
    const written = writeDropActionsSettings(defaultSettings(), {
      tiles: [{ kind: 'trash' }, { kind: 'folder', id: 'one' }],
      folders: [{ id: 'one', name: 'Drive', path: 'C:\\Users\\me\\Drive', mode: 'move' }],
      expandNotch: true,
    });
    expect(readDropActionsSettings(written)).toEqual({
      tiles: [{ kind: 'trash' }, { kind: 'folder', id: 'one' }],
      folders: [{ id: 'one', name: 'Drive', path: 'C:\\Users\\me\\Drive', mode: 'move' }],
      expandNotch: true,
    });
  });

  it('names a folder after its last path segment', () => {
    expect(dropFolderDisplayName('C:\\Users\\me\\OneDrive')).toBe('OneDrive');
    expect(dropFolderDisplayName('C:\\Users\\me\\OneDrive\\')).toBe('OneDrive');
    expect(dropFolderDisplayName('D:/work/projects')).toBe('projects');
    expect(dropFolderDisplayName('C:\\')).toBe('C:');
    expect(dropFolderDisplayName('\\\\')).toBe('\\\\');
  });

  it('parses jobs and snapshots and matches the generated types', () => {
    const jobs: DropJob[] = [
      { id: 1, action: 'zip', count: 3, state: { kind: 'running', percent: 42 } },
      { id: 2, action: 'trash', count: 1, state: { kind: 'running', percent: null } },
      { id: 3, action: 'copy', count: 2, state: { kind: 'done' } },
      { id: 4, action: 'unzip', count: 1, state: { kind: 'failed', reason: 'noArchive' } },
    ];
    for (const job of jobs) {
      expect(dropJobSchema.parse(job)).toEqual(job);
    }
    expect(dropJobSchema.safeParse({ ...jobs[0], action: 'burn' }).success).toBe(false);
    expect(
      dropJobSchema.safeParse({ ...jobs[0], state: { kind: 'running', percent: 101 } }).success,
    ).toBe(false);

    const snapshot: DropActionsSnapshot = { settings: {}, jobs };
    const parsed = dropActionsSnapshotSchema.parse(snapshot);
    expect(parsed.jobs).toEqual(jobs);
    expect(parsed.settings).toEqual(defaultDropActionsSettings());
    expect(dropActionsChangedSchema.parse({ snapshot }).snapshot).toEqual(parsed);
    expectTypeOf<z.infer<typeof dropJobSchema>>().branded.toEqualTypeOf<DropJob>();
  });

  it('parses the drag events the shell emits', () => {
    const entered: DropEntered = {
      label: 'notch',
      session: 1,
      items: [
        { name: 'report.pdf', extension: 'pdf', isDirectory: false },
        { name: 'Photos', extension: null, isDirectory: true },
      ],
      position: { x: 120, y: 14 },
    };
    expect(dropEnteredSchema.parse(entered)).toEqual(entered);
    expect(dropMovedSchema.parse({ label: 'notch', session: 1, position: { x: 1, y: 2 } })).toEqual(
      { label: 'notch', session: 1, position: { x: 1, y: 2 } },
    );
    expect(droppedSchema.parse({ label: 'notch', session: 1, position: { x: 1, y: 2 } })).toEqual({
      label: 'notch',
      session: 1,
      position: { x: 1, y: 2 },
    });
    expect(dropLeftSchema.parse({ label: 'notch', session: 1 })).toEqual({
      label: 'notch',
      session: 1,
    });
    expect(dropEnteredSchema.safeParse({ ...entered, session: 0 }).success).toBe(false);
    expectTypeOf<z.infer<typeof dropEnteredSchema>>().toEqualTypeOf<DropEntered>();
  });

  it('accepts every action a tile can ask for', () => {
    const actions = [
      { kind: 'share' },
      { kind: 'folder', id: 'one' },
      { kind: 'copyTo', title: 'Copy to' },
      { kind: 'moveTo', title: '' },
      { kind: 'openWith' },
      { kind: 'zip' },
      { kind: 'unzip' },
      { kind: 'reveal' },
      { kind: 'trash' },
      { kind: 'eject' },
      { kind: 'shelf' },
    ] as const;
    for (const action of actions) {
      expect(dropActionSchema.parse(action)).toEqual(action);
    }
    expect(dropActionSchema.safeParse({ kind: 'folder', id: '' }).success).toBe(false);
    expect(dropActionSchema.safeParse({ kind: 'divider' }).success).toBe(false);
  });

  it('renders drop jobs in the strip', () => {
    const content: StripContent = {
      kind: 'activity',
      wide: true,
      activity: {
        id: 'drop-actions:job-1',
        module: 'drop-actions',
        priority: 68,
        leading: { kind: 'icon', glyph: 'archive', tint: null },
        trailing: { kind: 'progress', percent: 42 },
        wide: { kind: 'dropRunning', action: 'zip', count: 3 },
      },
    };
    expect(stripContentSchema.parse(content)).toEqual(content);
    const failed: StripContent = {
      kind: 'notice',
      notice: {
        id: 'drop-actions:failed-2',
        module: 'drop-actions',
        priority: 68,
        leading: { kind: 'icon', glyph: 'drive', tint: 'red' },
        trailing: null,
        wide: { kind: 'dropFailed', action: 'eject' },
        holdMs: 0,
      },
    };
    expect(stripContentSchema.parse(failed)).toEqual(failed);
  });
});

describe('drag-out schemas', () => {
  it('round-trips every payload kind and refuses an empty drag', () => {
    const files: DragOutRequest = { kind: 'files', paths: ['C:\\Users\\me\\report.pdf'] };
    const text: DragOutRequest = { kind: 'text', text: 'a snippet' };
    const shelf: DragOutRequest = { kind: 'shelf', ids: ['a', 'b'] };
    expect(dragOutRequestSchema.parse(files)).toEqual(files);
    expect(dragOutRequestSchema.parse(text)).toEqual(text);
    expect(dragOutRequestSchema.parse(shelf)).toEqual(shelf);
    expect(dragOutRequestSchema.safeParse({ kind: 'files', paths: [] }).success).toBe(false);
    expect(dragOutRequestSchema.safeParse({ kind: 'text', text: '' }).success).toBe(false);
    expect(dragOutRequestSchema.safeParse({ kind: 'shelf', ids: [] }).success).toBe(false);
  });

  it('round-trips the outcome and the spike arming', () => {
    const dropped: DragOutcome = { kind: 'dropped', effect: 'copy' };
    const cancelled: DragOutcome = { kind: 'cancelled' };
    expect(dragOutcomeSchema.parse(dropped)).toEqual(dropped);
    expect(dragOutcomeSchema.parse(cancelled)).toEqual(cancelled);
    expect(dragOutcomeSchema.safeParse({ kind: 'dropped', effect: 'burn' }).success).toBe(false);
    const spike: DragSpike = { paths: ['C:\\tmp\\spike.png'] };
    expect(dragSpikeSchema.parse(spike)).toEqual(spike);
  });
});

describe('shelf schemas', () => {
  it('defaults to referencing files that never expire', () => {
    expect(defaultShelfSettings()).toEqual({ copyIntoStorage: false, expiryDays: 0 });
    expect(readShelfSettings(defaultSettings())).toEqual(defaultShelfSettings());
    expect(SHELF_SETTINGS_KEY).toBe('shelf');
    expect(SHELF_EXPIRY_CHOICES).toContain(0);
  });

  it('clamps the expiry and falls back on a malformed entry', () => {
    const doc = writeShelfSettings(defaultSettings(), {
      copyIntoStorage: true,
      expiryDays: 9_000,
    });
    expect(readShelfSettings(doc)).toEqual({
      copyIntoStorage: true,
      expiryDays: SHELF_BOUNDS.expiryDays.max,
    });
    const broken: Settings = {
      ...defaultSettings(),
      modules: { [SHELF_SETTINGS_KEY]: { copyIntoStorage: 'yes' } },
    };
    expect(readShelfSettings(broken)).toEqual(defaultShelfSettings());
  });

  it('round-trips the snapshot and its change event', () => {
    const snapshot: ShelfSnapshot = {
      items: [
        {
          id: 'one',
          kind: 'file',
          name: 'report.pdf',
          extension: 'pdf',
          size: 2_048,
          isFolder: false,
          copied: true,
          missing: false,
          preview: null,
          addedAtMs: 1_700_000_000_000,
        },
        {
          id: 'two',
          kind: 'text',
          name: 'https://example.com',
          extension: null,
          size: null,
          isFolder: false,
          copied: false,
          missing: false,
          preview: 'https://example.com',
          addedAtMs: 1_700_000_000_001,
        },
      ],
      settings: { copyIntoStorage: false, expiryDays: 7 },
    };
    expect(shelfSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(shelfChangedSchema.parse({ snapshot })).toEqual({ snapshot });
    expect(
      shelfItemSchema.safeParse({
        ...snapshot.items[1],
        preview: 'x'.repeat(SHELF_PREVIEW_CHARS + 1),
      }).success,
    ).toBe(false);
    expect(shelfItemSchema.safeParse({ ...snapshot.items[0], id: '' }).success).toBe(false);
    expectTypeOf<z.infer<typeof shelfItemSchema>>().toEqualTypeOf<ShelfItem>();
  });

  it('accepts every command and refuses empty ones', () => {
    const commands: ShelfCommand[] = [
      { kind: 'addText', text: 'a snippet' },
      { kind: 'remove', ids: ['one'] },
      { kind: 'removeMissing' },
      { kind: 'clear' },
      { kind: 'open', id: 'one' },
      { kind: 'reveal', ids: ['one', 'two'] },
      { kind: 'copy', ids: ['two'] },
    ];
    for (const command of commands) {
      expect(shelfCommandSchema.parse(command)).toEqual(command);
    }
    expect(shelfCommandSchema.safeParse({ kind: 'addText', text: '' }).success).toBe(false);
    expect(shelfCommandSchema.safeParse({ kind: 'remove', ids: [] }).success).toBe(false);
    expect(shelfCommandSchema.safeParse({ kind: 'open', id: '' }).success).toBe(false);
  });
});

describe('window snap schemas', () => {
  it('defaults to every built-in zone and no grid', () => {
    expect(defaultWindowSnapSettings()).toEqual({ zones: [...SNAP_ZONES], grid: null });
    expect(readWindowSnapSettings(defaultSettings())).toEqual(defaultWindowSnapSettings());
    expect(WINDOW_SNAP_SETTINGS_KEY).toBe('window-snap');
    expect(SNAP_ZONES).toHaveLength(WINDOW_SNAP_BOUNDS.zones.max);
    expect(snapTileCount(defaultWindowSnapSettings())).toBe(10);
  });

  it('normalises like the Rust side: repeats drop, a grid trims the built-ins, empty reads as defaults', () => {
    expect(windowSnapSettingsSchema.parse({ zones: ['leftHalf', 'leftHalf', 'maximize'] })).toEqual(
      { zones: ['leftHalf', 'maximize'], grid: null },
    );
    expect(windowSnapSettingsSchema.parse({ zones: [] })).toEqual(defaultWindowSnapSettings());
    const withGrid = windowSnapSettingsSchema.parse({ grid: { rows: 2, cols: 3, gap: 8 } });
    expect(withGrid.zones).toEqual(SNAP_ZONES.slice(0, 4));
    expect(withGrid.grid).toEqual({ rows: 2, cols: 3, gap: 8 });
    expect(snapTileCount(withGrid)).toBe(10);
    // A grid alone is a valid configuration: no built-ins is not "empty".
    expect(
      windowSnapSettingsSchema.parse({ zones: [], grid: { rows: 1, cols: 2, gap: 0 } }).zones,
    ).toEqual([]);
  });

  it('clamps the grid and loses columns before rows past ten cells', () => {
    expect(normaliseSnapGrid({ rows: 4, cols: 4, gap: 99 })).toEqual({ rows: 3, cols: 3, gap: 32 });
    expect(normaliseSnapGrid({ rows: 0, cols: 9, gap: -4 })).toEqual({ rows: 1, cols: 4, gap: 0 });
    expect(normaliseSnapGrid({ rows: 3, cols: 4, gap: 10 })).toEqual({ rows: 3, cols: 3, gap: 10 });
    expect(normaliseSnapGrid({ rows: 4, cols: 3, gap: 10 })).toEqual({ rows: 3, cols: 3, gap: 10 });
    expect(snapGridSchema.safeParse({ rows: 2.5, cols: 2, gap: 0 }).success).toBe(false);
  });

  it('round-trips through the settings document and falls back on a malformed entry', () => {
    const doc = writeWindowSnapSettings(defaultSettings(), {
      zones: ['rightHalf'],
      grid: { rows: 2, cols: 2, gap: 4 },
    });
    expect(readWindowSnapSettings(doc)).toEqual({
      zones: ['rightHalf'],
      grid: { rows: 2, cols: 2, gap: 4 },
    });
    const broken: Settings = {
      ...defaultSettings(),
      modules: { [WINDOW_SNAP_SETTINGS_KEY]: { zones: 'leftHalf' } },
    };
    expect(readWindowSnapSettings(broken)).toEqual(defaultWindowSnapSettings());
    const unknownZone: Settings = {
      ...defaultSettings(),
      modules: { [WINDOW_SNAP_SETTINGS_KEY]: { zones: ['leftHalf', 'diagonal'] } },
    };
    expect(readWindowSnapSettings(unknownZone)).toEqual(defaultWindowSnapSettings());
  });

  it('accepts zone refs in the shape the command takes and refuses cells past the grid bounds', () => {
    const refs: SnapZoneRef[] = [{ builtIn: 'leftHalf' }, { cell: { row: 1, col: 3 } }];
    for (const ref of refs) {
      expect(snapZoneRefSchema.parse(ref)).toEqual(ref);
    }
    expect(snapZoneRefSchema.safeParse({ builtIn: 'diagonal' }).success).toBe(false);
    expect(snapZoneRefSchema.safeParse({ cell: { row: 4, col: 0 } }).success).toBe(false);
    expect(snapZoneRefSchema.safeParse({ cell: { row: -1, col: 0 } }).success).toBe(false);
    expect(snapZoneSchema.safeParse('diagonal').success).toBe(false);
    expectTypeOf<z.infer<typeof snapZoneSchema>>().toEqualTypeOf<SnapZone>();
  });

  it('round-trips the drag events', () => {
    const moved: SnapDragMoved = { label: 'notch-0', session: 3, position: { x: 12, y: 4 } };
    const left: SnapDragLeft = { label: 'notch-0', session: 3 };
    const ended: SnapDragEnded = { session: 3, label: null };
    expect(snapDragMovedSchema.parse(moved)).toEqual(moved);
    expect(snapDragLeftSchema.parse(left)).toEqual(left);
    expect(snapDragEndedSchema.parse(ended)).toEqual(ended);
    expect(snapDragEndedSchema.parse({ ...ended, label: 'notch-1' }).label).toBe('notch-1');
    expect(snapDragMovedSchema.safeParse({ ...moved, label: '' }).success).toBe(false);
    expect(snapDragLeftSchema.safeParse({ ...left, session: -1 }).success).toBe(false);
    expectTypeOf<z.infer<typeof snapDragMovedSchema>>().toEqualTypeOf<SnapDragMoved>();
    expectTypeOf<z.infer<typeof snapDragEndedSchema>>().toEqualTypeOf<SnapDragEnded>();
  });
});

describe('code hosting schemas', () => {
  it('is off by default and announces both kinds of change once on', () => {
    expect(defaultCodeHostingSettings()).toEqual({
      enabled: false,
      notices: { reviewRequested: true, checksFinished: true },
    });
    expect(readCodeHostingSettings(defaultSettings())).toEqual(defaultCodeHostingSettings());
    expect(CODE_HOSTING_SETTINGS_KEY).toBe('code-hosting');
    expect(CODE_HOSTING_POLL_MS).toBe(120_000);
    expect(CODE_HOSTING_MAX_TOKEN_CHARS).toBe(255);
    expect(CODE_HOSTING_TOKEN_KEY).toBe('code-hosting.github.token');
    expect(CODE_HOSTING_STRIP_IDS.reviewPrefix).toBe('code-hosting:review:');
    expect(CODE_HOSTING_STRIP_IDS.checksPrefix).toBe('code-hosting:checks:');
    expect(CODE_HOSTING_FILTERS).toEqual(['toReview', 'mine', 'all']);
  });

  it('fills missing fields and falls back on a malformed entry', () => {
    expect(codeHostingSettingsSchema.parse({ enabled: true })).toEqual({
      enabled: true,
      notices: { reviewRequested: true, checksFinished: true },
    });
    expect(codeHostingSettingsSchema.parse({ notices: { checksFinished: false } })).toEqual({
      enabled: false,
      notices: { reviewRequested: true, checksFinished: false },
    });
    const doc = writeCodeHostingSettings(defaultSettings(), {
      enabled: true,
      notices: { reviewRequested: false, checksFinished: true },
    });
    expect(readCodeHostingSettings(doc)).toEqual({
      enabled: true,
      notices: { reviewRequested: false, checksFinished: true },
    });
    const broken: Settings = {
      ...defaultSettings(),
      modules: { [CODE_HOSTING_SETTINGS_KEY]: { enabled: 'yes' } },
    };
    expect(readCodeHostingSettings(broken)).toEqual(defaultCodeHostingSettings());
  });

  it('round-trips the snapshot and its change event', () => {
    const snapshot: CodeHostingSnapshot = {
      enabled: true,
      account: { provider: 'gitHub', login: 'octocat', avatarUrl: null },
      pullRequests: [
        {
          id: 'PR_kwDOA1',
          provider: 'gitHub',
          repo: 'miklol/Muna',
          number: 41,
          title: 'Snap zones for dragged windows',
          url: 'https://github.com/miklol/Muna/pull/41',
          author: 'hubot',
          authorAvatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
          draft: false,
          additions: 5041,
          deletions: 69,
          changedFiles: 65,
          checks: 'failure',
          reviewDecision: 'reviewRequired',
          updatedAtMs: 1_790_500_320_000,
          reviewRequested: true,
          mine: false,
        },
        {
          id: 'PR_kwDOD4',
          provider: 'gitHub',
          repo: 'miklol/Muna',
          number: 42,
          title: 'Review queue',
          url: 'https://github.com/miklol/Muna/pull/42',
          author: 'octocat',
          authorAvatarUrl: null,
          draft: true,
          additions: 0,
          deletions: 0,
          changedFiles: 0,
          checks: 'pending',
          reviewDecision: 'none',
          updatedAtMs: 1_790_503_530_000,
          reviewRequested: false,
          mine: true,
        },
      ],
      fetchedAtMs: 1_790_503_600_000,
      fetching: false,
      error: 'rateLimited',
    };
    expect(codeHostingSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(codeHostingChangedSchema.parse({ snapshot })).toEqual({ snapshot });
    const off: CodeHostingSnapshot = {
      enabled: false,
      account: null,
      pullRequests: [],
      fetchedAtMs: null,
      fetching: false,
      error: null,
    };
    expect(codeHostingSnapshotSchema.parse(off)).toEqual(off);
    expect(pullRequestSchema.safeParse({ ...snapshot.pullRequests[0], id: '' }).success).toBe(
      false,
    );
    expect(
      pullRequestSchema.safeParse({ ...snapshot.pullRequests[0], checks: 'queued' }).success,
    ).toBe(false);
    expect(codeHostingSnapshotSchema.safeParse({ ...off, error: 'timeout' }).success).toBe(false);
    expectTypeOf<z.infer<typeof codeHostingSnapshotSchema>>().toEqualTypeOf<CodeHostingSnapshot>();
  });

  it('accepts the refresh command only', () => {
    expect(codeHostingCommandSchema.parse({ kind: 'refresh' })).toEqual({ kind: 'refresh' });
    expect(codeHostingCommandSchema.safeParse({ kind: 'connect' }).success).toBe(false);
  });

  it('filters the queue without reordering it', () => {
    const rows = codeHostingSnapshotSchema.parse({
      enabled: true,
      account: null,
      pullRequests: [
        row('a', { reviewRequested: true, mine: false }),
        row('b', { reviewRequested: true, mine: true }),
        row('c', { reviewRequested: false, mine: true }),
      ],
      fetchedAtMs: null,
      fetching: false,
      error: null,
    }).pullRequests;
    expect(filterPullRequests(rows, 'toReview').map((pr) => pr.id)).toEqual(['a', 'b']);
    expect(filterPullRequests(rows, 'mine').map((pr) => pr.id)).toEqual(['b', 'c']);
    expect(filterPullRequests(rows, 'all').map((pr) => pr.id)).toEqual(['a', 'b', 'c']);
    expect(filterPullRequests(rows, 'all')).not.toBe(rows);
  });
});

describe('notes schemas', () => {
  const note = (id: string, pinned = false, modifiedMs = 1_790_600_000_000) => ({
    id,
    title: id.replace(/\.md$/, '').split('/').at(-1) ?? id,
    folder: id.includes('/') ? id.split('/').slice(0, -1).join('/') : '',
    excerpt: 'buy milk call Ann',
    modifiedMs,
    bytes: 26,
    pinned,
  });

  it('uses the default folder until one is chosen', () => {
    expect(defaultNotesSettings()).toEqual({ folder: null });
    expect(readNotesSettings(defaultSettings())).toEqual({ folder: null });
    expect(NOTES_SETTINGS_KEY).toBe('notes');
    expect(NOTES_INBOX_ID).toBe('Inbox.md');
    expect(NOTES_MAX_NOTE_BYTES).toBe(2_097_152);
    expect(NOTES_AUTOSAVE_MS).toBe(600);
  });

  it('trims the folder, treats blank as the default and falls back on a malformed entry', () => {
    expect(notesSettingsSchema.parse({ folder: '  D:\\Vault  ' })).toEqual({
      folder: 'D:\\Vault',
    });
    expect(notesSettingsSchema.parse({ folder: '   ' })).toEqual({ folder: null });
    expect(notesSettingsSchema.parse({})).toEqual({ folder: null });
    const doc = writeNotesSettings(defaultSettings(), { folder: 'D:\\Vault' });
    expect(readNotesSettings(doc)).toEqual({ folder: 'D:\\Vault' });
    expect(readNotesSettings(writeNotesSettings(doc, { folder: null }))).toEqual({
      folder: null,
    });
    const broken: Settings = {
      ...defaultSettings(),
      modules: { [NOTES_SETTINGS_KEY]: { folder: 42 } },
    };
    expect(readNotesSettings(broken)).toEqual(defaultNotesSettings());
  });

  it('round-trips the snapshot and its change event', () => {
    const snapshot: NotesSnapshot = {
      folder: 'C:\\Users\\me\\AppData\\Roaming\\Muna\\notes',
      defaultFolder: true,
      notes: [
        note('Groceries.md', true),
        note('projects/Muna.md', false, 1_790_600_060_000),
        note('Inbox.md'),
      ],
      inboxId: 'Inbox.md',
      problem: null,
    };
    expect(notesSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(notesChangedSchema.parse({ snapshot })).toEqual({ snapshot });
    const away: NotesSnapshot = {
      folder: 'E:\\Vault',
      defaultFolder: false,
      notes: [],
      inboxId: null,
      problem: 'missing',
    };
    expect(notesSnapshotSchema.parse(away)).toEqual(away);
    expect(noteSchema.safeParse({ ...note('a.md'), id: '' }).success).toBe(false);
    expect(noteSchema.safeParse({ ...note('a.md'), modifiedMs: 1.5 }).success).toBe(false);
    expect(notesSnapshotSchema.safeParse({ ...away, problem: 'locked' }).success).toBe(false);
    expect(notesSnapshotSchema.safeParse({ ...away, inboxId: '' }).success).toBe(false);
    expectTypeOf<z.infer<typeof notesSnapshotSchema>>().toEqualTypeOf<NotesSnapshot>();
  });

  it('round-trips what the editor loads and sends back', () => {
    const content: NoteContent = {
      id: 'Inbox.md',
      title: 'Inbox',
      body: '- remember the milk\n',
      modifiedMs: 1_790_600_000_000,
    };
    expect(noteContentSchema.parse(content)).toEqual(content);
    const draft: NoteDraft = {
      id: 'Inbox.md',
      body: '- remember the milk\n- and the eggs\n',
      baseModifiedMs: 1_790_600_000_000,
    };
    expect(noteDraftSchema.parse(draft)).toEqual(draft);
    expect(noteDraftSchema.safeParse({ ...draft, baseModifiedMs: -1 }).success).toBe(false);
    expect(noteDraftSchema.safeParse({ ...draft, id: '' }).success).toBe(false);
    expectTypeOf<z.infer<typeof noteContentSchema>>().toEqualTypeOf<NoteContent>();
    expectTypeOf<z.infer<typeof noteDraftSchema>>().toEqualTypeOf<NoteDraft>();
  });

  it('accepts refresh, pin and delete and nothing else', () => {
    const commands: NotesCommand[] = [
      { kind: 'refresh' },
      { kind: 'pin', id: 'Groceries.md', pinned: true },
      { kind: 'delete', id: 'projects/Muna.md' },
    ];
    for (const command of commands) {
      expect(notesCommandSchema.parse(command)).toEqual(command);
    }
    expect(notesCommandSchema.safeParse({ kind: 'pin', id: '', pinned: true }).success).toBe(false);
    expect(notesCommandSchema.safeParse({ kind: 'rename', id: 'a.md' }).success).toBe(false);
    expectTypeOf<z.infer<typeof notesCommandSchema>>().toEqualTypeOf<NotesCommand>();
  });

  it('shows the head of the list in the widget', () => {
    expect(widgetNote([])).toBeNull();
    const pinned = note('Groceries.md', true);
    expect(widgetNote([pinned, note('Inbox.md')])).toBe(pinned);
    const newest = note('Inbox.md');
    expect(widgetNote([newest])).toBe(newest);
  });
});

describe('screen time schemas', () => {
  const app = (exe: string, totalMs: number, extra: Partial<AppUsage> = {}): AppUsage => ({
    exe,
    name: exe.replace(/\.exe$/, ''),
    category: 'other',
    totalMs,
    sessions: 1,
    longestMs: totalMs,
    icon: null,
    limitMinutes: null,
    limitReached: false,
    ...extra,
  });
  const day = (dayStartMs: number, totalMs: number): DayUsage => ({
    dayStartMs,
    totalMs,
    byCategory: totalMs > 0 ? [{ category: 'other', totalMs }] : [],
  });
  const DAY = 86_400_000;
  const MIDNIGHT = 1_718_150_400_000;
  const week = Array.from({ length: 7 }, (_, index) =>
    day(MIDNIGHT - (6 - index) * DAY, index === 6 ? 600_000 : 0),
  );

  it('is on by default, stops after five idle minutes and rolls over at midnight', () => {
    expect(defaultScreenTimeSettings()).toEqual({
      enabled: true,
      idleMinutes: 5,
      dayResetHour: 0,
    });
    expect(readScreenTimeSettings(defaultSettings())).toEqual(defaultScreenTimeSettings());
    expect(SCREEN_TIME_SETTINGS_KEY).toBe('screen-time');
    expect(SCREEN_TIME_TOP_APPS).toBe(20);
    expect(SCREEN_TIME_WEEK_DAYS).toBe(7);
    expect(APP_CATEGORIES).toHaveLength(8);
    expect(
      SCREEN_TIME_LIMIT_PRESETS.every((minutes) => minutes >= SCREEN_TIME_BOUNDS.limitMinutes.min),
    ).toBe(true);
  });

  it('clamps the ranges, fills missing fields and falls back on a malformed entry', () => {
    expect(screenTimeSettingsSchema.parse({ idleMinutes: 0, dayResetHour: 24 })).toEqual({
      enabled: true,
      idleMinutes: SCREEN_TIME_BOUNDS.idleMinutes.min,
      dayResetHour: SCREEN_TIME_BOUNDS.dayResetHour.max,
    });
    expect(screenTimeSettingsSchema.parse({ idleMinutes: 90 }).idleMinutes).toBe(
      SCREEN_TIME_BOUNDS.idleMinutes.max,
    );
    expect(screenTimeSettingsSchema.parse({ enabled: false })).toEqual({
      enabled: false,
      idleMinutes: 5,
      dayResetHour: 0,
    });
    const doc = writeScreenTimeSettings(defaultSettings(), {
      enabled: true,
      idleMinutes: 10,
      dayResetHour: 4,
    });
    expect(readScreenTimeSettings(doc)).toEqual({
      enabled: true,
      idleMinutes: 10,
      dayResetHour: 4,
    });
    expect(doc.modules[NOTES_SETTINGS_KEY]).toBeUndefined();
    const broken: Settings = {
      ...defaultSettings(),
      modules: { [SCREEN_TIME_SETTINGS_KEY]: { enabled: 'yes' } },
    };
    expect(readScreenTimeSettings(broken)).toEqual(defaultScreenTimeSettings());
  });

  it('round-trips the snapshot and its change event', () => {
    const snapshot: ScreenTimeSnapshot = {
      tracking: 'active',
      now: {
        exe: 'code.exe',
        name: 'Visual Studio Code',
        category: 'development',
        sinceMs: MIDNIGHT + 43_200_000,
        icon: 'data:image/png;base64,iVBORw0KGgo=',
      },
      today: { totalMs: 600_000, switches: 3, longestMs: 300_000, averageMs: 200_000 },
      apps: [
        app('code.exe', 420_000, {
          name: 'Visual Studio Code',
          category: 'development',
          sessions: 2,
          longestMs: 300_000,
          limitMinutes: 120,
        }),
        app('chrome.exe', 180_000, { category: 'browsing' }),
      ],
      categories: [
        { category: 'browsing', totalMs: 180_000 },
        { category: 'development', totalMs: 420_000 },
      ],
      week,
      excluded: [{ exe: 'keepass.exe', name: 'KeePass' }],
      dayStartMs: MIDNIGHT,
      generatedAtMs: MIDNIGHT + 43_800_000,
    };
    expect(screenTimeSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(screenTimeChangedSchema.parse({ snapshot })).toEqual({ snapshot });
    const off: ScreenTimeSnapshot = {
      ...snapshot,
      tracking: 'off',
      now: null,
      apps: [],
      categories: [],
      excluded: [],
    };
    expect(screenTimeSnapshotSchema.parse(off)).toEqual(off);
    expect(screenTimeSnapshotSchema.safeParse({ ...off, tracking: 'paused' }).success).toBe(false);
    expect(screenTimeSnapshotSchema.safeParse({ ...off, week: week.slice(1) }).success).toBe(false);
    expect(appUsageSchema.safeParse({ ...app('a.exe', 1), exe: '' }).success).toBe(false);
    expect(appUsageSchema.safeParse({ ...app('a.exe', 1), category: 'work' }).success).toBe(false);
    expect(appUsageSchema.safeParse({ ...app('a.exe', 1), limitMinutes: 0 }).success).toBe(false);
    expect(appUsageSchema.safeParse({ ...app('a.exe', -1) }).success).toBe(false);
    expectTypeOf<z.infer<typeof screenTimeSnapshotSchema>>().toEqualTypeOf<ScreenTimeSnapshot>();
  });

  it('accepts every command and refuses an unknown one or a blank exe', () => {
    const commands: ScreenTimeCommand[] = [
      { kind: 'refresh' },
      { kind: 'exclude', exe: 'keepass.exe' },
      { kind: 'include', exe: 'keepass.exe' },
      { kind: 'setCategory', exe: 'code.exe', category: 'productivity' },
      { kind: 'setCategory', exe: 'code.exe', category: null },
      { kind: 'setLimit', exe: 'steam.exe', minutes: 120 },
      { kind: 'setLimit', exe: 'steam.exe', minutes: null },
      { kind: 'clearHistory' },
    ];
    for (const command of commands) {
      expect(screenTimeCommandSchema.parse(command)).toEqual(command);
    }
    expect(screenTimeCommandSchema.safeParse({ kind: 'exclude', exe: '' }).success).toBe(false);
    expect(screenTimeCommandSchema.safeParse({ kind: 'reset' }).success).toBe(false);
    expect(
      screenTimeCommandSchema.safeParse({ kind: 'setLimit', exe: 'a.exe', minutes: -5 }).success,
    ).toBe(false);
    expectTypeOf<z.infer<typeof screenTimeCommandSchema>>().toEqualTypeOf<ScreenTimeCommand>();
  });

  it('turns categories into donut shares that sum to one', () => {
    expect(categoryShares([])).toEqual([]);
    expect(categoryShares([{ category: 'other', totalMs: 0 }])).toEqual([]);
    const shares = categoryShares([
      { category: 'browsing', totalMs: 180_000 },
      { category: 'development', totalMs: 420_000 },
      { category: 'games', totalMs: 0 },
    ]);
    expect(shares.map((entry) => entry.category)).toEqual(['browsing', 'development']);
    expect(shares.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1);
    expect(shares[0]?.share).toBeCloseTo(0.3);
  });

  it('measures limit progress and clamps it at one', () => {
    expect(limitProgress({ totalMs: 600_000, limitMinutes: null })).toBeNull();
    expect(limitProgress({ totalMs: 600_000, limitMinutes: 0 })).toBeNull();
    expect(limitProgress({ totalMs: 600_000, limitMinutes: 20 })).toBeCloseTo(0.5);
    expect(limitProgress({ totalMs: 6_000_000, limitMinutes: 20 })).toBe(1);
  });

  it('scales the week to its tallest day, never below a minute', () => {
    expect(weekScaleMs([])).toBe(60_000);
    expect(weekScaleMs(week.map((entry) => ({ ...entry, totalMs: 0 })))).toBe(60_000);
    expect(weekScaleMs(week)).toBe(600_000);
  });
});

describe('ai coding contract', () => {
  const NOON = 1_718_193_600_000;
  const session = (id: string, overrides: Partial<AiSession> = {}): AiSession => ({
    id,
    agent: 'claude',
    project: 'muna',
    branch: 'main',
    model: 'claude-sonnet-4',
    status: 'running',
    waiting: null,
    task: 'Add a test for the receiver',
    file: 'src/lib.rs',
    startedAtMs: NOON - 600_000,
    updatedAtMs: NOON,
    messages: 4,
    tokens: 12_345,
    canFocus: true,
    ...overrides,
  });
  const receiver = {
    port: AI_CODING_DEFAULT_PORT,
    listening: true,
    hookUrl: `http://127.0.0.1:${String(AI_CODING_DEFAULT_PORT)}/hooks/claude`,
    claudeHooksInstalled: false,
  };

  it('is on by default, listens on the documented port and follows Copilot CLI', () => {
    expect(defaultAiCodingSettings()).toEqual({
      enabled: true,
      port: AI_CODING_DEFAULT_PORT,
      copilotCli: true,
      waitingNotice: true,
    });
    expect(readAiCodingSettings(defaultSettings())).toEqual(defaultAiCodingSettings());
    expect(AI_CODING_SETTINGS_KEY).toBe('ai-coding');
    expect(AI_CODING_DEFAULT_PORT).toBe(47_391);
    expect(AI_CODING_BOUNDS.port).toEqual({ min: 1024, max: 65_535 - AI_CODING_PORT_ATTEMPTS });
    expect(AI_CODING_RECENT_MAX).toBe(20);
    expect(AI_CODING_RECENT_FOR_MS).toBe(86_400_000);
    expect(AI_AGENTS).toEqual(['claude', 'copilot', 'generic']);
  });

  it('clamps the port, fills missing fields and falls back on a malformed entry', () => {
    expect(aiCodingSettingsSchema.parse({ port: 80 })).toEqual({
      ...defaultAiCodingSettings(),
      port: AI_CODING_BOUNDS.port.min,
    });
    expect(aiCodingSettingsSchema.parse({ port: 70_000 }).port).toBe(AI_CODING_BOUNDS.port.max);
    expect(aiCodingSettingsSchema.parse({ enabled: false, copilotCli: false })).toEqual({
      enabled: false,
      port: AI_CODING_DEFAULT_PORT,
      copilotCli: false,
      waitingNotice: true,
    });
    const doc = writeAiCodingSettings(defaultSettings(), {
      enabled: true,
      port: 50_000,
      copilotCli: true,
      waitingNotice: false,
    });
    expect(readAiCodingSettings(doc)).toEqual({
      enabled: true,
      port: 50_000,
      copilotCli: true,
      waitingNotice: false,
    });
    expect(doc.modules[SCREEN_TIME_SETTINGS_KEY]).toBeUndefined();
    const broken: Settings = {
      ...defaultSettings(),
      modules: { [AI_CODING_SETTINGS_KEY]: { port: 'soon' } },
    };
    expect(readAiCodingSettings(broken)).toEqual(defaultAiCodingSettings());
  });

  it('round-trips the snapshot and its change event', () => {
    const snapshot: AiCodingSnapshot = {
      enabled: true,
      sessions: [
        session('claude:s1', {
          status: 'waiting',
          waiting: {
            kind: 'permission',
            tool: 'Bash',
            detail: 'cargo test',
            decidable: true,
            sinceMs: NOON - 5_000,
          },
        }),
        session('copilot:C:/repo', {
          agent: 'copilot',
          model: 'gpt-5',
          tokens: null,
          status: 'waiting',
          waiting: { kind: 'input', tool: null, detail: null, decidable: false, sinceMs: NOON },
        }),
        session('generic:aider:7', { agent: 'generic', project: null, branch: null, file: null }),
      ],
      recent: [session('claude:s0', { status: 'done', updatedAtMs: NOON - 3_600_000 })],
      receiver,
      generatedAtMs: NOON,
    };
    expect(aiCodingSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(aiCodingChangedSchema.parse({ snapshot })).toEqual({ snapshot });
    const off: AiCodingSnapshot = {
      enabled: false,
      sessions: [],
      recent: [],
      receiver: { ...receiver, listening: false },
      generatedAtMs: NOON,
    };
    expect(aiCodingSnapshotSchema.parse(off)).toEqual(off);
    expect(aiSessionSchema.safeParse({ ...session('x'), agent: 'cursor' }).success).toBe(false);
    expect(aiSessionSchema.safeParse({ ...session('x'), status: 'paused' }).success).toBe(false);
    expect(aiSessionSchema.safeParse({ ...session('x'), tokens: -1 }).success).toBe(false);
    expect(aiSessionSchema.safeParse({ ...session('') }).success).toBe(false);
    expect(
      aiCodingSnapshotSchema.safeParse({
        ...off,
        recent: Array.from({ length: AI_CODING_RECENT_MAX + 1 }, (_, index) =>
          session(`claude:${String(index)}`),
        ),
      }).success,
    ).toBe(false);
    expect(
      aiCodingSnapshotSchema.safeParse({ ...off, receiver: { ...receiver, port: 0 } }).success,
    ).toBe(false);
    expectTypeOf<z.infer<typeof aiCodingSnapshotSchema>>().toEqualTypeOf<AiCodingSnapshot>();
  });

  it('accepts every command and refuses an unknown one or a blank session', () => {
    const commands: AiCodingCommand[] = [
      { kind: 'refresh' },
      { kind: 'allow', session: 'claude:s1' },
      { kind: 'deny', session: 'claude:s1' },
      { kind: 'focus', session: 'copilot:C:/repo' },
      { kind: 'dismiss', session: 'copilot:C:/repo' },
      { kind: 'installClaudeHooks' },
      { kind: 'removeClaudeHooks' },
    ];
    for (const command of commands) {
      expect(aiCodingCommandSchema.parse(command)).toEqual(command);
    }
    expect(aiCodingCommandSchema.safeParse({ kind: 'allow', session: '' }).success).toBe(false);
    expect(aiCodingCommandSchema.safeParse({ kind: 'approve', session: 'x' }).success).toBe(false);
    expectTypeOf<z.infer<typeof aiCodingCommandSchema>>().toEqualTypeOf<AiCodingCommand>();
  });

  it('splits the live sessions into the ones waiting and the ones running, order kept', () => {
    const waiting = session('claude:w', { status: 'waiting' });
    const running = session('claude:r');
    const later = session('copilot:r2', { agent: 'copilot' });
    expect(waitingSessions([waiting, running, later])).toEqual([waiting]);
    expect(runningSessions([waiting, running, later])).toEqual([running, later]);
    expect(waitingSessions([])).toEqual([]);
  });
});

describe('support schemas', () => {
  const AT = Date.UTC(2026, 8, 27, 10, 30);

  it('defaults the namespace, round-trips it and refuses a wrong type', () => {
    expect(defaultSupportSettings()).toEqual({ channel: 'stable', crashReports: false });
    expect(readSupportSettings(defaultSettings())).toEqual(defaultSupportSettings());
    expect(supportSettingsSchema.parse({ channel: 'beta' })).toEqual({
      channel: 'beta',
      crashReports: false,
    });
    const doc = writeSupportSettings(defaultSettings(), { channel: 'beta', crashReports: false });
    expect(readSupportSettings(doc)).toEqual({ channel: 'beta', crashReports: false });
    expect(doc.modules[SUPPORT_SETTINGS_KEY]).toEqual({ channel: 'beta', crashReports: false });
    const broken: Settings = {
      ...defaultSettings(),
      modules: { [SUPPORT_SETTINGS_KEY]: { channel: 'nightly' } },
    };
    expect(readSupportSettings(broken)).toEqual(defaultSupportSettings());
  });

  it('round-trips the snapshot, its change event, the commands and the outcomes', () => {
    const snapshot: SupportSnapshot = {
      version: '1.2.3',
      channel: 'stable',
      system: { os: 'Windows 11 Pro (build 26200)', webview2: '140.0.3485.54' },
      profileDir: 'C:\\Users\\me\\AppData\\Roaming\\Muna',
      logsBytes: 348_160,
      lastBundle: {
        path: 'C:\\Users\\me\\Desktop\\muna-diagnostics-20260927-1030.zip',
        entries: 5,
        atMs: AT,
      },
      changelog: false,
    };
    expect(supportSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(supportChangedSchema.parse({ snapshot })).toEqual({ snapshot });
    const bare: SupportSnapshot = {
      ...snapshot,
      system: { os: 'unknown', webview2: null },
      profileDir: null,
      logsBytes: 0,
      lastBundle: null,
      changelog: true,
    };
    expect(supportSnapshotSchema.parse(bare)).toEqual(bare);
    expect(supportSnapshotSchema.safeParse({ ...bare, version: '' }).success).toBe(false);
    expect(supportSnapshotSchema.safeParse({ ...bare, logsBytes: -1 }).success).toBe(false);
    expect(supportSnapshotSchema.safeParse({ ...bare, channel: 'nightly' }).success).toBe(false);
    expectTypeOf<z.infer<typeof supportSnapshotSchema>>().toEqualTypeOf<SupportSnapshot>();

    const commands: SupportCommand[] = [
      { kind: 'diagnostics' },
      { kind: 'repairFlyouts' },
      { kind: 'repairAppBar' },
      { kind: 'openLogs' },
      { kind: 'checkUpdates' },
    ];
    for (const command of commands) {
      expect(supportCommandSchema.parse(command)).toEqual(command);
    }
    expect(supportCommandSchema.safeParse({ kind: 'installUpdate' }).success).toBe(false);
    expectTypeOf<z.infer<typeof supportCommandSchema>>().toEqualTypeOf<SupportCommand>();

    const outcomes: SupportOutcome[] = [
      { kind: 'done' },
      { kind: 'bundle', path: 'C:\\Users\\me\\Desktop\\x.zip', entries: 2, atMs: AT },
      { kind: 'update', available: true, version: '1.3.0', notes: 'Fixes' },
      { kind: 'update', available: false, version: null, notes: null },
    ];
    for (const outcome of outcomes) {
      expect(supportOutcomeSchema.parse(outcome)).toEqual(outcome);
    }
    expect(supportOutcomeSchema.safeParse({ kind: 'bundle', path: '' }).success).toBe(false);

    for (const link of ['help', 'feedback', 'rate', 'releaseNotes'] as const) {
      expect(supportLinkSchema.parse(link)).toBe(link);
    }
    expect(supportLinkSchema.safeParse('donate').success).toBe(false);
  });

  it('formats byte counts for the logs row', () => {
    expect(formatBytes(0, 'en-US')).toBe('0 B');
    expect(formatBytes(512, 'en-US')).toBe('512 B');
    expect(formatBytes(1024, 'en-US')).toBe('1 KB');
    expect(formatBytes(348_160, 'en-US')).toBe('340 KB');
    expect(formatBytes(1024 * 1024, 'en-US')).toBe('1 MB');
    expect(formatBytes(5.25 * 1024 * 1024, 'en-US')).toBe('5.3 MB');
    expect(formatBytes(1_258_291, 'de-DE')).toBe('1,2 MB');
  });
});

const row = (id: string, flags: { reviewRequested: boolean; mine: boolean }) => ({
  id,
  provider: 'gitHub',
  repo: 'octo-org/shared',
  number: 1,
  title: id,
  url: `https://github.com/octo-org/shared/pull/${id}`,
  author: 'hubot',
  authorAvatarUrl: null,
  draft: false,
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  checks: 'none',
  reviewDecision: 'none',
  updatedAtMs: 0,
  ...flags,
});
