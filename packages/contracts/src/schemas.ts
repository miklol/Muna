/**
 * Zod schemas for values that cross a trust boundary (settings file, IPC payloads from the
 * UI). Shapes mirror the specta-generated types in ./bindings.ts; `schemas.test.ts` asserts
 * they never drift.
 */
import { z } from 'zod';

import type {
  Account,
  Activity,
  AiAgent,
  AiCodingChanged,
  AiCodingCommand,
  AiCodingSnapshot,
  AiSession,
  AiStatus,
  AiWaiting,
  AppCategory,
  AppUsage,
  CategoryUsage,
  ChecksState,
  CodeHostError,
  CodeHostingChanged,
  CodeHostingCommand,
  CodeHostingSnapshot,
  CurrentApp,
  DayTotals,
  DayUsage,
  DragOutRequest,
  DragOutcome,
  DragSpike,
  DropAction,
  DropActionKind,
  DropActionsChanged,
  DropActionsSnapshot,
  DropEffect,
  DropEntered,
  DropFailure,
  DropFolder,
  DropItem,
  DropJob,
  DropJobState,
  DropLeft,
  DropMoved,
  DropPoint,
  DropTile,
  Dropped,
  ExcludedApp,
  FolderProblem,
  Glyph,
  HotkeyBinding,
  HotkeyState,
  JsonValue,
  Leading,
  MonitorLayout,
  NotchShape,
  Note,
  NoteContent,
  NoteDraft,
  NotesChanged,
  NotesCommand,
  NotesSnapshot,
  Notice,
  Place,
  PlacementMode,
  PomodoroPhase,
  Provider,
  PullRequest,
  ReceiverState,
  ReducedMotion,
  ReviewDecision,
  ScreenTimeChanged,
  ScreenTimeCommand,
  ScreenTimeSnapshot,
  Settings,
  ShelfChanged,
  ShelfCommand,
  ShelfItem,
  ShelfItemKind,
  ShelfSnapshot,
  ShellLayout,
  ShellSettings,
  SnapDragEnded,
  SnapDragLeft,
  SnapDragMoved,
  SnapZone,
  SnapZoneRef,
  SourceSetting,
  StripContent,
  StripHeight,
  StripMessage,
  Tint,
  Tracking,
  Trailing,
  TransferMode,
  WaitingKind,
  YieldState,
} from './bindings';

export const SETTINGS_VERSION = 5;

/** Strip height presets in CSS px (docs/modules/notch-shell.md, "Settings"). */
export const STRIP_HEIGHT_PX: Readonly<Record<StripHeight, number>> = {
  compact: 26,
  default: 32,
  comfortable: 38,
};

/**
 * The sliver of the strip left visible while a window peeks, in CSS px; mirrors
 * `shell::layout::PEEK_HEIGHT_PX`, which the shell's hit tester uses to follow the slide.
 */
export const PEEK_HEIGHT_PX = 6;

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const reducedMotionSchema = z.enum([
  'system',
  'on',
  'off',
]) satisfies z.ZodType<ReducedMotion>;

export const generalSettingsSchema = z.object({
  launchAtLogin: z.boolean(),
  reducedMotion: reducedMotionSchema,
  accent: z.string().min(1),
  onboarded: z.boolean(),
});

export const placementModeSchema = z.enum([
  'overlay',
  'reserved',
]) satisfies z.ZodType<PlacementMode>;

export const notchShapeSchema = z.enum(['notch', 'island']) satisfies z.ZodType<NotchShape>;

export const stripHeightSchema = z.enum([
  'compact',
  'default',
  'comfortable',
]) satisfies z.ZodType<StripHeight>;

export const yieldStateSchema = z.enum(['none', 'peek', 'parked']) satisfies z.ZodType<YieldState>;

export const monitorLayoutSchema = z.object({
  enabled: z.boolean(),
  mode: placementModeSchema,
  shape: notchShapeSchema,
  offsetX: z.number().int(),
  offsetY: z.number().int(),
  stripHeight: stripHeightSchema,
}) satisfies z.ZodType<MonitorLayout>;

export const shellSettingsSchema = z.object({
  hideFromCaptures: z.boolean(),
  defaults: monitorLayoutSchema,
  monitors: z.record(z.string(), monitorLayoutSchema),
  moduleOrder: z.array(z.string().min(1)),
  disabledModules: z.array(z.string().min(1)),
}) satisfies z.ZodType<ShellSettings>;

export const shellLayoutSchema = z.object({
  label: z.string().min(1),
  monitorId: z.string().min(1),
  isPrimary: z.boolean(),
  enabled: z.boolean(),
  mode: placementModeSchema,
  shape: notchShapeSchema,
  stripHeight: z.number().int().positive(),
  stripTopOffset: z.number().int().min(0),
  panelMaxWidth: z.number().int().positive(),
  scalePercent: z.number().int().positive(),
  yieldState: yieldStateSchema,
}) satisfies z.ZodType<ShellLayout>;

export const settingsSchema = z.object({
  // Kept as `number` (not a literal) so the inferred type equals the specta-generated one;
  // the explicit `boolean` return stops TS from inferring a narrowing type predicate.
  version: z
    .number()
    .int()
    .refine((v): boolean => v === SETTINGS_VERSION, {
      message: `expected version ${SETTINGS_VERSION}`,
    }),
  general: generalSettingsSchema,
  shell: shellSettingsSchema,
  modules: z.record(z.string(), jsonValueSchema),
}) satisfies z.ZodType<Settings>;

export const glyphSchema = z.enum([
  'battery',
  'batteryCharging',
  'bluetooth',
  'headphones',
  'lock',
  'unlock',
  'timer',
  'bell',
  'music',
  'moon',
  'play',
  'volume',
  'volumeLow',
  'volumeMedium',
  'volumeHigh',
  'volumeMuted',
  'sun',
  'mic',
  'micMuted',
  'checkCircle',
  'cpu',
  'hourglass',
  'calendar',
  'folder',
  'archive',
  'share',
  'trash',
  'drive',
  'shelf',
  'pullRequest',
  'xCircle',
  'terminal',
]) satisfies z.ZodType<Glyph>;

/** What a drop action does with the items (docs/modules/drop-actions.md "Tiles"). */
export const dropActionKindSchema = z.enum([
  'share',
  'copy',
  'move',
  'open',
  'openWith',
  'zip',
  'unzip',
  'reveal',
  'trash',
  'eject',
  'shelf',
]) satisfies z.ZodType<DropActionKind>;

export const tintSchema = z.enum([
  'blue',
  'cyan',
  'green',
  'orange',
  'red',
  'purple',
  'yellow',
  'pink',
]) satisfies z.ZodType<Tint>;

const percent = z.number().min(0).max(100);
const iconSlot = z.object({
  kind: z.literal('icon'),
  glyph: glyphSchema,
  tint: tintSchema.nullable(),
});
const batterySlot = z.object({ kind: z.literal('battery'), percent, charging: z.boolean() });

export const leadingSchema = z.discriminatedUnion('kind', [
  iconSlot,
  batterySlot,
  z.object({
    kind: z.literal('image'),
    src: z.string(),
    /** Absent from older payloads; reads as `null` so consumers see one shape. */
    glow: z.string().nullable().default(null),
  }),
]) satisfies z.ZodType<Leading>;

export const trailingSchema = z.discriminatedUnion('kind', [
  iconSlot,
  z.object({ kind: z.literal('text'), value: z.string() }),
  z.object({ kind: z.literal('percent'), value: percent }),
  batterySlot,
  z.object({
    kind: z.literal('timer'),
    remainingMs: z.number().int().min(0),
    totalMs: z.number().int().min(0),
    running: z.boolean(),
  }),
  z.object({ kind: z.literal('progress'), percent }),
  z.object({ kind: z.literal('waveform'), playing: z.boolean() }),
  z.object({ kind: z.literal('level'), percent, muted: z.boolean() }),
  z.object({ kind: z.literal('time'), atMs: z.number().int() }),
  z.object({ kind: z.literal('count'), value: z.number().int().min(0) }),
  z.object({ kind: z.literal('decision'), session: z.string().min(1) }),
]) satisfies z.ZodType<Trailing>;

export const pomodoroPhaseSchema = z.enum([
  'work',
  'shortBreak',
  'longBreak',
]) satisfies z.ZodType<PomodoroPhase>;

export const stripMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string() }),
  z.object({ kind: z.literal('batteryLow'), percent }),
  z.object({
    kind: z.literal('bluetoothConnected'),
    name: z.string(),
    batteryPercent: percent.nullable(),
  }),
  z.object({ kind: z.literal('bluetoothDisconnected'), name: z.string() }),
  z.object({ kind: z.literal('deviceBatteryLow'), name: z.string(), percent }),
  z.object({ kind: z.literal('timerFinished'), label: z.string() }),
  z.object({ kind: z.literal('nowPlaying'), title: z.string(), artist: z.string() }),
  z.object({ kind: z.literal('pomodoro'), phase: pomodoroPhaseSchema }),
  z.object({ kind: z.literal('pomodoroFinished'), phase: pomodoroPhaseSchema }),
  z.object({ kind: z.literal('taskDue'), title: z.string() }),
  z.object({ kind: z.literal('eventStarting'), title: z.string() }),
  z.object({ kind: z.literal('notification'), app: z.string(), title: z.string() }),
  z.object({
    kind: z.literal('dropRunning'),
    action: dropActionKindSchema,
    count: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal('dropFinished'),
    action: dropActionKindSchema,
    count: z.number().int().min(0),
  }),
  z.object({ kind: z.literal('dropFailed'), action: dropActionKindSchema }),
  z.object({ kind: z.literal('reviewRequested'), title: z.string() }),
  z.object({ kind: z.literal('checksFinished'), title: z.string(), passed: z.boolean() }),
  z.object({
    kind: z.literal('screenTimeLimit'),
    app: z.string(),
    minutes: z.number().int().min(1),
  }),
  z.object({ kind: z.literal('agentWaiting'), agent: z.string(), tool: z.string().nullable() }),
]) satisfies z.ZodType<StripMessage>;

export const activitySchema = z.object({
  id: z.string().min(1),
  module: z.string().min(1),
  priority: z.number().int().min(0).max(100),
  leading: leadingSchema.nullable(),
  trailing: trailingSchema.nullable(),
  wide: stripMessageSchema.nullable(),
}) satisfies z.ZodType<Activity>;

export const noticeSchema = z.object({
  id: z.string().min(1),
  module: z.string().min(1),
  priority: z.number().int().min(0).max(100),
  leading: leadingSchema.nullable(),
  trailing: trailingSchema.nullable(),
  wide: stripMessageSchema.nullable(),
  holdMs: z.number().int().min(0),
}) satisfies z.ZodType<Notice>;

export const stripContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('idle') }),
  z.object({ kind: z.literal('activity'), activity: activitySchema, wide: z.boolean() }),
  z.object({ kind: z.literal('notice'), notice: noticeSchema }),
]) satisfies z.ZodType<StripContent>;

