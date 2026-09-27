import type { AppInfo, IpcError, Settings } from '@muna/contracts';
import { defaultSettings } from '@muna/contracts';
import type { InvokeArgs } from '@tauri-apps/api/core';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';

/**
 * A fake Tauri command: receives the invoke payload the bindings built and returns what Rust
 * would (or a promise of it). Call `refuse(code, message)` to make a `typedError` command
 * resolve with `status: 'error'`, exactly as the real IPC does.
 */
export type IpcHandler = (args: InvokeArgs | undefined) => unknown;

export type IpcHandlers = Readonly<Record<string, IpcHandler>>;

export type StoryWindow = 'notch' | 'settings';

/** `parameters` a desktop story may set; the preview reads them before the story renders. */
export interface MunaStoryParameters {
  /** Which window's stylesheet and label apply; `notch` unless a story says otherwise. */
  window?: StoryWindow;
  /** The settings document Rust would return; a recipe receives `defaultSettings()`. */
  settings?: Settings | ((base: Settings) => Settings);
  /** Fake commands by name (the snake_case string the bindings invoke), over the defaults. */
  ipc?: IpcHandlers;
}

class FakeIpcError implements IpcError {
  constructor(
    readonly code: string,
    readonly message: string,
  ) {}
}

/**
 * Fails a fake command the way Rust does: the rejection value is the `IpcError` document, not
 * an `Error`, so the bindings' `typedError` wrapper resolves with `status: 'error'`.
 */
export const refuse = (code: string, message: string): never => {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- mirrors the real IPC contract
  throw new FakeIpcError(code, message);
};

const resolveSettings = (parameter: MunaStoryParameters['settings']): Settings => {
  const base = defaultSettings();
  if (parameter === undefined) return base;
  return typeof parameter === 'function' ? parameter(base) : parameter;
};

/** What `app_info` answers in a story: a dev build on a US-English machine. */
export const storyAppInfo: AppInfo = {
  name: 'Muna',
  version: '0.0.0-storybook',
  platform: 'storybook',
  profileDir: 'C:\\Users\\you\\AppData\\Local\\Muna',
  regionFormat: 'en-US',
};

/**
 * Installs the fake IPC for one story: the settings document round-trips through
 * `get_settings`/`update_settings`, `app_info` describes a dev build, the log plugin is
 * silenced, events are routed in-page so a story can `emit()` to whatever the component
 * listens for, and every other command goes to the story's handlers. Anything left unmocked
 * rejects loudly instead of hanging.
 */
export function installStoryIpc(parameters: MunaStoryParameters): Settings {
  clearMocks();
  let settings = resolveSettings(parameters.settings);
  const handlers: IpcHandlers = {
    get_settings: () => settings,
    update_settings: (args) => {
      settings = (args as { settings: Settings }).settings;
      return settings;
    },
    app_info: () => storyAppInfo,
    'plugin:log|log': () => undefined,
    ...parameters.ipc,
  };
  mockWindows(parameters.window ?? 'notch');
  mockIPC(
    (cmd, args) => {
      const handler = handlers[cmd];
      if (handler === undefined) {
        console.warn(`[muna storybook] unmocked command: ${cmd}`);
        return refuse(
          'storybook.unmocked',
          `No story handler for the "${cmd}" command; add it under parameters.ipc.`,
        );
      }
      return handler(args);
    },
    { shouldMockEvents: true },
  );
  return settings;
}
