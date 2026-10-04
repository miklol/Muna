import type { AiCodingCommand, AiCodingSnapshot } from '@muna/contracts';
import { writeAiCodingSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import { type IpcHandlers, type MunaStoryParameters, refuse } from '../../storybook/ipc';
import { useAiCodingStore } from './ai-coding-store';
import { emptySnapshot, hooksMissingSnapshot, offSnapshot } from './sample-snapshot';
import { AiCodingSettingsPane } from './settings';

/**
 * A fake `ai-coding` service for the pane: installing and removing the Claude Code hooks flips
 * the receiver's flag; pass `hooksFile: true` to make the write fail the way a hand-edited,
 * invalid settings file does.
 */
const aiCodingService = (initial: AiCodingSnapshot, hooksFile = false): IpcHandlers => {
  let current = initial;
  return {
    get_ai_coding_snapshot: () => current,
    ai_coding_watch: () => null,
    ai_coding_command: (args) => {
      const { command } = args as { command: AiCodingCommand };
      if (command.kind === 'installClaudeHooks' || command.kind === 'removeClaudeHooks') {
        if (hooksFile) {
          return refuse('aiCoding.hooksFile', 'settings.json is not valid JSON');
        }
        current = {
          ...current,
          receiver: {
            ...current.receiver,
            claudeHooksInstalled: command.kind === 'installClaudeHooks',
          },
        };
      }
      return current;
    },
  };
};

const meta = {
  title: 'Modules/AI coding/Settings pane',
  component: AiCodingSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: aiCodingService(hooksMissingSnapshot),
    settings: (base) =>
      writeAiCodingSettings(base, {
        enabled: true,
        port: 47_391,
        copilotCli: true,
        waitingNotice: true,
      }),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="aiCoding.title">
      <AiCodingSettingsPane />
    </SettingsPaneFrame>
  ),
  beforeEach: () => {
    useAiCodingStore.setState({ snapshot: null, receivedAt: 0 });
  },
} satisfies Meta<typeof AiCodingSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A fresh install: on, the receiver listening on the default port, hooks still to install. */
export const Default: Story = {};

/** The hooks are in: the row says so and offers to remove them. */
export const HooksInstalled: Story = {
  parameters: { ipc: aiCodingService(emptySnapshot) } satisfies MunaStoryParameters,
};

/** Off: the receiver is stopped and the hooks button waits for the switch. */
export const Off: Story = {
  parameters: {
    ipc: aiCodingService(offSnapshot),
    settings: (base) =>
      writeAiCodingSettings(base, {
        enabled: false,
        port: 47_391,
        copilotCli: true,
        waitingNotice: true,
      }),
  } satisfies MunaStoryParameters,
};

/** *Install hooks* writes them through Rust; the row confirms and flips to *Remove hooks*. */
export const Installing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Install hooks' }));
    await expect(await canvas.findByText(/Hooks installed\./)).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Remove hooks' })).toBeVisible();
  },
};

/** Claude Code's settings file is not valid JSON: the row says so and nothing changes. */
export const HooksRefused: Story = {
  parameters: {
    ipc: aiCodingService(hooksMissingSnapshot, true),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Install hooks' }));
    await expect(await canvas.findByText(/could not be changed/)).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Install hooks' })).toBeVisible();
  },
};

/** A port outside the range is dropped on blur; a valid one is saved and shown. */
export const ChangingThePort: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = await canvas.findByLabelText('Port');
    await userEvent.clear(field);
    await userEvent.type(field, '80');
    await userEvent.tab();
    await expect(field).toHaveValue('47391');
    await userEvent.clear(field);
    await userEvent.type(field, '5005{enter}');
    await expect(field).toHaveValue('5005');
  },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};

/** The mirrored-English pseudo-locale (ar-XB): longer strings, right-to-left layout. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