export const defaultMonitorLayout = (): MonitorLayout => ({
  enabled: true,
  mode: 'overlay',
  shape: 'notch',
  offsetX: 0,
  offsetY: 0,
  stripHeight: 'default',
});

export const defaultShellSettings = (): ShellSettings => ({
  hideFromCaptures: false,
  defaults: defaultMonitorLayout(),
  monitors: {},
  moduleOrder: [],
  disabledModules: [],
});

export const defaultSettings = (): Settings => ({
  version: SETTINGS_VERSION,
  general: { launchAtLogin: false, reducedMotion: 'system', accent: 'blue', onboarded: false },
  shell: defaultShellSettings(),
  modules: {},
});

// --- module namespaces ---------------------------------------------------------------------
// `settings.modules.<id>` is opaque JSON to the document; each module owns and validates its
// own shape here (UI) and in `src-tauri/src/modules/<id>/settings.rs` (Rust), which must agree.

/** The key of the media module's namespace; also its module id. */
export const MEDIA_SETTINGS_KEY = 'media';

export const visualiserSchema = z.enum(['bars', 'off']);
export type Visualiser = z.infer<typeof visualiserSchema>;

/** Mirrors `modules::media::MediaSettings`: every field has a default so a partial entry reads. */
export const mediaSettingsSchema = z.object({
  /** `sourceAppId` to show while it has a session; `null` follows the scoring ("Auto"). */
  preferredApp: z.string().nullable().default(null),
  /** Tint the strip halo and the panel gradient with the artwork palette. */
  adaptiveColours: z.boolean().default(true),
  visualiser: visualiserSchema.default('bars'),
});
export type MediaSettings = z.infer<typeof mediaSettingsSchema>;

export const defaultMediaSettings = (): MediaSettings => mediaSettingsSchema.parse({});

/**
 * Reads the media namespace out of a settings document; a missing or malformed entry yields
 * the defaults, like the Rust side, so the two never disagree about what the user gets.
 */
export const readMediaSettings = (settings: Settings): MediaSettings => {
  const parsed = mediaSettingsSchema.safeParse(settings.modules[MEDIA_SETTINGS_KEY] ?? {});
  return parsed.success ? parsed.data : defaultMediaSettings();
};

/** Returns a new document with the media namespace replaced. */
export const writeMediaSettings = (settings: Settings, media: MediaSettings): Settings => ({
  ...settings,
  modules: { ...settings.modules, [MEDIA_SETTINGS_KEY]: media },
});

/** The key of the HUD module's namespace; also its module id. */
export const HUD_SETTINGS_KEY = 'hud';

/** What the wheel does over the collapsed strip (docs/modules/hud.md "Interaction"). */
export const scrollOnStripSchema = z.enum(['panel', 'volume']);
export type ScrollOnStrip = z.infer<typeof scrollOnStripSchema>;

/** Mirrors `modules::hud::HudSettings`: every field has a default so a partial entry reads. */
export const hudSettingsSchema = z.object({
  /** Hide the Windows volume/brightness flyout while Muna runs. */
  replaceSystemFlyout: z.boolean().default(true),
  /** `panel` opens the panel (volume only while the HUD shows); `volume` always nudges. */
  scrollOnStrip: scrollOnStripSchema.default('panel'),
  /** Show the percentage beside the level track. */
  showLevelText: z.boolean().default(false),
});
export type HudSettings = z.infer<typeof hudSettingsSchema>;

export const defaultHudSettings = (): HudSettings => hudSettingsSchema.parse({});

/** Reads the HUD namespace; a missing or malformed entry yields the defaults, like Rust. */
export const readHudSettings = (settings: Settings): HudSettings => {
  const parsed = hudSettingsSchema.safeParse(settings.modules[HUD_SETTINGS_KEY] ?? {});
  return parsed.success ? parsed.data : defaultHudSettings();
};

/** Returns a new document with the HUD namespace replaced. */
export const writeHudSettings = (settings: Settings, hud: HudSettings): Settings => ({
  ...settings,
  modules: { ...settings.modules, [HUD_SETTINGS_KEY]: hud },
});

/**
 * The HUD's notice ids (docs/modules/hud.md "Contract"); the shell recognises them to route
 * wheel and drag on the strip to the platform.
 */
export const HUD_NOTICE_IDS = {
  volume: 'hud:volume',
  mic: 'hud:mic',
  brightness: 'hud:brightness',
} as const;

/** Volume change for one wheel notch, in percent (mirrors `modules::hud::VOLUME_STEP`). */
export const HUD_VOLUME_STEP = 2;

/** The key of the pomodoro module's namespace; also its module id. */
export const POMODORO_SETTINGS_KEY = 'pomodoro';

/**
 * Bounds the settings pane offers and the module clamps to, in minutes (mirrors
 * `modules::pomodoro::settings::*`).
 */
export const POMODORO_BOUNDS = {
  workMinutes: { min: 5, max: 90 },
  shortBreakMinutes: { min: 1, max: 30 },
  longBreakMinutes: { min: 5, max: 60 },
  longBreakEvery: { min: 2, max: 8 },
} as const;

const clampedInt = (bounds: { min: number; max: number }, fallback: number) =>
  z
    .number()
    .int()
    .nonnegative()
    .default(fallback)
    .transform((value) => Math.min(bounds.max, Math.max(bounds.min, value)));

/**
 * Mirrors `modules::pomodoro::PomodoroSettings`: every field has a default so a partial entry
 * reads, out-of-range values clamp to the bounds and a wrong type fails the whole entry, like
 * the Rust side, so the two never disagree about what the user gets.
 */
export const pomodoroSettingsSchema = z.object({
  workMinutes: clampedInt(POMODORO_BOUNDS.workMinutes, 25),
  shortBreakMinutes: clampedInt(POMODORO_BOUNDS.shortBreakMinutes, 5),
  longBreakMinutes: clampedInt(POMODORO_BOUNDS.longBreakMinutes, 15),
  /** Work phases per cycle; the break after the last one is the long one. */
  longBreakEvery: clampedInt(POMODORO_BOUNDS.longBreakEvery, 4),
  /** Start the next phase as soon as one runs out. */
  autoStartNext: z.boolean().default(false),
});
export type PomodoroSettings = z.infer<typeof pomodoroSettingsSchema>;

export const defaultPomodoroSettings = (): PomodoroSettings => pomodoroSettingsSchema.parse({});

/** Reads the pomodoro namespace; a missing or malformed entry yields the defaults, like Rust. */
export const readPomodoroSettings = (settings: Settings): PomodoroSettings => {
  const parsed = pomodoroSettingsSchema.safeParse(settings.modules[POMODORO_SETTINGS_KEY] ?? {});
  return parsed.success ? parsed.data : defaultPomodoroSettings();
};

/** Returns a new document with the pomodoro namespace replaced. */
export const writePomodoroSettings = (
  settings: Settings,
  pomodoro: PomodoroSettings,
): Settings => ({
  ...settings,
  modules: { ...settings.modules, [POMODORO_SETTINGS_KEY]: pomodoro },
});

/** The pomodoro module's strip ids (docs/modules/pomodoro.md "Contract"). */
export const POMODORO_STRIP_IDS = {
  activity: 'pomodoro:timer',
  finished: 'pomodoro:finished',
} as const;

/** The key of the todo module's namespace; also its module id. */
export const TODO_SETTINGS_KEY = 'todo';

/** The list every profile has (mirrors `muna_core::INBOX_LIST_ID`); the UI localises its name. */
export const TODO_INBOX_LIST_ID = 'inbox';

/** Bounds the settings pane offers and the module clamps to (mirrors `modules::todo::settings`). */
export const TODO_BOUNDS = {
  retentionDays: { min: 1, max: 365 },
} as const;

/**
 * Mirrors `modules::todo::TodoSettings`: defaults for missing fields, clamped ranges, and a
 * wrong type fails the whole entry, like the Rust side.
 */
export const todoSettingsSchema = z.object({
  /** How long a trashed task can be restored before it is purged. */
  retentionDays: clampedInt(TODO_BOUNDS.retentionDays, 30),
  /** Announce a task in the strip at its due time. */
  dueNotices: z.boolean().default(true),
  /** Show the next task due within the hour as a strip activity. */
  showDueInStrip: z.boolean().default(true),
});
export type TodoSettings = z.infer<typeof todoSettingsSchema>;

export const defaultTodoSettings = (): TodoSettings => todoSettingsSchema.parse({});

/** Reads the todo namespace; a missing or malformed entry yields the defaults, like Rust. */
export const readTodoSettings = (settings: Settings): TodoSettings => {
  const parsed = todoSettingsSchema.safeParse(settings.modules[TODO_SETTINGS_KEY] ?? {});
  return parsed.success ? parsed.data : defaultTodoSettings();
};

/** Returns a new document with the todo namespace replaced. */
export const writeTodoSettings = (settings: Settings, todo: TodoSettings): Settings => ({
  ...settings,
  modules: { ...settings.modules, [TODO_SETTINGS_KEY]: todo },
});

/**
 * The todo module's strip ids (docs/modules/todo.md "Contract"); a due notice is
 * `todo:due:<taskId>`.
 */
export const TODO_STRIP_IDS = {
  activity: 'todo:due',
  noticePrefix: 'todo:due:',
} as const;

/** The key of the system monitor's namespace; also its module id. */
export const SYSTEM_MONITOR_SETTINGS_KEY = 'system-monitor';

/**
 * Bounds the settings pane offers and the module clamps to (mirrors
 * `modules::system_monitor::settings`).
 */
export const SYSTEM_MONITOR_BOUNDS = {
  processCount: { min: 0, max: 10 },
} as const;

/**
 * Mirrors `modules::system_monitor::SystemMonitorSettings`: defaults for missing fields, a
 * clamped range, and a wrong type fails the whole entry, like the Rust side.
 */
export const systemMonitorSettingsSchema = z.object({
  /** Keep a CPU gauge in the collapsed strip, sampled every 10 s. */
  showCpuInStrip: z.boolean().default(false),
  /** How many of the busiest processes the panel lists; 0 hides the list. */
  processCount: clampedInt(SYSTEM_MONITOR_BOUNDS.processCount, 5),
});
export type SystemMonitorSettings = z.infer<typeof systemMonitorSettingsSchema>;

export const defaultSystemMonitorSettings = (): SystemMonitorSettings =>
  systemMonitorSettingsSchema.parse({});

/** Reads the system monitor namespace; a missing or malformed entry yields the defaults. */
export const readSystemMonitorSettings = (settings: Settings): SystemMonitorSettings => {
  const parsed = systemMonitorSettingsSchema.safeParse(
    settings.modules[SYSTEM_MONITOR_SETTINGS_KEY] ?? {},
  );
  return parsed.success ? parsed.data : defaultSystemMonitorSettings();
};

