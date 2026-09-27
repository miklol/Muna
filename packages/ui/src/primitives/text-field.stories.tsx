import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Text } from './text';
import { TextField } from './text-field';

const plus = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75}>
    <path d="M8 3v10M3 8h10" strokeLinecap="round" />
  </svg>
);

const meta = {
  title: 'Primitives/TextField',
  component: TextField,
  parameters: { layout: 'centered' },
  args: {
    'aria-label': 'New task',
    placeholder: 'Add a task',
  },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 260 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TextField>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 28 px on `--surface-1`; the focused border is `--hairline-strong`. */
export const Default: Story = {};

export const WithText: Story = {
  args: { defaultValue: 'Call Sam at 3pm' },
};

/** A 16 px glyph in `--text-2` before the text. */
export const WithLeading: Story = {
  args: { leading: plus },
};

export const Disabled: Story = {
  args: { isDisabled: true, defaultValue: 'Renew passport' },
};

/** A token: masked, never saved or autofilled by the browser; Enter still submits it. */
export const Secret: Story = {
  args: { 'aria-label': 'Access token', placeholder: 'Paste a token', secret: true },
};

export const LongContent: Story = {
  args: { defaultValue: 'a title long enough to overflow the field and scroll as you type' },
};

/** Quick entry: Enter submits the trimmed text and the owner clears the field. */
export const QuickEntry: Story = {
  render: (args) => {
    const [value, setValue] = useState('');
    const [added, setAdded] = useState<string[]>([]);
    return (
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <TextField
          {...args}
          leading={plus}
          value={value}
          onChange={setValue}
          onSubmit={(title) => {
            setAdded((list) => [title, ...list]);
            setValue('');
          }}
        />
        <Text variant="footnote" tone="secondary">
          {added.length === 0 ? 'Press Enter to add' : added.join(' · ')}
        </Text>
      </div>
    );
  },
};

export const RTL: Story = {
  render: (args) => (
    <div dir="rtl">
      <TextField {...args} aria-label="مهمة جديدة" placeholder="أضف مهمة" leading={plus} />
    </div>
  ),
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  args: { defaultValue: 'motion' },
};
