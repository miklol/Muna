/**
 * Zod schemas for values that cross a trust boundary (settings file, IPC payloads from the
 * UI). Shapes mirror the specta-generated types in ./bindings.ts; `schemas.test.ts` asserts
 * they never drift.
 */
import { z } from 'zod';

import type {
  Activity,
  Glyph,
  JsonValue,
  Leading,
  MonitorLayout,
  NotchShape,
  Notice,
  Place,
  PlacementMode,
  PomodoroPhase,
  ReducedMotion,
  Settings,
  ShellLayout,
  ShellSettings,
  SourceSetting,
  StripContent,
  StripHeight,
  StripMessage,
  Tint,
  Trailing,
  YieldState,
} from './bindings';

export const SETTINGS_VERSION = 4;

/** Default toggle hotkey (`tauri-plugin-global-shortcut` syntax); mirrors `ShellSettings::default`. */
export const DEFAULT_TOGGLE_HOTKEY = 'ctrl+alt+space';

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
  toggleHotkey: z.string().min(1),
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
]) satisfies z.ZodType<Glyph>;

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
  toggleHotkey: DEFAULT_TOGGLE_HOTKEY,
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