/** Returns a new document with the system monitor namespace replaced. */
export const writeSystemMonitorSettings = (
  settings: Settings,
  systemMonitor: SystemMonitorSettings,
): Settings => ({
  ...settings,
  modules: { ...settings.modules, [SYSTEM_MONITOR_SETTINGS_KEY]: systemMonitor },
});

/** The system monitor's strip ids (docs/modules/system-monitor.md "Contract"). */
export const SYSTEM_MONITOR_STRIP_IDS = {
  cpu: 'system-monitor:cpu',
} as const;

/**
 * The module's sampling cadence in milliseconds (mirrors `modules::system_monitor::*_PERIOD`),
 * so a panel knows how stale a reading may be.
 */
export const SYSTEM_MONITOR_PERIODS = {
  visibleMs: 1000,
  stripMs: 10_000,
} as const;

/** The key of the Bluetooth module's namespace; also its module id. */
export const BLUETOOTH_SETTINGS_KEY = 'bluetooth';

/**
 * Mirrors `modules::bluetooth::BluetoothSettings`: defaults for missing fields, and a wrong
 * type fails the whole entry, like the Rust side.
 */
export const bluetoothSettingsSchema = z.object({
  /** Announce a connected device's battery at 20 % and again at 10 %. */
  lowBatteryNotices: z.boolean().default(true),
  /** Devices (by id) the panel leaves out; the settings pane still lists them. */
  hiddenDevices: z.array(z.string()).default([]),
});
export type BluetoothSettings = z.infer<typeof bluetoothSettingsSchema>;

export const defaultBluetoothSettings = (): BluetoothSettings => bluetoothSettingsSchema.parse({});

/** Reads the Bluetooth namespace; a missing or malformed entry yields the defaults. */
export const readBluetoothSettings = (settings: Settings): BluetoothSettings => {
  const parsed = bluetoothSettingsSchema.safeParse(settings.modules[BLUETOOTH_SETTINGS_KEY] ?? {});
  return parsed.success ? parsed.data : defaultBluetoothSettings();
};

/** Returns a new document with the Bluetooth namespace replaced. */
export const writeBluetoothSettings = (
  settings: Settings,
  bluetooth: BluetoothSettings,
): Settings => ({
  ...settings,
  modules: { ...settings.modules, [BLUETOOTH_SETTINGS_KEY]: bluetooth },
});

/**
 * The battery levels at which the module announces a connected device (mirrors
 * `modules::bluetooth::LOW_THRESHOLDS`).
 */
export const BLUETOOTH_LOW_THRESHOLDS = [20, 10] as const;

/** The key of the weather module's namespace; also its module id. */
export const WEATHER_SETTINGS_KEY = 'weather';

/** A place the geocoder returned (mirrors `modules::weather::Place`). */
export const placeSchema = z.object({
  name: z.string(),
  region: z.string().nullable(),
  country: z.string().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}) satisfies z.ZodType<Place>;

/**
 * Mirrors `modules::weather::WeatherSettings`: off by default (the module makes no request
 * until the user turns it on), defaults for missing fields, and a wrong type fails the whole
 * entry, like the Rust side. A manual place with coordinates off the globe fails too, which
 * the Rust side maps back to the device location.
 */
export const weatherSettingsSchema = z.object({
  /** Whether the module fetches at all. */
  enabled: z.boolean().default(false),
  /** How temperatures and wind speeds read; the forecast itself is metric. */
  units: z.enum(['metric', 'imperial']).default('metric'),
  /** The device position, or a place picked from the geocoder. */
  location: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('auto') }),
      z.object({ kind: z.literal('manual'), place: placeSchema }),
    ])
    .default({ kind: 'auto' }),
});
export type WeatherSettings = z.infer<typeof weatherSettingsSchema>;

export const defaultWeatherSettings = (): WeatherSettings => weatherSettingsSchema.parse({});

/** Reads the weather namespace; a missing or malformed entry yields the defaults. */
export const readWeatherSettings = (settings: Settings): WeatherSettings => {
  const parsed = weatherSettingsSchema.safeParse(settings.modules[WEATHER_SETTINGS_KEY] ?? {});
  return parsed.success ? parsed.data : defaultWeatherSettings();
};

/** Returns a new document with the weather namespace replaced. */
export const writeWeatherSettings = (settings: Settings, weather: WeatherSettings): Settings => ({
  ...settings,
  modules: { ...settings.modules, [WEATHER_SETTINGS_KEY]: weather },
});

/**
 * How often the module refreshes while it is on, in milliseconds (mirrors
 * `modules::weather::REFRESH`), so a panel can say how old a forecast is allowed to be.
 */
export const WEATHER_REFRESH_MS = 15 * 60 * 1000;

/** The key of the calendar module's namespace; also its module id. */
export const CALENDAR_SETTINGS_KEY = 'calendar';

/** The refresh periods the settings pane offers, in minutes (mirrors `REFRESH_CHOICES_MINUTES`). */
export const CALENDAR_REFRESH_CHOICES_MINUTES = [5, 15, 30, 60] as const;
export type CalendarRefreshMinutes = (typeof CALENDAR_REFRESH_CHOICES_MINUTES)[number];

export const isCalendarRefresh = (minutes: number): minutes is CalendarRefreshMinutes =>
  CALENDAR_REFRESH_CHOICES_MINUTES.some((choice) => choice === minutes);

/** The longest source name kept (mirrors `modules::calendar::settings::MAX_NAME_CHARS`). */
export const CALENDAR_MAX_NAME_CHARS = 60;

/**
 * The strip timings (mirrors `modules::calendar::{LEAD, STARTING_LEAD, GRACE}`): the next
 * timed event takes the strip an hour ahead, is announced and outranks playing media ten
 * minutes ahead, and leaves fifteen minutes after it started.
 */
export const CALENDAR_STRIP_MS = {
  lead: 60 * 60 * 1000,
  startingLead: 10 * 60 * 1000,
  grace: 15 * 60 * 1000,
} as const;

/**
 * One subscribed calendar as the settings document keeps it (mirrors
 * `modules::calendar::SourceSetting`). The address itself lives in the credential vault
 * under the source id and never crosses into the UI.
 */
export const calendarSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  color: tintSchema,
  enabled: z.boolean(),
  host: z.string(),
}) satisfies z.ZodType<SourceSetting>;

/**
 * Mirrors `modules::calendar::CalendarSettings`: no sources by default (the module makes no
 * request until one is added), defaults for missing fields, a refresh period outside the
 * offered ones reads as the default, and a wrong type fails the whole entry.
 */
export const calendarSettingsSchema = z.object({
  sources: z.array(calendarSourceSchema).default([]),
  refreshMinutes: z
    .number()
    .int()
    .default(5)
    .transform((minutes): CalendarRefreshMinutes => (isCalendarRefresh(minutes) ? minutes : 5)),
  /** Whether the next event within the hour takes the strip. */
  showNextInStrip: z.boolean().default(true),
  /** Whether an event is announced ten minutes before it starts. */
  notices: z.boolean().default(true),
});
export type CalendarSettings = z.infer<typeof calendarSettingsSchema>;

export const defaultCalendarSettings = (): CalendarSettings => calendarSettingsSchema.parse({});

/** Reads the calendar namespace; a missing or malformed entry yields the defaults. */
export const readCalendarSettings = (settings: Settings): CalendarSettings => {
  const parsed = calendarSettingsSchema.safeParse(settings.modules[CALENDAR_SETTINGS_KEY] ?? {});
  return parsed.success ? parsed.data : defaultCalendarSettings();
};

/** Returns a new document with the calendar namespace replaced. */
export const writeCalendarSettings = (
  settings: Settings,
  calendar: CalendarSettings,
): Settings => ({
  ...settings,
  modules: { ...settings.modules, [CALENDAR_SETTINGS_KEY]: calendar },
});

/** The strip ids the calendar module publishes under (mirrors `modules::calendar`). */
export const CALENDAR_STRIP_IDS = {
  next: 'calendar:next',
  /** Notices are `calendar:starting:<event id>`. */
  startingPrefix: 'calendar:starting:',
} as const;

/** The key of the notifications module's namespace; also its module id. */
export const NOTIFICATIONS_SETTINGS_KEY = 'notifications';

/**
 * Mirrors `modules::notifications::NotificationsSettings`: defaults for missing fields, and a
 * wrong type fails the whole entry, like the Rust side.
 */
export const notificationsSettingsSchema = z.object({
  /**
   * Announce an arriving notification in the strip (held back while Windows says the user is
   * busy or a focus session is on).
   */
  arrivalNotices: z.boolean().default(true),
  /** Keep the unread glance (latest sender and count) in the strip while anything is unread. */
  showUnreadInStrip: z.boolean().default(true),
  /**
   * Senders (by app user model id) whose notifications are listed but never announced or
   * counted; the settings pane lists them so they can be unmuted.
   */
  mutedApps: z.array(z.string()).default([]),
});
export type NotificationsSettings = z.infer<typeof notificationsSettingsSchema>;

export const defaultNotificationsSettings = (): NotificationsSettings =>
  notificationsSettingsSchema.parse({});

/** Reads the notifications namespace; a missing or malformed entry yields the defaults. */
export const readNotificationsSettings = (settings: Settings): NotificationsSettings => {
  const parsed = notificationsSettingsSchema.safeParse(
    settings.modules[NOTIFICATIONS_SETTINGS_KEY] ?? {},
  );
  return parsed.success ? parsed.data : defaultNotificationsSettings();
};

/** Returns a new document with the notifications namespace replaced. */
export const writeNotificationsSettings = (
  settings: Settings,
  notifications: NotificationsSettings,
): Settings => ({
  ...settings,
  modules: { ...settings.modules, [NOTIFICATIONS_SETTINGS_KEY]: notifications },
});

/** The strip ids the notifications module publishes under (mirrors `modules::notifications`). */
export const NOTIFICATIONS_STRIP_IDS = {
  unread: 'notifications:unread',
  /** Arrival notices are `notifications:arrived:<notification id>`. */
  arrivedPrefix: 'notifications:arrived:',
} as const;

/**
 * How often the module re-reads the Action Center on a build without package identity, in
 * milliseconds (mirrors `modules::notifications::POLL_INTERVAL`); the settings pane says so.
 */
export const NOTIFICATIONS_POLL_MS = 1000;

/** The key of the day-progress module's namespace; also its module id. */
export const DAY_PROGRESS_SETTINGS_KEY = 'day-progress';

/**
 * Bounds of the module's times of day, in minutes since local midnight (mirrors
 * `modules::day_progress::settings`): the last minute a time may name, the shortest working
 * day, and the step the settings pane offers.
 */
export const DAY_PROGRESS_BOUNDS = {
  minuteOfDay: { min: 0, max: 24 * 60 - 1 },
  minWorkingMinutes: 15,
  stepMinutes: 15,
} as const;

const minuteOfDay = (fallback: number) => clampedInt(DAY_PROGRESS_BOUNDS.minuteOfDay, fallback);

