import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { SearchField } from './search-field';
import { Text } from './text';

const meta = {
  title: 'Primitives/SearchField',
  component: SearchField,
  parameters: { layout: 'centered' },
  args: {
    'aria-label': 'Search settings',
    placeholder: 'Search settings',
    clearLabel: 'Clear search',
  },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 196 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SearchField>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 28 px on `--surface-1`; the clear button only appears once there is text. */
export const Default: Story = {};

export const WithText: Story = {
  args: { defaultValue: 'launch' },
};

export const Disabled: Story = {
  args: { isDisabled: true, defaultValue: 'bluetooth' },
};

export const LongContent: Story = {
  args: { defaultValue: 'a query long enough to overflow the field and clip' },
};

/** Controlled: the value drives whatever the field filters. */
export const Controlled: Story = {
  render: (args) => {
    const [value, setValue] = useState('');
    return (
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <SearchField {...args} value={value} onChange={setValue} />
        <Text variant="footnote" tone="secondary">
          {value === '' ? 'Nothing typed yet' : `Filtering by “${value}”`}
        </Text>
      </div>
    );
  },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  args: { defaultValue: 'motion' },
};
