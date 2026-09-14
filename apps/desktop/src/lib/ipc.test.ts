import { describe, expect, it } from 'vitest';

import { IpcFailure, unwrap } from './ipc';

describe('unwrap', () => {
  it('returns the data of an ok result', () => {
    expect(unwrap({ status: 'ok', data: 42 })).toBe(42);
  });

  it('throws an IpcFailure carrying the code for an error result', () => {
    expect(() =>
      unwrap({ status: 'error', error: { code: 'settings.io', message: 'disk full' } }),
    ).toThrow(IpcFailure);
    try {
      unwrap({ status: 'error', error: { code: 'settings.io', message: 'disk full' } });
    } catch (error) {
      expect(error).toBeInstanceOf(IpcFailure);
      expect((error as IpcFailure).code).toBe('settings.io');
      expect((error as IpcFailure).message).toBe('disk full');
    }
  });
});