/**
 * Mirrors `modules::day_progress::DayProgressSettings`: defaults for missing fields, times
 * clamped into the day, a working day that always ends after it starts (a backwards window is
 * repaired the way Rust repairs it), and a wrong type fails the whole entry.
 */
export const dayProgressSettingsSchema = z
  .object({
    /** When the working day starts, minutes since local midnight (09:00). */
    workStartMinutes: minuteOfDay(9 * 60),
    /** When the working day ends, minutes since local midnight (18:00). */
    workEndMinutes: minuteOfDay(18 * 60),
    /** An optional bedtime marker at the end of the timeline. */
    bedtimeMinutes: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .default(null)
      .transform((value) =>
        value === null ? null : Math.min(DAY_PROGRESS_BOUNDS.minuteOfDay.max, value),
      ),
    /** Keep a progress bar of the working day in the collapsed strip. */
    showDayInStrip: z.boolean().default(false),
    /** Whether tasks with a due time today appear on the timeline. */
    showTasks: z.boolean().default(true),
    /** Whether the running focus session and today's count appear on the timeline. */
    showFocusSessions: z.boolean().default(true),
  })
  .transform((value) => {
    const minWork = DAY_PROGRESS_BOUNDS.minWorkingMinutes;
    const lastMinute = DAY_PROGRESS_BOUNDS.minuteOfDay.max;
    if (value.workEndMinutes >= value.workStartMinutes + minWork) return value;
    if (value.workStartMinutes + minWork <= lastMinute) {
      return { ...value, workEndMinutes: value.workStartMinutes + minWork };
    }
    return { ...value, workStartMinutes: 9 * 60, workEndMinutes: 18 * 60 };
  });
export type DayProgressSettings = z.infer<typeof dayProgressSettingsSchema>;

export const defaultDayProgressSettings = (): DayProgressSettings =>
  dayProgressSettingsSchema.parse({});

/** Reads the day-progress namespace; a missing or malformed entry yields the defaults. */
export const readDayProgressSettings = (settings: Settings): DayProgressSettings => {
  const parsed = dayProgressSettingsSchema.safeParse(
    settings.modules[DAY_PROGRESS_SETTINGS_KEY] ?? {},
  );
  return parsed.success ? parsed.data : defaultDayProgressSettings();
};

/** Returns a new document with the day-progress namespace replaced. */
export const writeDayProgressSettings = (
  settings: Settings,
  dayProgress: DayProgressSettings,
): Settings => ({
  ...settings,
  modules: { ...settings.modules, [DAY_PROGRESS_SETTINGS_KEY]: dayProgress },
});

/** The day-progress module's strip ids (docs/modules/day-progress.md "Contract"). */
export const DAY_PROGRESS_STRIP_IDS = {
  bar: 'day-progress:bar',
} as const;

/**
 * The shortest free stretch of the working day the timeline points out, in minutes
 * (docs/modules/day-progress.md "Data": gap detection ≥ 90 min).
 */
export const DAY_PROGRESS_GAP_MINUTES = 90;

/** The key of the dashboard module's namespace; also its module id. */
export const DASHBOARD_SETTINGS_KEY = 'dashboard';

/**
 * The widget grid (docs/modules/dashboard.md "Reference": 2 rows × 4 slots; a widget spans 1
 * or 2 slots). Mirrors `modules::dashboard::settings`.
 */
export const DASHBOARD_GRID = {
  columns: 4,
  rows: 2,
  /** Every slot the layout may fill: the sum of the spans never exceeds it. */
  cells: 8,
} as const;

export const dashboardSpanSchema = z.union([z.literal(1), z.literal(2)]);
export type DashboardSpan = z.infer<typeof dashboardSpanSchema>;

export const dashboardSlotSchema = z.object({
  /** The module whose widget fills the slot; also its settings namespace. */
  moduleId: z.string().min(1),
  /** How many grid slots the widget takes. */
  span: dashboardSpanSchema,
});
export type DashboardSlot = z.infer<typeof dashboardSlotSchema>;

/** The layout a fresh profile starts with: every P1 module with a widget, media wide. */
export const DEFAULT_DASHBOARD_SLOTS: readonly DashboardSlot[] = [
  { moduleId: 'media', span: 2 },
  { moduleId: 'pomodoro', span: 1 },
  { moduleId: 'todo', span: 1 },
  { moduleId: 'weather', span: 1 },
  { moduleId: 'day-progress', span: 1 },
  { moduleId: 'system-monitor', span: 1 },
  { moduleId: 'bluetooth', span: 1 },
];

/**
 * Keeps the first slot of each module and drops the rest once the grid is full — the same
 * repair Rust applies, so a hand-edited document reads the same on both sides.
 */
export const clampDashboardSlots = (slots: readonly DashboardSlot[]): DashboardSlot[] => {
  const seen = new Set<string>();
  const kept: DashboardSlot[] = [];
  let used = 0;
  for (const slot of slots) {
    if (seen.has(slot.moduleId) || used + slot.span > DASHBOARD_GRID.cells) continue;
    seen.add(slot.moduleId);
    used += slot.span;
    kept.push(slot);
  }
  return kept;
};

/**
 * Mirrors `modules::dashboard::DashboardSettings`: the slots in grid order, deduplicated and
 * cut to the grid; a missing entry yields the default layout and a wrong type fails the whole
 * entry.
 */
export const dashboardSettingsSchema = z
  .object({
    slots: z.array(dashboardSlotSchema).default([...DEFAULT_DASHBOARD_SLOTS]),
  })
  .transform((value) => ({ ...value, slots: clampDashboardSlots(value.slots) }));
export type DashboardSettings = z.infer<typeof dashboardSettingsSchema>;

export const defaultDashboardSettings = (): DashboardSettings => dashboardSettingsSchema.parse({});

/** Reads the dashboard namespace; a missing or malformed entry yields the defaults. */
export const readDashboardSettings = (settings: Settings): DashboardSettings => {
  const parsed = dashboardSettingsSchema.safeParse(settings.modules[DASHBOARD_SETTINGS_KEY] ?? {});
  return parsed.success ? parsed.data : defaultDashboardSettings();
};

/** Returns a new document with the dashboard namespace replaced. */
export const writeDashboardSettings = (
  settings: Settings,
  dashboard: DashboardSettings,
): Settings => ({
  ...settings,
  modules: { ...settings.modules, [DASHBOARD_SETTINGS_KEY]: dashboard },
});

/** The key of the keyboard shortcuts module's namespace; also its module id. */
export const KEYBOARD_SHORTCUTS_SETTINGS_KEY = 'keyboard-shortcuts';

/**
 * Actions the shell handles itself (docs/modules/keyboard-shortcuts.md "Scope"). Every other
 * action id (`todo.quickAdd`, …) belongs to the module that declares it in its
 * `ModuleDefinition.actions`. The first three carry the defaults and mirror
 * `modules::keyboard_shortcuts::actions`; `shell.snooze` never reaches the UI — Rust parks the
 * notch under the cursor itself. "Open module N" ids come from `shellOpenModuleActionId`.
 */
export const SHELL_ACTION_IDS = {
  togglePanel: 'shell.togglePanel',
  palette: 'shell.palette',
  snooze: 'shell.snooze',
  nextModule: 'shell.nextModule',
  previousModule: 'shell.previousModule',
} as const;
export type ShellActionId = (typeof SHELL_ACTION_IDS)[keyof typeof SHELL_ACTION_IDS];

/** How many "open module N" actions the shell offers (the first N modules in panel order). */
export const SHELL_OPEN_MODULE_SLOTS = 9;

/** `shell.openModule1` … `shell.openModule9`; `n` is 1-based. */
export const shellOpenModuleActionId = (n: number): string => `shell.openModule${String(n)}`;

/** Snooze lengths the pane offers, in minutes; mirrors `SNOOZE_MINUTES` in Rust. */
export const SNOOZE_MINUTES_CHOICES = [15, 30, 60] as const;
export type SnoozeMinutes = (typeof SNOOZE_MINUTES_CHOICES)[number];

export const isSnoozeMinutes = (minutes: number): minutes is SnoozeMinutes =>
  (SNOOZE_MINUTES_CHOICES as readonly number[]).includes(minutes);

/**
 * Chords compare case-insensitively and without stray spaces: `Ctrl + Alt + Space` and
 * `ctrl+alt+space` are the same binding. Mirrors `normalise_chord` in Rust.
 */
export const normaliseChord = (chord: string): string =>
  chord
    .split('+')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)
    .join('+');

/**
 * Mirrors `modules::keyboard_shortcuts::KeyboardShortcutsSettings`: action id → chord in
 * `tauri-plugin-global-shortcut` syntax. The same repair Rust applies — empty ids and chords
 * are dropped, chords are normalised and the snooze length snaps to an offered one — so a
 * hand-edited document reads the same on both sides. Only the three shell shortcuts are bound
 * by default; module actions start unbound.
 */
export const keyboardShortcutsSettingsSchema = z
  .object({
    bindings: z.record(z.string(), z.string()).default({
      [SHELL_ACTION_IDS.togglePanel]: 'ctrl+alt+space',
      [SHELL_ACTION_IDS.palette]: 'ctrl+shift+space',
      [SHELL_ACTION_IDS.snooze]: 'ctrl+alt+n',
    }),
    onlyWhileHovering: z.boolean().default(false),
    snoozeMinutes: z.number().int().default(SNOOZE_MINUTES_CHOICES[0]),
  })
  .transform((value) => ({
    bindings: Object.fromEntries(
      Object.entries(value.bindings)
        .map(([action, chord]) => [action.trim(), normaliseChord(chord)] as const)
        .filter(([action, chord]) => action.length > 0 && chord.length > 0),
    ),
    onlyWhileHovering: value.onlyWhileHovering,
    snoozeMinutes: isSnoozeMinutes(value.snoozeMinutes)
      ? value.snoozeMinutes
      : SNOOZE_MINUTES_CHOICES[0],
  }));
export type KeyboardShortcutsSettings = z.infer<typeof keyboardShortcutsSettingsSchema>;

export const defaultKeyboardShortcutsSettings = (): KeyboardShortcutsSettings =>
  keyboardShortcutsSettingsSchema.parse({});

/** Reads the keyboard shortcuts namespace; a missing or malformed entry yields the defaults. */
export const readKeyboardShortcutsSettings = (settings: Settings): KeyboardShortcutsSettings => {
  const parsed = keyboardShortcutsSettingsSchema.safeParse(
    settings.modules[KEYBOARD_SHORTCUTS_SETTINGS_KEY] ?? {},
  );
  return parsed.success ? parsed.data : defaultKeyboardShortcutsSettings();
};

/**
 * Returns a new document with the keyboard shortcuts namespace replaced. Bindings are the
 * OS-registered state and go through `commands.setHotkey` / `clearHotkey`, which persist
 * themselves; this is for the two preferences beside them.
 */
