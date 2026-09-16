import type { Meta, StoryObj } from '@storybook/react-vite';

import { BatteryGlyph } from './battery-glyph';
import { Text } from './text';

const meta = {
  title: 'Primitives/BatteryGlyph',
  component: BatteryGlyph,
  parameters: { layout: 'centered' },
  args: { percent: 57 },
} satisfies Meta<typeof BatteryGlyph>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Green fill with a bolt while charging, at any level. */
export const Charging: Story = {
  args: { percent: 57, charging: true },
};

function Row({
  items,
}: {
  items: readonly { label: string; percent: number; charging?: boolean }[];
}) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
      {items.map((item) => (
        <div
          key={item.label}
          style={{ display: 'grid', justifyItems: 'center', gap: 'var(--space-1)' }}
        >
          <BatteryGlyph
            percent={item.percent}
            charging={item.charging ?? false}
            aria-label={item.label}
          />
          <Text variant="caption" tone="secondary" tabular>
            {item.label}
          </Text>
        </div>
      ))}
    </div>
  );
}

/** Text colour above 20 %, orange at 20 % and below, red at 10 % and below. */
export const Levels: Story = {
  render: () => (
    <Row
      items={[
        { label: '100 %', percent: 100 },
        { label: '57 %', percent: 57 },
        { label: '21 %', percent: 21 },
        { label: '20 %', percent: 20 },
        { label: '10 %', percent: 10 },
        { label: '3 %', percent: 3 },
        { label: 'Charging 3 %', percent: 3, charging: true },
      ]}
    />
  ),
};

/** Standing alone it is an image with a name; inside the strip it is hidden and described there. */
export const Labelled: Story = {
  args: { percent: 84, 'aria-label': 'Battery 84 %' },
};

/** The fill grows from the closed end in right-to-left text too. */
export const RTL: Story = {
  render: () => (
    <div dir="rtl">
      <Row
        items={[
          { label: '٥٧ ٪', percent: 57 },
          { label: '٢٠ ٪', percent: 20 },
        ]}
      />
    </div>
  ),
};
