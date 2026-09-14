import type { Meta, StoryObj } from '@storybook/react-vite';

import './foundations.css';
import { TokenTable } from './token-table';

const meta = {
  title: 'Foundations/Tokens',
  component: TokenTable,
  parameters: { layout: 'padded' },
  args: { group: 'colour', title: 'Colour' },
} satisfies Meta<typeof TokenTable>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Colour: Story = {};

export const Materials: Story = { args: { group: 'material', title: 'Materials' } };

export const Shadows: Story = { args: { group: 'shadow', title: 'Shadows' } };

export const Radii: Story = { args: { group: 'radius', title: 'Radii' } };

export const Spacing: Story = { args: { group: 'space', title: 'Spacing' } };

export const Sizing: Story = { args: { group: 'size', title: 'Sizing' } };

export const Typography: Story = { args: { group: 'type', title: 'Typography' } };

export const Focus: Story = { args: { group: 'focus', title: 'Focus' } };