export const writeKeyboardShortcutsSettings = (
  settings: Settings,
  shortcuts: KeyboardShortcutsSettings,
): Settings => ({
  ...settings,
  modules: { ...settings.modules, [KEYBOARD_SHORTCUTS_SETTINGS_KEY]: shortcuts },
});

export const hotkeyStateSchema = z.enum([
  'registered',
  'inUse',
  'invalid',
  'unbound',
]) satisfies z.ZodType<HotkeyState>;

/** What `commands.getHotkeys` returns for each bound action (docs/modules/keyboard-shortcuts.md). */
export const hotkeyBindingSchema = z.object({
  action: z.string().min(1),
  chord: z.string().nullable(),
  state: hotkeyStateSchema,
}) satisfies z.ZodType<HotkeyBinding>;

/** The key of the drop actions module's namespace; also its module id. */
export const DROP_ACTIONS_SETTINGS_KEY = 'drop-actions';

/** Mirrors `modules::drop_actions::settings` (docs/modules/drop-actions.md "Behaviour"). */
export const DROP_MAX_FOLDERS = 8;
export const DROP_TILES_PER_ROW = 4;
export const DROP_TILES_PER_ROW_EXPANDED = 8;

export const transferModeSchema = z.enum(['copy', 'move']) satisfies z.ZodType<TransferMode>;

/** A folder tile: copy or move the dropped items into `path`. */
export const dropFolderSchema = z.object({
  id: z.string().min(1),
  /** The tile's title; an empty one reads as the folder's name. */
  name: z.string(),
  path: z.string().min(1),
  mode: transferModeSchema,
}) satisfies z.ZodType<DropFolder>;

/** One tile in the row, in display order (docs/modules/drop-actions.md "Tiles"). */
export const dropTileSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('nearbyShare') }),
  z.object({ kind: z.literal('shelf') }),
  z.object({ kind: z.literal('folder'), id: z.string().min(1) }),
  z.object({ kind: z.literal('copyTo') }),
  z.object({ kind: z.literal('moveTo') }),
  z.object({ kind: z.literal('openWith') }),
  z.object({ kind: z.literal('zip') }),
  z.object({ kind: z.literal('unzip') }),
  z.object({ kind: z.literal('reveal') }),
  z.object({ kind: z.literal('trash') }),
  z.object({ kind: z.literal('eject') }),
  z.object({ kind: z.literal('divider') }),
]) satisfies z.ZodType<DropTile>;

/** Every built-in tile, share and Shelf first and the two destructive ones last; mirrors Rust. */
export const DEFAULT_DROP_TILES: readonly DropTile[] = [
  { kind: 'nearbyShare' },
  { kind: 'shelf' },
  { kind: 'copyTo' },
  { kind: 'moveTo' },
  { kind: 'openWith' },
  { kind: 'zip' },
  { kind: 'unzip' },
  { kind: 'reveal' },
  { kind: 'trash' },
  { kind: 'eject' },
];

/** The last segment of a path as a display name (`C:\Users\me\OneDrive` → `OneDrive`). */
export const dropFolderDisplayName = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/u, '');
  const segment = trimmed.split(/[\\/]/u).pop();
  return segment !== undefined && segment.length > 0 ? segment : path;
};

const sameDropTile = (a: DropTile, b: DropTile): boolean =>
  a.kind !== 'divider' &&
  a.kind === b.kind &&
  (a.kind !== 'folder' || b.kind !== 'folder' || a.id === b.id);

/**
 * The repair Rust applies (`DropActionsSettings::normalised`): folders without a path or with
 * a repeated id go (first wins), the list is capped, unnamed folders take their last path
 * segment; duplicate tiles and folder tiles that point nowhere go, dividers stay, and every
 * folder ends up with a tile.
 */
export const normaliseDropActionsSettings = (value: {
  tiles: readonly DropTile[];
  folders: readonly DropFolder[];
  expandNotch: boolean;
}): { tiles: DropTile[]; folders: DropFolder[]; expandNotch: boolean } => {
  const folders: DropFolder[] = [];
  for (const folder of value.folders) {
    const id = folder.id.trim();
    const path = folder.path.trim();
    if (id.length === 0 || path.length === 0 || folders.some((f) => f.id === id)) continue;
    if (folders.length === DROP_MAX_FOLDERS) break;
    const name = folder.name.trim();
    folders.push({
      id,
      name: name.length > 0 ? name : dropFolderDisplayName(path),
      path,
      mode: folder.mode,
    });
  }
  const tiles: DropTile[] = [];
  for (const tile of value.tiles) {
    if (tile.kind === 'folder' && !folders.some((f) => f.id === tile.id)) continue;
    if (tiles.some((t) => sameDropTile(t, tile))) continue;
    tiles.push(tile);
  }
  for (const folder of folders) {
    if (!tiles.some((t) => t.kind === 'folder' && t.id === folder.id)) {
      tiles.push({ kind: 'folder', id: folder.id });
    }
  }
  return { tiles, folders, expandNotch: value.expandNotch };
};

/**
 * Mirrors `modules::drop_actions::DropActionsSettings`: the row in order, the folders it
 * refers to and whether the notch widens to hold eight tiles per row. A missing entry yields
 * the defaults; a malformed one fails the whole entry.
 */
export const dropActionsSettingsSchema = z
  .object({
    tiles: z.array(dropTileSchema).default([...DEFAULT_DROP_TILES]),
    folders: z.array(dropFolderSchema).default([]),
    expandNotch: z.boolean().default(false),
  })
  .transform(normaliseDropActionsSettings);
export type DropActionsSettings = z.infer<typeof dropActionsSettingsSchema>;

export const defaultDropActionsSettings = (): DropActionsSettings =>
  dropActionsSettingsSchema.parse({});

/** Reads the drop actions namespace; a missing or malformed entry yields the defaults. */
export const readDropActionsSettings = (settings: Settings): DropActionsSettings => {
  const parsed = dropActionsSettingsSchema.safeParse(
    settings.modules[DROP_ACTIONS_SETTINGS_KEY] ?? {},
  );
  return parsed.success ? parsed.data : defaultDropActionsSettings();
};

/** Returns a new document with the drop actions namespace replaced. */
export const writeDropActionsSettings = (
  settings: Settings,
  dropActions: DropActionsSettings,
): Settings => ({
  ...settings,
  modules: { ...settings.modules, [DROP_ACTIONS_SETTINGS_KEY]: dropActions },
});

/** How many tiles fit in one row for these settings. */
export const dropTilesPerRow = (settings: Pick<DropActionsSettings, 'expandNotch'>): number =>
  settings.expandNotch ? DROP_TILES_PER_ROW_EXPANDED : DROP_TILES_PER_ROW;

export const dropFailureSchema = z.enum([
  'cancelled',
  'notFound',
  'unsupported',
  'noArchive',
  'failed',
]) satisfies z.ZodType<DropFailure>;

export const dropJobStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('running'), percent: percent.nullable() }),
  z.object({ kind: z.literal('done') }),
  z.object({ kind: z.literal('failed'), reason: dropFailureSchema }),
]) satisfies z.ZodType<DropJobState>;

/** One action on one drop, as the UI sees it (docs/modules/drop-actions.md). */
export const dropJobSchema = z.object({
  id: z.number().int().min(1),
  action: dropActionKindSchema,
  count: z.number().int().min(0),
  state: dropJobStateSchema,
}) satisfies z.ZodType<DropJob>;

/** What `commands.getDropActionsSnapshot` returns and `events.dropActionsChanged` carries. */
export const dropActionsSnapshotSchema = z.object({
  settings: dropActionsSettingsSchema,
  jobs: z.array(dropJobSchema),
}) satisfies z.ZodType<DropActionsSnapshot>;

export const dropActionsChangedSchema = z.object({
  snapshot: dropActionsSnapshotSchema,
}) satisfies z.ZodType<DropActionsChanged>;

/** The argument of `commands.dropRun`: what the tile the items landed on asks for. */
export const dropActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('share') }),
  z.object({ kind: z.literal('folder'), id: z.string().min(1) }),
  z.object({ kind: z.literal('copyTo'), title: z.string() }),
  z.object({ kind: z.literal('moveTo'), title: z.string() }),
  z.object({ kind: z.literal('openWith') }),
  z.object({ kind: z.literal('zip') }),
  z.object({ kind: z.literal('unzip') }),
  z.object({ kind: z.literal('reveal') }),
  z.object({ kind: z.literal('trash') }),
  z.object({ kind: z.literal('eject') }),
  z.object({ kind: z.literal('shelf') }),
]) satisfies z.ZodType<DropAction>;

/** A dragged item as the UI may know it: its name and kind, never its path. */
export const dropItemSchema = z.object({
  name: z.string(),
  extension: z.string().nullable(),
  isDirectory: z.boolean(),
}) satisfies z.ZodType<DropItem>;

/** A pointer position in the notch window's CSS pixels. */
export const dropPointSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
}) satisfies z.ZodType<DropPoint>;

export const dropEnteredSchema = z.object({
  label: z.string().min(1),
  session: z.number().int().min(1),
  items: z.array(dropItemSchema),
  position: dropPointSchema,
}) satisfies z.ZodType<DropEntered>;

export const dropMovedSchema = z.object({
  label: z.string().min(1),
  session: z.number().int().min(1),
  position: dropPointSchema,
}) satisfies z.ZodType<DropMoved>;

export const dropLeftSchema = z.object({
  label: z.string().min(1),
  session: z.number().int().min(1),
}) satisfies z.ZodType<DropLeft>;

export const droppedSchema = z.object({
  label: z.string().min(1),
  session: z.number().int().min(1),
  position: dropPointSchema,
}) satisfies z.ZodType<Dropped>;

/** What a drag out of the notch carries (docs/modules/shelf.md "Drag out"). */
export const dragOutRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('files'), paths: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('text'), text: z.string().min(1) }),
  z.object({ kind: z.literal('shelf'), ids: z.array(z.string().min(1)).min(1) }),
]) satisfies z.ZodType<DragOutRequest>;

/** The effect the drop target applied to a drag out of Muna. */
export const dropEffectSchema = z.enum(['copy', 'move', 'link']) satisfies z.ZodType<DropEffect>;

export const dragOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dropped'), effect: dropEffectSchema }),
  z.object({ kind: z.literal('cancelled') }),
]) satisfies z.ZodType<DragOutcome>;

/** S2 spike only (docs/spikes/m4-drag.md): the files the UI arms a drag-out of from the strip. */
export const dragSpikeSchema = z.object({
  paths: z.array(z.string().min(1)),
}) satisfies z.ZodType<DragSpike>;

/** The key of the Shelf's namespace; also its module id. */
export const SHELF_SETTINGS_KEY = 'shelf';

/** Bounds the settings pane offers and the module clamps to (mirrors `modules::shelf::settings`). */
export const SHELF_BOUNDS = {
  expiryDays: { min: 0, max: 365 },
} as const;

