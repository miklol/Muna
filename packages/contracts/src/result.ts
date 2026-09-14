/**
 * Shape every fallible command resolves to. tauri-specta inlines this union in `bindings.ts`
 * (`typedError`) instead of exporting it; `result.test.ts` asserts the two never drift.
 */
export type Result<T, E> = { status: 'ok'; data: T } | { status: 'error'; error: E };
