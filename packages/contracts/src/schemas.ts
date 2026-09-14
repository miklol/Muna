/**
 * Zod schemas for values that cross a trust boundary (settings file, IPC payloads from the
 * UI). Shapes mirror the specta-generated types in ./bindings.ts; `schemas.test.ts` asserts
 * they never drift.
 */
import { z } from 'zod';

import type { JsonValue, ReducedMotion, Settings, StripContent } from './bindings';

export const SETTINGS_VERSION = 1;

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

export const defaultSettings = (): Settings => ({
  version: SETTINGS_VERSION,
  general: { launchAtLogin: false, reducedMotion: 'system', accent: 'blue' },
  modules: {},
});