/** The expiry choices the settings pane offers, in days; `0` keeps items until removed. */
export const SHELF_EXPIRY_CHOICES: readonly number[] = [0, 1, 7, 30];

/** Snippet previews are cut to this many characters before they reach the panel. */
export const SHELF_PREVIEW_CHARS = 240;

/**
 * Mirrors `modules::shelf::ShelfSettings`: defaults for missing fields, a clamped expiry, and
 * a wrong type fails the whole entry, like the Rust side.
 */
export const shelfSettingsSchema = z.object({
  /** Copy dropped files into Shelf storage instead of referencing them. */
  copyIntoStorage: z.boolean().default(false),
  /** Remove items this many days after they arrived; `0` keeps them until removed. */
  expiryDays: clampedInt(SHELF_BOUNDS.expiryDays, 0),
});
export type ShelfSettings = z.infer<typeof shelfSettingsSchema>;

export const defaultShelfSettings = (): ShelfSettings => shelfSettingsSchema.parse({});

/** Reads the Shelf namespace; a missing or malformed entry yields the defaults, like Rust. */
export const readShelfSettings = (settings: Settings): ShelfSettings => {
  const parsed = shelfSettingsSchema.safeParse(settings.modules[SHELF_SETTINGS_KEY] ?? {});
  return parsed.success ? parsed.data : defaultShelfSettings();
};

/** Returns a new document with the Shelf namespace replaced. */
export const writeShelfSettings = (settings: Settings, shelf: ShelfSettings): Settings => ({
  ...settings,
  modules: { ...settings.modules, [SHELF_SETTINGS_KEY]: shelf },
});

export const shelfItemKindSchema = z.enum(['file', 'text']) satisfies z.ZodType<ShelfItemKind>;

/** One Shelf item as the panel sees it: a name and a preview, never a path or the full text. */
export const shelfItemSchema = z.object({
  id: z.string().min(1),
  kind: shelfItemKindSchema,
  name: z.string(),
  extension: z.string().nullable(),
  size: z.number().int().min(0).nullable(),
  isFolder: z.boolean(),
  copied: z.boolean(),
  missing: z.boolean(),
  preview: z.string().max(SHELF_PREVIEW_CHARS).nullable(),
  addedAtMs: z.number().int().min(0),
}) satisfies z.ZodType<ShelfItem>;

/** What `commands.getShelfSnapshot` returns and `events.shelfChanged` carries. */
export const shelfSnapshotSchema = z.object({
  items: z.array(shelfItemSchema),
  settings: shelfSettingsSchema,
}) satisfies z.ZodType<ShelfSnapshot>;

export const shelfChangedSchema = z.object({
  snapshot: shelfSnapshotSchema,
}) satisfies z.ZodType<ShelfChanged>;

/** The argument of `commands.shelfCommand` (docs/modules/shelf.md "Contract"). */
export const shelfCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('addText'), text: z.string().min(1) }),
  z.object({ kind: z.literal('remove'), ids: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('removeMissing') }),
  z.object({ kind: z.literal('clear') }),
  z.object({ kind: z.literal('open'), id: z.string().min(1) }),
  z.object({ kind: z.literal('reveal'), ids: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('copy'), ids: z.array(z.string().min(1)).min(1) }),
]) satisfies z.ZodType<ShelfCommand>;

/** The key of the Window snap namespace; also its module id. */
export const WINDOW_SNAP_SETTINGS_KEY = 'window-snap';

/** Bounds the settings pane offers and the module clamps to (mirrors `modules::window_snap::settings`). */
export const WINDOW_SNAP_BOUNDS = {
  /** Built-in zones and grid cells together never exceed this many tiles. */
  zones: { max: 10 },
  rows: { min: 1, max: 4 },
  cols: { min: 1, max: 4 },
  /** Gutter between grid cells in CSS pixels at 100 %. */
  gap: { min: 0, max: 32 },
} as const;

/** The built-in zones in the order the strip lays them out (mirrors `SnapZone::DEFAULT`). */
export const SNAP_ZONES = [
  'topLeft',
  'bottomLeft',
  'leftHalf',
  'maximize',
  'rightHalf',
  'topRight',
  'bottomRight',
  'leftThird',
  'centerThird',
  'rightThird',
] as const satisfies readonly SnapZone[];

export const snapZoneSchema = z.enum(SNAP_ZONES) satisfies z.ZodType<SnapZone>;

/** A tile the UI asks the module to place into: a built-in zone or a cell of the grid. */
export const snapZoneRefSchema = z.union([
  z.object({ builtIn: snapZoneSchema }),
  z.object({
    cell: z.object({
      row: z
        .number()
        .int()
        .min(0)
        .max(WINDOW_SNAP_BOUNDS.rows.max - 1),
      col: z
        .number()
        .int()
        .min(0)
        .max(WINDOW_SNAP_BOUNDS.cols.max - 1),
    }),
  }),
]) satisfies z.ZodType<SnapZoneRef>;

/**
 * Mirrors `modules::window_snap::SnapGrid::normalised`: rows and columns clamp to 1..=4, the
 * gap to 0..=32, and a grid with more than ten cells loses columns, then rows, until it fits.
 */
export const normaliseSnapGrid = (grid: {
  rows: number;
  cols: number;
  gap: number;
}): { rows: number; cols: number; gap: number } => {
  const clamp = (bounds: { min: number; max: number }, value: number) =>
    Math.min(bounds.max, Math.max(bounds.min, Math.trunc(value)));
  let rows = clamp(WINDOW_SNAP_BOUNDS.rows, grid.rows);
  let cols = clamp(WINDOW_SNAP_BOUNDS.cols, grid.cols);
  while (rows * cols > WINDOW_SNAP_BOUNDS.zones.max) {
    if (cols > rows) {
      cols -= 1;
    } else {
      rows -= 1;
    }
  }
  return { rows, cols, gap: clamp(WINDOW_SNAP_BOUNDS.gap, grid.gap) };
};

export const snapGridSchema = z
  .object({
    rows: z.number().int(),
    cols: z.number().int(),
    gap: z.number().int(),
  })
  .transform(normaliseSnapGrid);
export type SnapGrid = z.infer<typeof snapGridSchema>;

/**
 * Mirrors `modules::window_snap::WindowSnapSettings::normalised`: repeated zones drop, the
 * built-ins are cut so they and the grid cells make at most ten tiles, and no zones at all
 * reads as the defaults. A wrong type fails the whole entry, like the Rust side.
 */
export const normaliseWindowSnapSettings = (value: {
  zones: readonly SnapZone[];
  grid: SnapGrid | null;
}): { zones: SnapZone[]; grid: SnapGrid | null } => {
  const cells = value.grid ? value.grid.rows * value.grid.cols : 0;
  const unique = [...new Set(value.zones)];
  const zones = (unique.length === 0 && !value.grid ? [...SNAP_ZONES] : unique).slice(
    0,
    Math.max(0, WINDOW_SNAP_BOUNDS.zones.max - cells),
  );
  return { zones, grid: value.grid };
};

export const windowSnapSettingsSchema = z
  .object({
    /** Built-in zones the strip offers, in `SNAP_ZONES` order. */
    zones: z.array(snapZoneSchema).default([...SNAP_ZONES]),
    /** An optional grid of equal cells with a gutter; its cells count towards the ten tiles. */
    grid: snapGridSchema.nullable().default(null),
  })
  .transform(normaliseWindowSnapSettings);
export type WindowSnapSettings = z.infer<typeof windowSnapSettingsSchema>;

export const defaultWindowSnapSettings = (): WindowSnapSettings =>
  windowSnapSettingsSchema.parse({});

/** Reads the Window snap namespace; a missing or malformed entry yields the defaults, like Rust. */
export const readWindowSnapSettings = (settings: Settings): WindowSnapSettings => {
  const parsed = windowSnapSettingsSchema.safeParse(
    settings.modules[WINDOW_SNAP_SETTINGS_KEY] ?? {},
  );
  return parsed.success ? parsed.data : defaultWindowSnapSettings();
};

/** Returns a new document with the Window snap namespace replaced. */
export const writeWindowSnapSettings = (
  settings: Settings,
  windowSnap: WindowSnapSettings,
): Settings => ({
  ...settings,
  modules: { ...settings.modules, [WINDOW_SNAP_SETTINGS_KEY]: windowSnap },
});

/** How many tiles the strip shows for `settings`: built-ins plus grid cells. */
export const snapTileCount = (settings: WindowSnapSettings): number =>
  settings.zones.length + (settings.grid ? settings.grid.rows * settings.grid.cols : 0);

export const snapDragMovedSchema = z.object({
  label: z.string().min(1),
  session: z.number().int().min(0),
  position: dropPointSchema,
}) satisfies z.ZodType<SnapDragMoved>;

export const snapDragLeftSchema = z.object({
  label: z.string().min(1),
  session: z.number().int().min(0),
}) satisfies z.ZodType<SnapDragLeft>;

export const snapDragEndedSchema = z.object({
  session: z.number().int().min(0),
  label: z.string().min(1).nullable(),
}) satisfies z.ZodType<SnapDragEnded>;

/** The key of the code-hosting module's namespace; also its module id. */
export const CODE_HOSTING_SETTINGS_KEY = 'code-hosting';

/**
 * How often the module asks the host for the queue once connected, in milliseconds (mirrors
 * `modules::code_hosting::POLL`); the settings pane says so.
 */
export const CODE_HOSTING_POLL_MS = 2 * 60 * 1000;

/** The longest token accepted (mirrors `modules::code_hosting::provider::MAX_TOKEN_CHARS`). */
export const CODE_HOSTING_MAX_TOKEN_CHARS = 255;

/** The credential-vault key the token is kept under (mirrors `modules::code_hosting::TOKEN_KEY`). */
export const CODE_HOSTING_TOKEN_KEY = 'code-hosting.github.token';

/** The strip ids the code-hosting module publishes under (mirrors `modules::code_hosting`). */
export const CODE_HOSTING_STRIP_IDS = {
  /** Review-request notices are `code-hosting:review:<pull request id>`. */
  reviewPrefix: 'code-hosting:review:',
  /** Checks notices are `code-hosting:checks:<pull request id>`. */
  checksPrefix: 'code-hosting:checks:',
} as const;

/**
 * Mirrors `modules::code_hosting::settings::NoticeSettings`: which changes to the queue reach
 * the strip as notices.
 */
export const codeHostingNoticeSettingsSchema = z.object({
  /** A pull request newly asks for the account's review. */
  reviewRequested: z.boolean().default(true),
  /** The checks on one of the account's own pull requests finish, passing or failing. */
  checksFinished: z.boolean().default(true),
});
export type CodeHostingNoticeSettings = z.infer<typeof codeHostingNoticeSettingsSchema>;

/**
 * Mirrors `modules::code_hosting::CodeHostingSettings`: off by default (nothing is sent until
 * the user turns it on and connects), defaults for missing fields, and a wrong type fails the
 * whole entry, like the Rust side. The token itself lives in the credential vault, never here.
 */
