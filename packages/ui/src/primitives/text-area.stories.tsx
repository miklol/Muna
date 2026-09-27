import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';

import { Button } from './button';
import { Text } from './text';
import { TextArea } from './text-area';

const meta = {
  title: 'Primitives/TextArea',
  component: TextArea,
  parameters: { layout: 'centered' },
  args: {
    'aria-label': 'Note text',
    placeholder: 'Start writing',
  },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 320, blockSize: 160, display: 'flex' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TextArea>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Fills the owner's box and scrolls inside it; the focused border is `--hairline-strong`. */
export const Default: Story = {};

export const WithText: Story = {
  args: {
    defaultValue:
      '# Groceries\n\n- milk\n- eggs\n- something for the weekend\n\nCall **Ann** about Saturday.',
  },
};

/** Sized to the text rather than the box: three rows for a short note in a settings pane. */
export const Rows: Story = {
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 320 }}>
        <Story />
      </div>
    ),
  ],
  args: { size: { rows: 3 }, defaultValue: 'A short note.' },
};

export const Disabled: Story = {
  args: { isDisabled: true, defaultValue: 'Read only for now.' },
};

/** More text than fits: the area scrolls, the panel does not grow. */
export const LongContent: Story = {
  args: {
    defaultValue: Array.from(
      { length: 30 },
      (_, i) => `Line ${String(i + 1)} of a long note.`,
    ).join('\n'),
  },
};

/** Quick capture: the owner focuses the area and puts the caret at the end. */
export const CaretAtEnd: Story = {
  render: (args) => {
    const ref = useRef<HTMLTextAreaElement>(null);
    const [value, setValue] = useState('- remember the milk\n- call the bank\n');
    const focusEnd = () => {
      const area = ref.current;
      if (area === null) return;
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    };
    return (
      <div style={{ display: 'grid', gap: 'var(--space-2)', inlineSize: 320 }}>
        <div style={{ blockSize: 120, display: 'flex' }}>
          <TextArea {...args} value={value} onChange={setValue} textAreaRef={ref} />
        </div>
        <Button variant="secondary" onPress={focusEnd}>
          Write a quick note
        </Button>
        <Text variant="footnote" tone="secondary">
          Pressing the button focuses the area with the caret after the last line.
        </Text>
      </div>
    );
  },
};

export const RTL: Story = {
  render: (args) => (
    <div dir="rtl" style={{ inlineSize: 320, blockSize: 160, display: 'flex' }}>
      <TextArea {...args} aria-label="نص الملاحظة" placeholder="ابدأ الكتابة" />
    </div>
  ),
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  args: { defaultValue: 'motion' },
};
