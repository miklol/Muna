import type { Meta, StoryObj } from '@storybook/react-vite';

import { Hairline } from './hairline';
import { Text } from './text';

const meta = {
  title: 'Primitives/Hairline',
  component: Hairline,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Hairline>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 'var(--space-3)', inlineSize: 240 }}>
      <Text>Now playing</Text>
      <Hairline {...args} />
      <Text tone="secondary">Up next</Text>
    </div>
  ),
};

export const Vertical: Story = {
  args: { orientation: 'vertical' },
  render: (args) => (
    <div style={{ display: 'flex', gap: 'var(--space-3)', blockSize: 44, alignItems: 'center' }}>
      <Text>12:04</Text>
      <Hairline {...args} />
      <Text tone="secondary">Tue 14 Sep</Text>
    </div>
  ),
};

export const Strong: Story = {
  args: { strong: true },
  render: (args) => (
    <div style={{ inlineSize: 240 }}>
      <Hairline {...args} />
    </div>
  ),
};
