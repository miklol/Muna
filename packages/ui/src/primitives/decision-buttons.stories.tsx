import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { DecisionButtons } from './decision-buttons';

const meta = {
  title: 'Primitives/DecisionButtons',
  component: DecisionButtons,
  parameters: { layout: 'centered', backgrounds: { value: 'notch' } },
  args: {
    'aria-label': 'Allow or deny',
    allowLabel: 'Allow',
    denyLabel: 'Deny',
    onAllow: fn(),
    onDeny: fn(),
  },
} satisfies Meta<typeof DecisionButtons>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The pair as the strip shows it: 20 px pills, *Allow* tinted green, *Deny* plain. */
export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Allow' }));
    await expect(args.onAllow).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Deny' }));
    await expect(args.onDeny).toHaveBeenCalledTimes(1);
  },
};

/** While the answer travels to the agent: both pills dim and stop taking presses. */
export const Disabled: Story = {
  args: { isDisabled: true },
};

/** Longer verbs still fit one line; the pills grow with their labels. */
export const LongLabels: Story = {
  args: { allowLabel: 'Allow once', denyLabel: 'Not now' },
};

/** Keyboard focus shows the accent ring on the pill under focus. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Allow' })).toHaveFocus();
  },
};
