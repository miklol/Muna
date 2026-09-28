import type { AiCodingCommand, AiCodingSnapshot } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import { type IpcHandlers, type MunaStoryParameters, refuse } from '../../storybook/ipc';
import { useAiCodingStore } from './ai-coding-store';
import { AiCodingPanel } from './panel';
import {
  claudeWaiting,
  copilotRunning,
  emptySnapshot,
  hooksMissingSnapshot,
  offSnapshot,
  sampleSnapshot,
} from './sample-snapshot';

/**
 * A fake `ai-coding` service: the snapshot in memory; *Allow* / *Deny* turn the held session
 * back into a running one, *Dismiss* drops a session, *Refresh* leaves things as they are.
 */
const aiCodingService = (initial: AiCodingSnapshot): IpcHandlers => {
  let current = initial;
  return {
    get_ai_coding_snapshot: () => current,
    ai_coding_watch: () => null,
    ai_coding_command: (args) => {
      const { command } = args as { command: AiCodingCommand };
      switch (command.kind) {
        case 'allow':
        case 'deny': {
          const held = current.sessions.find((session) => session.id === command.session);
          if (held?.waiting?.decidable !== true) {
            return refuse('aiCoding.notWaiting', 'the session is not waiting any more');
          }
          current = {
            ...current,
            sessions: current.sessions.map((session) =>
              session.id === command.session
                ? {
                    ...session,
                    status: 'running',
                    waiting: null,
                    updatedAtMs: current.generatedAtMs,
                  }
                : session,
            ),
          };
          return current;
        }
        case 'dismiss':
          current = {
            ...current,
            sessions: current.sessions.filter((session) => session.id !== command.session),
            recent: current.recent.filter((session) => session.id !== command.session),
          };
          return current;
        default:
          return current;
      }
    },
    open_settings: () => null,
  };
};

const meta = {
  title: 'Modules/AI coding/Panel',
  component: AiCodingPanel,
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: aiCodingService(sampleSnapshot),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="AI coding">
      <AiCodingPanel />
    </PanelFrame>
  ),
  beforeEach: () => {
    useAiCodingStore.setState({ snapshot: null, receivedAt: 0 });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof AiCodingPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Two Claude Code sessions and a Copilot CLI one: the first holds a permission prompt with its
 * *Allow* / *Deny* pair, the second waits for a prompt, the third works; one finished session
 * under *Recent*.
 */
export const Default: Story = {};

/** *Allow* answers the held prompt: the pair goes, the row turns green, the counts follow. */
export const Allowing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pair = await canvas.findByRole('group', { name: 'Allow or deny' });
    await userEvent.click(within(pair).getByRole('button', { name: 'Allow' }));
    await waitFor(async () => {
      await expect(canvas.queryByRole('group', { name: 'Allow or deny' })).toBeNull();
      await expect(canvas.getByText('3 active · 1 waiting')).toBeVisible();
    });
  },
};

/** Only agents at work: no pair, no dismiss, *Show* where the terminal is known. */
export const AllRunning: Story = {
  parameters: {
    ipc: aiCodingService({
      ...sampleSnapshot,
      sessions: [{ ...claudeWaiting, status: 'running', waiting: null }, copilotRunning],
      recent: [],
    }),
  } satisfies MunaStoryParameters,
};

/** Nothing runs and the hooks are in: the panel says what would bring a row here. */
export const NoAgents: Story = {
  parameters: { ipc: aiCodingService(emptySnapshot) } satisfies MunaStoryParameters,
};

/** A fresh install: nothing runs and Claude Code has no hooks yet, so the panel points at Settings. */
export const HooksMissing: Story = {
  parameters: { ipc: aiCodingService(hooksMissingSnapshot) } satisfies MunaStoryParameters,
};

/** The module is off: the panel says where to turn it on. */
export const Off: Story = {
  parameters: { ipc: aiCodingService(offSnapshot) } satisfies MunaStoryParameters,
};

/** Long projects, tasks and commands end in an ellipsis; the list scrolls inside the panel. */
export const LongContent: Story = {
  parameters: {
    ipc: aiCodingService({
      ...sampleSnapshot,
      sessions: Array.from({ length: 8 }, (_, index) => ({
        ...(index % 2 === 0 ? claudeWaiting : copilotRunning),
        id: `session:${String(index)}`,
        project: `a-repository-with-a-very-long-name-that-keeps-going-${String(index + 1)}`,
        branch: 'feature/an-equally-long-branch-name-for-the-meta-line',
        task: 'Refactor the whole settings surface so every module pane reads its own namespace and nothing else, then write the tests',
        waiting:
          index % 2 === 0
            ? {
                kind: 'permission',
                tool: 'Bash',
                detail:
                  'pnpm --filter @muna/desktop exec vitest run src/modules --reporter=dot --coverage',
                decidable: true,
                sinceMs: sampleSnapshot.generatedAtMs - 5000 * (index + 1),
              }
            : null,
      })),
    }),
  } satisfies MunaStoryParameters,
};

export const RTL: Story = {
  globals: { direction: 'rtl' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};

/** The mirrored-English pseudo-locale (ar-XB): longer strings, right-to-left layout. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
