import { commands, type PomodoroCommand, type PomodoroStatus } from '@muna/contracts';
import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { PomodoroPanel } from './panel';
import { PomodoroWidget } from './widget';
import { PomodoroIcon } from './pomodoro-icon';

/** Settings → Pomodoro loads on first visit so the notch bundle stays small. */
const PomodoroSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.PomodoroSettingsPane })),
);

/** What "start or pause" means for each timer state: idle starts, running pauses, paused resumes. */
export const toggleCommand = (status: PomodoroStatus): PomodoroCommand => {
  switch (status) {
    case 'idle':
      return { kind: 'start', phase: null };
    case 'running':
      return { kind: 'pause' };
    case 'paused':
      return { kind: 'resume' };
  }
};

/**
 * The pomodoro module's frontend half (docs/modules/pomodoro.md; ADR-0004). Its Rust half is
 * `src-tauri/src/modules/pomodoro`; the id is the settings namespace both sides read. Its one
 * action, "Start or pause the timer", works without opening the notch (keyboard-shortcuts).
 */
export const pomodoroModule: ModuleDefinition = {
  id: 'pomodoro',
  titleKey: 'pomodoro.title',
  icon: PomodoroIcon,
  panel: PomodoroPanel,
  widget: PomodoroWidget,
  settings: PomodoroSettings,
  actions: [
    {
      id: 'pomodoro.toggle',
      labelKey: 'pomodoro.actions.toggle',
      run: () => {
        void commands
          .getPomodoroSnapshot()
          .then((state) => commands.pomodoroCommand(toggleCommand(state.status)))
          .catch(() => {
            // Not running inside Tauri: nothing to drive.
          });
      },
    },
  ],
};
