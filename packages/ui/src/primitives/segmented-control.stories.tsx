import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { CalendarGlyph, GridGlyph, TimerGlyph } from '../foundations/glyphs';
import { SegmentedControl, type SegmentedControlItem } from './segmented-control';

type View = 'day' | 'week' | 'month';

const views: readonly SegmentedControlItem<View>[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

function Controlled(props: {
  items?: readonly SegmentedControlItem<View>[];
  isDisabled?: boolean;
  initial?: View;
}) {
  const [value, setValue] = useState<View>(props.initial ?? 'day');
  return (
    <SegmentedControl
      aria-label="Calendar view"
      items={props.items ?? views}
      value={value}
      onChange={setValue}
      isDisabled={props.isDisabled === true}
    />
  );
}

const meta = {
  title: 'Primitives/SegmentedControl',
  component: SegmentedControl,
  parameters: { layout: 'centered' },
  args: { 'aria-label': 'Calendar view', items: views, value: 'day', onChange: fn() },
  render: () => <Controlled />,
} satisfies Meta<typeof SegmentedControl>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 28 px track on `--surface-1`; the `--surface-3` pill glides between segments with `toggle`. */
export const Default: Story = {};

export const WithIcons: Story = {
  render: () => (
    <Controlled
      items={[
        { id: 'day', label: 'Day', icon: <TimerGlyph /> },
        { id: 'week', label: 'Week', icon: <CalendarGlyph /> },
        { id: 'month', label: 'Month', icon: <GridGlyph /> },
      ]}
      initial="week"
    />
  ),
};

export const SegmentDisabled: Story = {
  render: () => (
    <Controlled
      items={[
        { id: 'day', label: 'Day' },
        { id: 'week', label: 'Week', isDisabled: true },
        { id: 'month', label: 'Month' },
      ]}
    />
  ),
};

export const Disabled: Story = {
  render: () => <Controlled isDisabled />,
};

export const LongContent: Story = {
  render: () => (
    <div style={{ inlineSize: 240, display: 'flex' }}>
      <Controlled
        items={[
          { id: 'day', label: 'Today only' },
          { id: 'week', label: 'This working week' },
          { id: 'month', label: 'Whole month' },
        ]}
      />
    </div>
  ),
};

/** Reduced motion: the pill jumps to the selected segment. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};

export const RTL: Story = {
  render: () => (
    <div dir="rtl">
      <Controlled
        items={[
          { id: 'day', label: 'يوم' },
          { id: 'week', label: 'أسبوع' },
          { id: 'month', label: 'شهر' },
        ]}
      />
    </div>
  ),
};
