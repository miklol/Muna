import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card } from './card';
import { Skeleton } from './skeleton';

const meta = {
  title: 'Primitives/Skeleton',
  component: Skeleton,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 240, display: 'flex' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Skeleton>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A 12 px text line; the shimmer loops 1.6 s linear between 0.06 and 0.12 opacity. */
export const Default: Story = {};

export const Shapes: Story = {
  render: () => (
    <div
      style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', inlineSize: '100%' }}
    >
      <Skeleton shape="circle" width={36} height={36} />
      <div style={{ display: 'grid', gap: 'var(--space-2)', flex: 1 }}>
        <Skeleton width="70%" />
        <Skeleton width="45%" />
      </div>
      <Skeleton shape="block" width={48} height={36} />
    </div>
  ),
};

/** A loading card marks the container `aria-busy`; the skeletons themselves are hidden. */
export const InCard: Story = {
  render: () => (
    <div style={{ inlineSize: '100%' }} aria-busy="true">
      <Card title="Today">
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <Skeleton width="80%" />
          <Skeleton width="55%" />
          <Skeleton width="65%" />
        </div>
      </Card>
    </div>
  ),
};

/** Reduced motion: a static 0.09 tone, no shimmer. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-2)', inlineSize: '100%' }}>
      <Skeleton width="80%" />
      <Skeleton width="55%" />
    </div>
  ),
};
