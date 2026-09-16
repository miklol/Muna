/**
 * Zod schemas for values that cross a trust boundary (settings file, IPC payloads from the
 * UI). Shapes mirror the specta-generated types in ./bindings.ts; `schemas.test.ts` asserts
 * they never drift.
 */
import { z } from 'zod';

import type {
  JsonValue,
  MonitorLayout,
  NotchShape,
  PlacementMode,
  ReducedMotion,
  Settings,
  ShellLayout,
  ShellSettings,
  StripContent,
  StripHeight,
  YieldState,
} from './bindings';

export const SETTINGS_VERSION = 2;

/** Default toggle hotkey (`tauri-plugin-global-shortcut` syntax); mirrors `ShellSettings::default`. */
export const DEFAULT_TOGGLE_HOTKEY = 'ctrl+alt+space';

/** Strip height presets in CSS px (docs/modules/notch-shell.md, "Settings"). */
export const STRIP_HEIGHT_PX: Readonly<Record<StripHeight, number>> = {
  compact: 26,
  default: 32,
  comfortable: 38,
};

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

export const activitySchema = z.object({
  id: z.string().min(1),
  module: z.string().min(1),
  priority: z.number().int().min(0).max(100),
  leading: z.string().nullable(),
  trailing: z.string().nullable(),
  wideText: z.string().nullable(),
});

export const noticeSchema = z.object({
  id: z.string().min(1),
  module: z.string().min(1),
  priority: z.number().int().min(0).max(100),
  text: z.string(),
  holdMs: z.number().int().min(0),
});

export const stripContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('idle') }),
  z.object({ kind: z.literal('activity'), activity: activitySchema }),
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
});

export const defaultSettings = (): Settings => ({
  version: SETTINGS_VERSION,
  general: { launchAtLogin: false, reducedMotion: 'system', accent: 'blue' },
  shell: defaultShellSettings(),
  modules: {},
});
