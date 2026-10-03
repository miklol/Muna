import type { HotkeyBinding } from '@muna/contracts';
import {
  readKeyboardShortcutsSettings,
  SHELL_ACTION_IDS,
  shellOpenModuleActionId,
  writeKeyboardShortcutsSettings,
} from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import { type IpcHandlers, type MunaStoryParameters, refuse } from '../../storybook/ipc';
import { KeyboardShortcutsSettingsPane } from './settings';

const bound: readonly HotkeyBinding[] = [
  { action: SHELL_ACTION_IDS.togglePanel, chord: 'ctrl+alt+space', state: 'registered' },
  { action: SHELL_ACTION_IDS.palette, chord: 'ctrl+shift+space', state: 'registered' },
  { action: SHELL_ACTION_IDS.snooze, chord: 'ctrl+alt+n', state: 'registered' },
  { action: shellOpenModuleActionId(1), chord: 'ctrl+alt+1', state: 'registered' },
  { action: 'todo.quickAdd', chord: 'ctrl+alt+t', state: 'registered' },
  { action: 'media.playPause', chord: 'ctrl+alt+p', state: 'registered' },
];

/**
 * A fake `keyboard_shortcuts` service: binds whatever the recorder sends unless the chord is
 * in `held`, in which case the OS "already holds it" and the old binding stays, like Rust.
 */
const hotkeyService = (
  initial: readonly HotkeyBinding[],
  held: readonly string[] = [],
): IpcHandlers => {
  let bindings = [...initial];
  const without = (action: string) => bindings.filter((binding) => binding.action !== action);
  return {
    get_hotkeys: () => bindings,
    set_hotkey: (args) => {
      const { action, chord } = args as { action: string; chord: string };
      if (held.includes(chord)) {
        return refuse('hotkey.inUse', `${chord} is held by another app`);
      }
      const taken = bindings.find(
        (binding) => binding.chord === chord && binding.action !== action,
      );
      if (taken !== undefined) {
        return refuse('hotkey.taken', `${chord} is bound to ${taken.action}`);
      }
      bindings = [...without(action), { action, chord, state: 'registered' }];
      return bindings;
    },
    clear_hotkey: (args) => {
      const { action } = args as { action: string };
      bindings = without(action);
      return bindings;
    },
  };
};

const meta = {
  title: 'Modules/Keyboard shortcuts/Settings pane',
  component: KeyboardShortcutsSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: hotkeyService(bound),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="shortcuts.title">
      <KeyboardShortcutsSettingsPane />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof KeyboardShortcutsSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The shell's actions, the open-by-number rows, each module's actions and the two options. */
export const Default: Story = {};

/** A fresh install before anything is recorded. */
export const NothingSet: Story = {
  parameters: { ipc: hotkeyService([]) } satisfies MunaStoryParameters,
};

/** Chords Windows refused at start-up stay in the file and are flagged beside the row. */
export const RefusedByWindows: Story = {
  parameters: {
    ipc: hotkeyService([
      ...bound.filter((binding) => binding.action !== SHELL_ACTION_IDS.palette),
      { action: SHELL_ACTION_IDS.palette, chord: 'ctrl+shift+space', state: 'inUse' },
    ]),
  } satisfies MunaStoryParameters,
};

/** Pressing a recorder arms it: the caps give way to the prompt until a chord or Esc. */
export const Recording: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Shortcut for Snooze the notch' }));
    await expect(canvas.getByText('Press a shortcut')).toBeVisible();
  },
};

/** The OS holds the recorded chord: the refusal shows and the old binding stays. */
export const ChordInUse: Story = {
  parameters: { ipc: hotkeyService(bound, ['ctrl+alt+m']) } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Shortcut for Snooze the notch' }));
    await userEvent.keyboard('{Control>}{Alt>}m{/Alt}{/Control}');
    await expect(await canvas.findByRole('status')).toHaveTextContent(/another app/i);
  },
};

/** Options come from the settings document: snooze at one hour, only while hovering on. */
export const OptionsChanged: Story = {
  parameters: {
    settings: (base) =>
      writeKeyboardShortcutsSettings(base, {
        ...readKeyboardShortcutsSettings(base),
        onlyWhileHovering: true,
        snoozeMinutes: 60,
      }),
  } satisfies MunaStoryParameters,
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
