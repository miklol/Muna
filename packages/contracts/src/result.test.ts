import { describe, expectTypeOf, it } from 'vitest';

import type { IpcError, Settings, commands } from './bindings';
import type { Result } from './result';

describe('Result', () => {
  it('matches the union tauri-specta inlines for fallible commands', () => {
    expectTypeOf<Awaited<ReturnType<typeof commands.updateSettings>>>().toEqualTypeOf<
      Result<Settings, IpcError>
    >();
  });

  it('infallible commands resolve to the bare value', () => {
    expectTypeOf<Awaited<ReturnType<typeof commands.getSettings>>>().toEqualTypeOf<Settings>();
  });
});
