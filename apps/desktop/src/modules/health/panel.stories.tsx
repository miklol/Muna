import type { HealthCommand, HealthFlow, HealthSnapshot } from '@muna/contracts';
import { writeHealthSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { MINUTE_MS } from './format';
import { useHealthStore } from './health-store';
import { HealthPanel } from './panel';
import { emptySnapshot, SAMPLE_NOW_MS, sampleSnapshot } from './sample-snapshot';

/** The flow lengths Rust uses, box breathing for the default pattern. */
const FLOW_TOTAL_MS: Readonly<Record<HealthFlow, number>> = {
  move: 180_000,
  breathe: 128_000,
  stretch: 120_000,
  eyeRest: 20_000,
};

const running = (
  flow: HealthFlow,
  remainingMs = FLOW_TOTAL_MS[flow],
  pattern: 'box' | 'relax' = 'box',
): HealthSnapshot['flow'] => ({
  flow,
  startedMs: Date.now() - (FLOW_TOTAL_MS[flow] - remainingMs),
  remainingMs,
  totalMs: pattern === 'relax' && flow === 'breathe' ? 114_000 : FLOW_TOTAL_MS[flow],
  pattern,
});

/**
 * A fake health tracker for the panel. Commands answer with the same snapshot changed the way
 * Rust would change it: a flow starts or stops, water moves by the delta, snooze pushes the
 * reminder ten minutes out, dismiss clears it.
 */
const healthService = (initial: HealthSnapshot): IpcHandlers => {
  let current = initial;
  return {
    get_health_snapshot: () => current,
    health_command: (args) => {
      const { command } = args as { command: HealthCommand };
      switch (command.kind) {
        case 'startFlow':
          current = {
            ...current,
            breakDueSinceMs: null,
            nextBreakInMs: null,
            flow: running(command.flow),
          };
          break;
        case 'stopFlow':
          current = {
            ...current,
            flow: null,
            nextBreakInMs: current.sitting === 'sitting' ? 50 * MINUTE_MS : null,
          };
          break;
        case 'water':
          current = {
            ...current,
            today: {
              ...current.today,
              water: Math.max(0, current.today.water + command.delta),
            },
          };
          break;
        case 'snooze':
          current = { ...current, breakDueSinceMs: null, nextBreakInMs: 10 * MINUTE_MS };
          break;
        case 'dismiss':
          current = { ...current, breakDueSinceMs: null, nextBreakInMs: 50 * MINUTE_MS };
          break;
        case 'reset':
          current = {
            ...current,
            today: { ...current.today, breaks: 0, water: 0, mindfulSeconds: 0 },
          };
          break;
        case 'clearHistory':
          break;
      }
      return current;
    },
    open_settings: () => null,
  };
};

const meta = {
  title: 'Modules/Health/Panel',
  component: HealthPanel,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: healthService(sampleSnapshot()),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Health">
      <HealthPanel />
    </PanelFrame>
  ),
  beforeEach: () => {
    useHealthStore.setState({ snapshot: null, receivedAt: 0 });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof HealthPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A Tuesday afternoon, 34 minutes into a sit: today's facts, the rings and the four flows. */
export const Default: Story = {};

/** The reminder is up: the flows lead with *Time for a break*, snooze and dismiss. */
export const BreakDue: Story = {
  parameters: {
    ipc: healthService(
      sampleSnapshot({
        sittingMs: 52 * MINUTE_MS,
        nextBreakInMs: null,
        breakDueSinceMs: SAMPLE_NOW_MS - 2 * MINUTE_MS,
      }),
    ),
  } satisfies MunaStoryParameters,
};

/** Starting *Move* from its card: the panel pins itself and counts three minutes down. */
export const Move: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Start Move' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: 'Stop' })).toBeVisible();
    });
  },
};

/** Box breathing: the circle grows on the in-breath, holds, shrinks on the out-breath. */
export const Breathe: Story = {
  parameters: {
    ipc: healthService(sampleSnapshot({ nextBreakInMs: null, flow: running('breathe') })),
  } satisfies MunaStoryParameters,
};

/** The relax pattern (4-7-8) from Settings: six rounds, a long slow exhale. */
export const BreatheRelax: Story = {
  parameters: {
    ipc: healthService(
      sampleSnapshot({ nextBreakInMs: null, flow: running('breathe', 114_000, 'relax') }),
    ),
    settings: (base) =>
      writeHealthSettings(base, {
        enabled: true,
        breakEveryMin: 50,
        waterGoal: 8,
        windDownHour: null,
        hearingWarning: true,
        breathePattern: 'relax',
      }),
  } satisfies MunaStoryParameters,
};

/** Half way through *Stretch*: the current step is marked, the done ones dimmed. */
export const Stretch: Story = {
  parameters: {
    ipc: healthService(sampleSnapshot({ nextBreakInMs: null, flow: running('stretch', 65_000) })),
  } satisfies MunaStoryParameters,
};

/** The twenty-second eye rest. */
export const EyeRest: Story = {
  parameters: {
    ipc: healthService(sampleSnapshot({ nextBreakInMs: null, flow: running('eyeRest') })),
  } satisfies MunaStoryParameters,
};

/** After the wind-down hour, with the headphones warning up. */
export const Evening: Story = {
  parameters: {
    ipc: healthService(
      sampleSnapshot({
        windingDown: true,
        hearing: { percent: 92, loudForMs: 14 * MINUTE_MS, warned: true },
      }),
    ),
  } satisfies MunaStoryParameters,
};

/** No input for a while: the sit is paused and the head says so. */
export const Away: Story = {
  parameters: {
    ipc: healthService(sampleSnapshot({ sitting: 'away', nextBreakInMs: null })),
  } satisfies MunaStoryParameters,
};

/** The session is locked. */
export const Locked: Story = {
  parameters: {
    ipc: healthService(sampleSnapshot({ sitting: 'locked', nextBreakInMs: null })),
  } satisfies MunaStoryParameters,
};

/** Tracking is off in Settings; the panel points there. */
export const Off: Story = {
  parameters: {
    ipc: healthService(emptySnapshot({ sitting: 'off', enabled: false, nextBreakInMs: null })),
  } satisfies MunaStoryParameters,
};

/** A fresh day, two minutes in. */
export const Empty: Story = {
  parameters: {
    ipc: healthService(emptySnapshot()),
  } satisfies MunaStoryParameters,
};

export const RTL: Story = {
  globals: { direction: 'rtl' },
};

export const ReducedMotion: Story = {
  parameters: {
    ipc: healthService(sampleSnapshot({ nextBreakInMs: null, flow: running('breathe') })),
  } satisfies MunaStoryParameters,
  globals: { reduceMotion: 'on' },
};

/** The mirrored-English pseudo-locale (ar-XB): longer strings, right-to-left layout. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
