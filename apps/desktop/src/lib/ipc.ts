import type { IpcError, Result } from '@muna/contracts';

/** Thrown when a command returns `{ status: 'error' }`; carries the stable error code. */
export class IpcFailure extends Error {
  readonly code: string;

  constructor(error: IpcError) {
    super(error.message);
    this.name = 'IpcFailure';
    this.code = error.code;
  }
}

/** Unwraps a tauri-specta `Result` so TanStack Query sees a plain value or a thrown error. */
export const unwrap = <T>(result: Result<T, IpcError>): T => {
  if (result.status === 'ok') {
    return result.data;
  }
  throw new IpcFailure(result.error);
};
