import { defaultSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { useSettings } from '../../lib/settings';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { monitors } from '../../storybook/samples';
import { SettingsEditorProvider } from '../settings-editor';
import { OnboardingFlow, type OnboardingFlowProps } from './onboarding-flow';

/** The settings window at its opening size, with the editor the tour writes through. */
function OnboardingStage(props: OnboardingFlowProps) {
  const settings = useSettings() ?? defaultSettings();
  return (
    <SettingsEditorProvider settings={settings}>
      <div style={{ blockSize: 640 }}>
        <OnboardingFlow {...props} />
      </div>
    </SettingsEditorProvider>
  );
}

const meta = {
  title: 'Settings/Welcome tour',
  component: OnboardingFlow,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: {
      list_monitors: () => monitors,
    },
  } satisfies MunaStoryParameters & { layout: string },
  args: {
    onDone: fn(),
  },
  render: (args) => <OnboardingStage {...args} />,
} satisfies Meta<typeof OnboardingFlow>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Step one of seven on a two-screen PC: the welcome card with Skip and Continue. */
export const Welcome: Story = {};

/** Continue walks the steps in order; Back returns without losing the count. */
export const WalksTheSteps: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Step 1 of 7')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }));
    await expect(canvas.getByText('Step 2 of 7')).toBeVisible();
    await expect(await canvas.findByRole('switch', { name: 'Display 1' })).toBeChecked();
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }));
    await expect(canvas.getByText('Step 3 of 7')).toBeVisible();
    await expect(await canvas.findByRole('radio', { name: 'Overlay' })).toBeChecked();
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }));
    await expect(canvas.getByText('Step 2 of 7')).toBeVisible();
  },
};

/** One screen: the displays step is left out, so the tour is six steps long. */
export const OneScreen: Story = {
  parameters: {
    ipc: {
      list_monitors: () => monitors.slice(0, 1),
    },
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('Step 1 of 6')).toBeVisible();
    });
  },
};

/** Skip finishes at once and marks the tour as seen. */
export const Skips: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Skip' }));
    await expect(args.onDone).toHaveBeenCalledTimes(1);
  },
};

/** The last step: Finish replaces Continue and Skip is gone. */
export const Done: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const next = () => userEvent.click(canvas.getByRole('button', { name: 'Continue' }));
    await next();
    await next();
    await next();
    await next();
    await next();
    await next();
    await expect(canvas.getByText('Step 7 of 7')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Finish' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
  },
};

/** The mirrored-English pseudo-locale: progress at the start edge, actions swapped. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};

/** Steps swap with no slide under reduced motion: the body changes in place. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
