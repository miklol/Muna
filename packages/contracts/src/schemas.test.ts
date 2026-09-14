import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { Settings, StripContent } from './bindings';
import { defaultSettings, settingsSchema, stripContentSchema } from './schemas';

describe('settings schema', () => {
  it('accepts the default settings and round-trips them unchanged', () => {
    const settings = defaultSettings();
    expect(settingsSchema.parse(settings)).toEqual(settings);
  });

  it('rejects unknown schema versions (migrations run in Rust before parsing)', () => {
    expect(settingsSchema.safeParse({ ...defaultSettings(), version: 99 }).success).toBe(false);
  });

  it('accepts nested JSON in module namespaces', () => {
    const settings: Settings = {
      ...defaultSettings(),
      modules: { media: { showArtwork: true, sources: ['spotify', null, 3] } },
    };
    expect(settingsSchema.parse(settings)).toEqual(settings);
  });

  it('matches the specta-generated type exactly', () => {
    expectTypeOf<z.infer<typeof settingsSchema>>().toEqualTypeOf<Settings>();
  });
});

describe('strip content schema', () => {
  it('parses every variant', () => {
    const cases: StripContent[] = [
      { kind: 'idle' },
      {
        kind: 'activity',
        activity: {
          id: 'a1',
          module: 'media',
          priority: 60,
          leading: 'image',
          trailing: 'visualizer',
          wideText: null,
        },
      },
      {
        kind: 'notice',
        notice: {
          id: 'n1',
          module: 'bluetooth',
          priority: 80,
          text: 'AirPods connected',
          holdMs: 4000,
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
