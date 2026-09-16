import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

/** Label of the config window declared in tauri.conf.json (`ShellModel::PRIMARY_LABEL`). */
export const PRIMARY_NOTCH_LABEL = 'notch';

/**
 * Label of the window this UI runs in. Shell events are broadcast to every window with the
 * target label in the payload, so each notch filters on its own. Outside Tauri (tests,
 * Storybook) the primary label is assumed.
 */
export const currentWindowLabel = (): string => {
  try {
    return getCurrentWebviewWindow().label;
  } catch {
    return PRIMARY_NOTCH_LABEL;
  }
};
