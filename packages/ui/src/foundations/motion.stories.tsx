import type { Meta, StoryObj } from '@storybook/react-vite';

import './foundations.css';
import { Playground, SpringTable, TimingTable } from './motion-playground';

const meta = {
  title: 'Foundations/Motion',
  component: Playground,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Playground>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Every preset, same distance, same start — the fastest way to feel the differences. */
export const AllPresets: Story = {};

/** The shell presets only; these must stay physics springs so interruptions reverse cleanly. */
export const ShellPresets: Story = {
  args: { presets: ['expand', 'collapse', 'reveal', 'notice', 'drag', 'hide'] },
};

/** Content and control presets. */
export const ContentPresets: Story = {
  args: { presets: ['content', 'switch', 'toggle', 'interactive', 'press', 'layout'] },
};

/** With Reduce motion on, every lane runs the same 150 ms ease-out. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};

export const Springs: Story = {
  render: () => <SpringTable />,
};

export const Timings: Story = {
  render: () => <TimingTable />,
};
