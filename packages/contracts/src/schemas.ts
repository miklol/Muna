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
  PlacementMode,
  ReducedMotion,
  Settings,
  ShellLayout,
  ShellSettings,
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
]) satisfies z.ZodType<Trailing>;

export const stripMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string() }),
  z.object({ kind: z.literal('batteryLow'), percent }),
  z.object({
    kind: z.literal('bluetoothConnected'),
    name: z.string(),
    batteryPercent: percent.nullable(),
  }),
  z.object({ kind: z.literal('bluetoothDisconnected'), name: z.string() }),
  z.object({ kind: z.literal('timerFinished'), label: z.string() }),
  z.object({ kind: z.literal('nowPlaying'), title: z.string(), artist: z.string() }),
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