export const codeHostingSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  notices: codeHostingNoticeSettingsSchema.prefault({}),
});
export type CodeHostingSettings = z.infer<typeof codeHostingSettingsSchema>;

export const defaultCodeHostingSettings = (): CodeHostingSettings =>
  codeHostingSettingsSchema.parse({});

/** Reads the code-hosting namespace; a missing or malformed entry yields the defaults. */
export const readCodeHostingSettings = (settings: Settings): CodeHostingSettings => {
  const parsed = codeHostingSettingsSchema.safeParse(
    settings.modules[CODE_HOSTING_SETTINGS_KEY] ?? {},
  );
  return parsed.success ? parsed.data : defaultCodeHostingSettings();
};

/** Returns a new document with the code-hosting namespace replaced. */
export const writeCodeHostingSettings = (
  settings: Settings,
  codeHosting: CodeHostingSettings,
): Settings => ({
  ...settings,
  modules: { ...settings.modules, [CODE_HOSTING_SETTINGS_KEY]: codeHosting },
});

export const codeHostProviderSchema = z.enum(['gitHub']) satisfies z.ZodType<Provider>;

export const checksStateSchema = z.enum([
  'none',
  'pending',
  'success',
  'failure',
]) satisfies z.ZodType<ChecksState>;

export const reviewDecisionSchema = z.enum([
  'none',
  'reviewRequired',
  'approved',
  'changesRequested',
]) satisfies z.ZodType<ReviewDecision>;

/** Why a poll or a connect produced no queue; one sentence per case in the UI. */
export const codeHostErrorSchema = z.enum([
  'offline',
  'unauthorized',
  'rateLimited',
  'provider',
]) satisfies z.ZodType<CodeHostError>;

/** The connected account as the settings pane names it. */
export const codeHostAccountSchema = z.object({
  provider: codeHostProviderSchema,
  login: z.string(),
  avatarUrl: z.string().nullable(),
}) satisfies z.ZodType<Account>;

/** One row of the review queue (docs/modules/code-hosting.md "Reference"). */
export const pullRequestSchema = z.object({
  id: z.string().min(1),
  provider: codeHostProviderSchema,
  repo: z.string(),
  number: z.number().int().min(0),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  authorAvatarUrl: z.string().nullable(),
  draft: z.boolean(),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  changedFiles: z.number().int().min(0),
  checks: checksStateSchema,
  reviewDecision: reviewDecisionSchema,
  updatedAtMs: z.number().int().min(0),
  reviewRequested: z.boolean(),
  mine: z.boolean(),
}) satisfies z.ZodType<PullRequest>;

/** What `commands.getCodeHostingSnapshot` returns and `events.codeHostingChanged` carries. */
export const codeHostingSnapshotSchema = z.object({
  enabled: z.boolean(),
  account: codeHostAccountSchema.nullable(),
  pullRequests: z.array(pullRequestSchema),
  fetchedAtMs: z.number().int().min(0).nullable(),
  fetching: z.boolean(),
  error: codeHostErrorSchema.nullable(),
}) satisfies z.ZodType<CodeHostingSnapshot>;

export const codeHostingChangedSchema = z.object({
  snapshot: codeHostingSnapshotSchema,
}) satisfies z.ZodType<CodeHostingChanged>;

/** The argument of `commands.codeHostingCommand`. */
export const codeHostingCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('refresh') }),
]) satisfies z.ZodType<CodeHostingCommand>;

/** The filter chips the panel offers; UI state only, never persisted. */
export const CODE_HOSTING_FILTERS = ['toReview', 'mine', 'all'] as const;
export type CodeHostingFilter = (typeof CODE_HOSTING_FILTERS)[number];

/** The rows of `pullRequests` that `filter` keeps, in the order the module sent them. */
export const filterPullRequests = (
  pullRequests: readonly PullRequest[],
  filter: CodeHostingFilter,
): PullRequest[] => {
  switch (filter) {
    case 'toReview':
      return pullRequests.filter((row) => row.reviewRequested);
    case 'mine':
      return pullRequests.filter((row) => row.mine);
    case 'all':
      return [...pullRequests];
  }
};

/** The key of the notes module's namespace; also its module id. */
export const NOTES_SETTINGS_KEY = 'notes';

/** `Inbox.md`, the note quick capture appends to (mirrors `modules::notes::INBOX_ID`). */
export const NOTES_INBOX_ID = 'Inbox.md';

/**
 * The largest note the editor opens, in bytes (mirrors `modules::notes::MAX_NOTE_BYTES`);
 * bigger ones are listed and opened in their default app.
 */
export const NOTES_MAX_NOTE_BYTES = 2 * 1024 * 1024;

/** How long the editor waits after the last keystroke before it saves, in milliseconds. */
export const NOTES_AUTOSAVE_MS = 600;

/**
 * Mirrors `modules::notes::NotesSettings`: only the folder, `null` being the default
 * (`%APPDATA%\Muna\notes`). Trimmed; blank is `null`. A wrong type fails the whole entry,
 * like the Rust side.
 */
export const notesSettingsSchema = z.object({
  folder: z
    .string()
    .nullable()
    .default(null)
    .transform((folder) => {
      const trimmed = folder?.trim() ?? '';
      return trimmed === '' ? null : trimmed;
    }),
});
export type NotesSettings = z.infer<typeof notesSettingsSchema>;

export const defaultNotesSettings = (): NotesSettings => notesSettingsSchema.parse({});

/** Reads the notes namespace; a missing or malformed entry yields the defaults. */
export const readNotesSettings = (settings: Settings): NotesSettings => {
  const parsed = notesSettingsSchema.safeParse(settings.modules[NOTES_SETTINGS_KEY] ?? {});
  return parsed.success ? parsed.data : defaultNotesSettings();
};

/** Returns a new document with the notes namespace replaced. */
export const writeNotesSettings = (settings: Settings, notes: NotesSettings): Settings => ({
  ...settings,
  modules: { ...settings.modules, [NOTES_SETTINGS_KEY]: notes },
});

/** Why the notes folder could not be listed; `missing` is only ever a folder the user chose. */
export const folderProblemSchema = z.enum([
  'missing',
  'unreadable',
]) satisfies z.ZodType<FolderProblem>;

/** One note as the list shows it: a title, an excerpt, never the body. */
export const noteSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  folder: z.string(),
  excerpt: z.string(),
  modifiedMs: z.number().int().min(0),
  bytes: z.number().int().min(0),
  pinned: z.boolean(),
}) satisfies z.ZodType<Note>;

/** A note as the editor holds it; `modifiedMs` is the baseline a save sends back. */
export const noteContentSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  body: z.string(),
  modifiedMs: z.number().int().min(0),
}) satisfies z.ZodType<NoteContent>;

/** The argument of `commands.notesSave`. */
export const noteDraftSchema = z.object({
  id: z.string().min(1),
  body: z.string(),
  baseModifiedMs: z.number().int().min(0),
}) satisfies z.ZodType<NoteDraft>;

/** What `commands.getNotesSnapshot` returns and `events.notesChanged` carries. */
export const notesSnapshotSchema = z.object({
  folder: z.string(),
  defaultFolder: z.boolean(),
  notes: z.array(noteSchema),
  inboxId: z.string().min(1).nullable(),
  problem: folderProblemSchema.nullable(),
}) satisfies z.ZodType<NotesSnapshot>;

export const notesChangedSchema = z.object({
  snapshot: notesSnapshotSchema,
}) satisfies z.ZodType<NotesChanged>;

/** The argument of `commands.notesCommand`. */
export const notesCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('refresh') }),
  z.object({ kind: z.literal('pin'), id: z.string().min(1), pinned: z.boolean() }),
  z.object({ kind: z.literal('delete'), id: z.string().min(1) }),
]) satisfies z.ZodType<NotesCommand>;

/**
 * The note the widget shows: the first pinned one, else the newest; `null` for an empty
 * folder. The list arrives pinned first, newest first, so it is simply the head.
 */
export const widgetNote = (notes: readonly Note[]): Note | null => notes[0] ?? null;

/** The key of the screen time module's namespace; also its module id. */
export const SCREEN_TIME_SETTINGS_KEY = 'screen-time';

/**
 * Bounds the settings pane offers and the module clamps to (mirrors
 * `modules::screen_time::settings`).
 */
export const SCREEN_TIME_BOUNDS = {
  idleMinutes: { min: 1, max: 60 },
  dayResetHour: { min: 0, max: 23 },
  /** A daily limit in minutes; the pane offers presets, the module accepts any in range. */
  limitMinutes: { min: 5, max: 24 * 60 },
} as const;

/** How many apps the snapshot ranks (mirrors `modules::screen_time::TOP_APPS`). */
export const SCREEN_TIME_TOP_APPS = 20;

/** Days in the week view, today included (mirrors `modules::screen_time::WEEK_DAYS`). */
export const SCREEN_TIME_WEEK_DAYS = 7;

/** The limit presets the app detail offers, in minutes. */
export const SCREEN_TIME_LIMIT_PRESETS = [15, 30, 60, 120, 180, 240] as const;

/**
 * Mirrors `modules::screen_time::ScreenTimeSettings`: defaults for missing fields, clamped
 * ranges, and a wrong type fails the whole entry, like the Rust side.
 */
export const screenTimeSettingsSchema = z.object({
  /** Record at all; off closes the open span and shows the panel's off state. */
  enabled: z.boolean().default(true),
  /** Minutes without input before time stops counting. */
  idleMinutes: clampedInt(SCREEN_TIME_BOUNDS.idleMinutes, 5),
  /** The local hour the day rolls over at (4 = a night owl's day ends at 04:00). */
  dayResetHour: clampedInt(SCREEN_TIME_BOUNDS.dayResetHour, 0),
});
export type ScreenTimeSettings = z.infer<typeof screenTimeSettingsSchema>;

export const defaultScreenTimeSettings = (): ScreenTimeSettings =>
  screenTimeSettingsSchema.parse({});

/** Reads the screen time namespace; a missing or malformed entry yields the defaults. */
export const readScreenTimeSettings = (settings: Settings): ScreenTimeSettings => {
  const parsed = screenTimeSettingsSchema.safeParse(
    settings.modules[SCREEN_TIME_SETTINGS_KEY] ?? {},
  );
  return parsed.success ? parsed.data : defaultScreenTimeSettings();
};

/** Returns a new document with the screen time namespace replaced. */
export const writeScreenTimeSettings = (
  settings: Settings,
  screenTime: ScreenTimeSettings,
): Settings => ({
  ...settings,
  modules: { ...settings.modules, [SCREEN_TIME_SETTINGS_KEY]: screenTime },
});

/** The eight buckets, in legend order (mirrors `AppCategory::ALL`). */
export const APP_CATEGORIES = [
  'browsing',
  'development',
  'communication',
  'media',
  'games',
  'productivity',
  'system',
  'other',
] as const satisfies readonly AppCategory[];

