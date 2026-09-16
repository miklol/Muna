import type { Meta, StoryObj } from '@storybook/react-vite';

import { CalendarGlyph, TimerGlyph } from '../foundations/glyphs';
import { Card } from './card';
import { Chip } from './chip';
import { ListRow } from './list-row';
import { Ring } from './ring';
import { Text } from './text';

const meta = {
  title: 'Primitives/Card',
  component: Card,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 280 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    title: 'Pomodoro',
    icon: <TimerGlyph />,
    children: 'Ready to focus',
  },
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

/** `--surface-1`, radius 12, padding 12, no shadow; header 13/600, body 12. */
export const Default: Story = {};

export const WithTrailing: Story = {
  args: { trailing: <Chip>Work</Chip> },
};

export const BodyOnly: Story = {
  args: { title: undefined, icon: undefined, children: 'A card without a header' },
};

export const WithValue: Story = {
  args: {
    title: 'Focus',
    trailing: (
      <Text variant="callout" tabular>
        25:00
      </Text>
    ),
    children: (
      <Ring
        diameter={64}
        value={40}
        tint="orange"
        size="small"
        aria-label="Focus session 40 percent"
      >
        <Text variant="footnote" tabular>
          40%
        </Text>
      </Ring>
    ),
  },
};

export const WithRows: Story = {
  args: {
    title: 'Today',
    icon: <CalendarGlyph />,
    children: (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <ListRow label="Design review" description="Teams" trailing="10:00" />
        <ListRow label="Lunch with Ana" trailing="12:30" />
      </div>
    ),
  },
};

export const LongContent: Story = {
  args: {
    title: 'A very long card title that will be cut to one line with an ellipsis',
    children:
      'Body copy wraps normally and stays at twelve pixels so a card never competes with the panel title for attention.',
  },
};

export const RTL: Story = {
  render: (args) => (
    <div dir="rtl">
      <Card {...args} title="بومودورو" trailing={<Chip>عمل</Chip>}>
        مستعد للتركيز
      </Card>
    </div>
  ),
};
