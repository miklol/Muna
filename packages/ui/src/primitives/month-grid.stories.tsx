import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { MonthGrid, type MonthGridProps } from './month-grid';

const localDay = (date: Date): string =>
  `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

const todayKey = localDay(new Date());

const shift = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDay(date);
};

const marks: MonthGridProps['marks'] = {
  [todayKey]: ['purple', 'blue'],
  [shift(1)]: ['purple'],
  [shift(3)]: ['blue', 'green', 'orange', 'red'],
  [shift(-2)]: ['green'],
  [shift(9)]: ['purple', 'purple'],
};

const meta = {
  title: 'Primitives/MonthGrid',
  component: MonthGrid,
  parameters: { layout: 'centered' },
  args: {
    'aria-label': 'Calendar',
    value: todayKey,
    previousLabel: 'Previous month',
    nextLabel: 'Next month',
    todayLabel: 'Today',
    marks,
    onChange: () => {
      /* controlled in the demo */
    },
  },
} satisfies Meta<typeof MonthGrid>;

export default meta;

type Story = StoryObj<typeof meta>;

function Demo(props: MonthGridProps) {
  const [value, setValue] = useState(props.value);
  return <MonthGrid {...props} value={value} onChange={setValue} />;
}

/** Today is the filled accent circle; the selected day sits on `--surface-3`; dots are tinted like their source. */
export const Default: Story = {
  render: (args) => <Demo {...args} />,
};

export const NoMarks: Story = {
  args: { marks: {} },
  render: (args) => <Demo {...args} />,
};

export const WithoutTodayButton: Story = {
  render: ({ todayLabel: _omitted, ...args }) => <Demo {...args} />,
};

export const RTL: Story = {
  render: (args) => (
    <div dir="rtl">
      <Demo {...args} />
    </div>
  ),
};
