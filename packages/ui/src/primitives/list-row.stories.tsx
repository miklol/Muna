import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { fn } from 'storybook/test';

import { BatteryGlyph, BellGlyph, CalendarGlyph, GridGlyph } from '../foundations/glyphs';
import { Chip } from './chip';
import { ListRow } from './list-row';
import { Toggle } from './toggle';

/** Flattened props: the component's static/pressable union does not survive Storybook's arg typing. */
interface Args {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  trailingIsControl?: boolean;
  onPress?: () => void;
  isDisabled?: boolean;
}

function Row({ onPress, isDisabled, ...rest }: Args) {
  return onPress === undefined ? (
    <ListRow {...rest} />
  ) : (
    <ListRow {...rest} onPress={onPress} isDisabled={isDisabled === true} />
  );
}

const meta = {
  title: 'Primitives/ListRow',
  component: Row,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 300, background: 'var(--surface-1)', borderRadius: 12 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    icon: <CalendarGlyph />,
    label: 'Design review',
    trailing: '10:00',
  },
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 36 px, icon 20, label 13, trailing value in `--text-2`; static rows are plain divs. */
export const Default: Story = {};

export const WithDescription: Story = {
  args: { description: 'Teams · 45 min' },
};

export const WithControl: Story = {
  args: {
    icon: <BellGlyph />,
    label: 'Show notifications',
    description: 'Mirror system toasts on the notch',
    trailing: <Toggle aria-label="Show notifications" defaultSelected />,
    trailingIsControl: true,
  },
};

/** Rows with `onPress` become one React Aria button — hover fill, press 0.98, focus ring. */
export const Pressable: Story = {
  args: {
    icon: <GridGlyph />,
    label: 'Modules',
    description: 'Order, enable and pin',
    trailing: <Chip>4 on</Chip>,
    onPress: fn(),
  },
};

export const Disabled: Story = {
  args: {
    icon: <BatteryGlyph />,
    label: 'Battery',
    description: 'No battery detected',
    onPress: fn(),
    isDisabled: true,
  },
};

export const LongContent: Story = {
  args: {
    label: 'A very long meeting title that keeps going past the row and gets cut off',
    description: 'Description copy is clipped to one line as well so rows stay 36 or 52 px tall',
    trailing: '10:00–11:30',
  },
};

export const List: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-1)' }}>
      <ListRow
        icon={<CalendarGlyph />}
        label="Design review"
        description="Teams"
        trailing="10:00"
      />
      <ListRow icon={<CalendarGlyph />} label="Lunch with Ana" trailing="12:30" />
      <ListRow icon={<CalendarGlyph />} label="1:1 with Sam" trailing="15:00" onPress={fn()} />
    </div>
  ),
};

export const RTL: Story = {
  render: () => (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-1)' }}>
      <ListRow
        icon={<CalendarGlyph />}
        label="مراجعة التصميم"
        description="تيمز"
        trailing="10:00"
      />
      <ListRow
        icon={<BellGlyph />}
        label="إظهار الإشعارات"
        trailing={<Toggle aria-label="إظهار الإشعارات" defaultSelected />}
        trailingIsControl
      />
    </div>
  ),
};