export const appCategorySchema = z.enum(APP_CATEGORIES) satisfies z.ZodType<AppCategory>;

/** Whether time is accruing right now, and if not, why. */
export const trackingSchema = z.enum([
  'active',
  'idle',
  'locked',
  'off',
]) satisfies z.ZodType<Tracking>;

const durationMs = z.number().int().min(0);
const epochMs = z.number().int();

/** The app in the foreground right now, for the *Now* card. */
export const currentAppSchema = z.object({
  exe: z.string().min(1),
  name: z.string(),
  category: appCategorySchema,
  sinceMs: epochMs,
  icon: z.string().nullable(),
}) satisfies z.ZodType<CurrentApp>;

export const dayTotalsSchema = z.object({
  totalMs: durationMs,
  switches: z.number().int().min(0),
  longestMs: durationMs,
  averageMs: durationMs,
}) satisfies z.ZodType<DayTotals>;

/** One row of the app ranking. */
export const appUsageSchema = z.object({
  exe: z.string().min(1),
  name: z.string(),
  category: appCategorySchema,
  totalMs: durationMs,
  sessions: z.number().int().min(0),
  longestMs: durationMs,
  icon: z.string().nullable(),
  limitMinutes: z.number().int().min(1).nullable(),
  limitReached: z.boolean(),
}) satisfies z.ZodType<AppUsage>;

export const categoryUsageSchema = z.object({
  category: appCategorySchema,
  totalMs: durationMs,
}) satisfies z.ZodType<CategoryUsage>;

/** One day of the week view. */
export const dayUsageSchema = z.object({
  dayStartMs: epochMs,
  totalMs: durationMs,
  byCategory: z.array(categoryUsageSchema),
}) satisfies z.ZodType<DayUsage>;

export const excludedAppSchema = z.object({
  exe: z.string().min(1),
  name: z.string(),
}) satisfies z.ZodType<ExcludedApp>;

/** What `commands.getScreenTimeSnapshot` returns and `events.screenTimeChanged` carries. */
export const screenTimeSnapshotSchema = z.object({
  tracking: trackingSchema,
  now: currentAppSchema.nullable(),
  today: dayTotalsSchema,
  apps: z.array(appUsageSchema).max(SCREEN_TIME_TOP_APPS),
  categories: z.array(categoryUsageSchema),
  week: z.array(dayUsageSchema).length(SCREEN_TIME_WEEK_DAYS),
  excluded: z.array(excludedAppSchema),
  dayStartMs: epochMs,
  generatedAtMs: epochMs,
}) satisfies z.ZodType<ScreenTimeSnapshot>;

export const screenTimeChangedSchema = z.object({
  snapshot: screenTimeSnapshotSchema,
}) satisfies z.ZodType<ScreenTimeChanged>;

/** The argument of `commands.screenTimeCommand`. */
export const screenTimeCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('refresh') }),
  z.object({ kind: z.literal('exclude'), exe: z.string().min(1) }),
  z.object({ kind: z.literal('include'), exe: z.string().min(1) }),
  z.object({
    kind: z.literal('setCategory'),
    exe: z.string().min(1),
    category: appCategorySchema.nullable(),
  }),
  z.object({
    kind: z.literal('setLimit'),
    exe: z.string().min(1),
    minutes: z.number().int().min(0).nullable(),
  }),
  z.object({ kind: z.literal('clearHistory') }),
]) satisfies z.ZodType<ScreenTimeCommand>;

/**
 * The share of the day each category took, in legend order, for the donut: every category with
 * time, each at least a hairline so a sliver is still visible. Sums to 1 when there is any time,
 * and is empty otherwise.
 */
export const categoryShares = (
  categories: readonly CategoryUsage[],
): readonly { category: AppCategory; share: number }[] => {
  const total = categories.reduce((sum, entry) => sum + entry.totalMs, 0);
  if (total <= 0) {
    return [];
  }
  return categories
    .filter((entry) => entry.totalMs > 0)
    .map((entry) => ({ category: entry.category, share: entry.totalMs / total }));
};

/**
 * How much of its limit an app has used, 0–1 (clamped); `null` when it has none. The ranking
 * draws it as a track under the bar and switches to the warning tint at 1.
 */
export const limitProgress = (app: Pick<AppUsage, 'totalMs' | 'limitMinutes'>): number | null => {
  if (app.limitMinutes === null || app.limitMinutes <= 0) {
    return null;
  }
  return Math.min(1, app.totalMs / (app.limitMinutes * 60_000));
};

/**
 * The tallest day of the week, so the bars scale to it; at least a minute so an empty week
 * still draws a baseline instead of dividing by zero.
 */
export const weekScaleMs = (week: readonly DayUsage[]): number =>
  Math.max(60_000, ...week.map((day) => day.totalMs));

/** The key of the AI coding module's namespace; also its module id. */
export const AI_CODING_SETTINGS_KEY = 'ai-coding';

/** How many consecutive ports the receiver tries after the configured one. */
export const AI_CODING_PORT_ATTEMPTS = 10;

/** The loopback port the receiver asks for first (mirrors `ai_coding::settings::DEFAULT_PORT`). */
export const AI_CODING_DEFAULT_PORT = 47_391;

/** Mirrors `ai_coding::settings::PORT_RANGE`: no privileged ports, room for the retries. */
export const AI_CODING_BOUNDS = {
  port: { min: 1024, max: 65_535 - AI_CODING_PORT_ATTEMPTS },
} as const;

/** How many finished sessions *Recent* keeps (mirrors `ai_coding::RECENT_MAX`). */
export const AI_CODING_RECENT_MAX = 20;

/** How long a finished session stays in *Recent* (mirrors `ai_coding::RECENT_FOR`). */
export const AI_CODING_RECENT_FOR_MS = 24 * 60 * 60_000;

/**
 * Mirrors `modules::ai_coding::AiCodingSettings`: defaults for missing fields, the port clamped
 * to its range, and a wrong type fails the whole entry, like the Rust side.
 */
export const aiCodingSettingsSchema = z.object({
  /** Watch coding agents at all; off clears the panel and answers hooks with 503. */
  enabled: z.boolean().default(true),
  /** The loopback port the hook receiver binds. */
  port: clampedInt(AI_CODING_BOUNDS.port, AI_CODING_DEFAULT_PORT),
  /** Follow GitHub Copilot CLI sessions from its session-state folder. */
  copilotCli: z.boolean().default(true),
  /** Show a strip notice (with Allow / Deny when offered) when a session stops for the user. */
  waitingNotice: z.boolean().default(true),
});
export type AiCodingSettings = z.infer<typeof aiCodingSettingsSchema>;

export const defaultAiCodingSettings = (): AiCodingSettings => aiCodingSettingsSchema.parse({});

/** Reads the AI coding namespace; a missing or malformed entry yields the defaults. */
export const readAiCodingSettings = (settings: Settings): AiCodingSettings => {
  const parsed = aiCodingSettingsSchema.safeParse(settings.modules[AI_CODING_SETTINGS_KEY] ?? {});
  return parsed.success ? parsed.data : defaultAiCodingSettings();
};

/** Returns a new document with the AI coding namespace replaced. */
export const writeAiCodingSettings = (
  settings: Settings,
  aiCoding: AiCodingSettings,
): Settings => ({
  ...settings,
  modules: { ...settings.modules, [AI_CODING_SETTINGS_KEY]: aiCoding },
});

/** The agents the module knows, in the order the panel's legend lists them. */
export const AI_AGENTS = ['claude', 'copilot', 'generic'] as const satisfies readonly AiAgent[];

export const aiAgentSchema = z.enum(AI_AGENTS) satisfies z.ZodType<AiAgent>;

export const aiStatusSchema = z.enum(['running', 'waiting', 'done']) satisfies z.ZodType<AiStatus>;

export const waitingKindSchema = z.enum([
  'permission',
  'input',
  'idle',
]) satisfies z.ZodType<WaitingKind>;

/** Why a session stopped for the user, and whether Allow / Deny still reach the agent. */
export const aiWaitingSchema = z.object({
  kind: waitingKindSchema,
  tool: z.string().nullable(),
  detail: z.string().nullable(),
  decidable: z.boolean(),
  sinceMs: epochMs,
}) satisfies z.ZodType<AiWaiting>;

/** One session as the panel shows it (docs/modules/ai-coding.md, *Reference*). */
export const aiSessionSchema = z.object({
  id: z.string().min(1),
  agent: aiAgentSchema,
  project: z.string().nullable(),
  branch: z.string().nullable(),
  model: z.string().nullable(),
  status: aiStatusSchema,
  waiting: aiWaitingSchema.nullable(),
  task: z.string().nullable(),
  file: z.string().nullable(),
  startedAtMs: epochMs,
  updatedAtMs: epochMs,
  messages: z.number().int().min(0).nullable(),
  tokens: z.number().int().min(0).nullable(),
  canFocus: z.boolean(),
}) satisfies z.ZodType<AiSession>;

/** The hook receiver as the settings pane shows it. */
export const receiverStateSchema = z.object({
  port: z.number().int().min(1).max(65_535),
  listening: z.boolean(),
  hookUrl: z.string().min(1),
  claudeHooksInstalled: z.boolean(),
}) satisfies z.ZodType<ReceiverState>;

/** What `commands.getAiCodingSnapshot` returns and `events.aiCodingChanged` carries. */
export const aiCodingSnapshotSchema = z.object({
  enabled: z.boolean(),
  sessions: z.array(aiSessionSchema),
  recent: z.array(aiSessionSchema).max(AI_CODING_RECENT_MAX),
  receiver: receiverStateSchema,
  generatedAtMs: epochMs,
}) satisfies z.ZodType<AiCodingSnapshot>;

export const aiCodingChangedSchema = z.object({
  snapshot: aiCodingSnapshotSchema,
}) satisfies z.ZodType<AiCodingChanged>;

/** The argument of `commands.aiCodingCommand`. */
export const aiCodingCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('refresh') }),
  z.object({ kind: z.literal('allow'), session: z.string().min(1) }),
  z.object({ kind: z.literal('deny'), session: z.string().min(1) }),
  z.object({ kind: z.literal('focus'), session: z.string().min(1) }),
  z.object({ kind: z.literal('dismiss'), session: z.string().min(1) }),
  z.object({ kind: z.literal('installClaudeHooks') }),
  z.object({ kind: z.literal('removeClaudeHooks') }),
]) satisfies z.ZodType<AiCodingCommand>;

/**
 * The sessions that want the user right now, decidable first, in the snapshot's order: what
 * the widget counts and the panel pins to the top.
 */
export const waitingSessions = (sessions: readonly AiSession[]): readonly AiSession[] =>
  sessions.filter((session) => session.status === 'waiting');

/** The sessions still working, in the snapshot's order. */
export const runningSessions = (sessions: readonly AiSession[]): readonly AiSession[] =>
  sessions.filter((session) => session.status === 'running');
