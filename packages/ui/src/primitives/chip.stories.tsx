import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { MusicGlyph, TimerGlyph } from '../foundations/glyphs';
import { Chip } from './chip';

const meta = {
  title: 'Primitives/Chip',
  component: Chip,
  parameters: { layout: 'centered' },
  args: { children: 'Spotify' },
} satisfies Meta<typeof Chip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithIcon: Story = {
  args: { icon: <MusicGlyph />, children: 'Spotify' },
};

function SelectableDemo() {
  const [selected, setSelected] = useState(false);
  return (
    <Chip icon={<TimerGlyph />} isSelected={selected} onChange={setSelected}>
      {selected ? 'Focus on' : 'Focus off'}
    </Chip>
  );
}

/** Selection uses `--surface-3` with the `toggle` spring; press scales like an icon button. */
export const Selectable: Story = {
  render: () => <SelectableDemo />,
};

export const SelectableDisabled: Story = {
  render: () => (
    <Chip
      isDisabled
      isSelected
      onChange={() => {
        /* disabled */
      }}
    >
      Pomodoro
    </Chip>
  ),
};

export const LongContent: Story = {
  render: () => (
    <div style={{ inlineSize: 160 }}>
      <Chip icon={<MusicGlyph />}>A very long source name that will not fit</Chip>
    </div>
  ),
};

export const RTL: Story = {
  render: () => (
    <div dir="rtl" style={{ display: 'flex', gap: 'var(--space-2)' }}>
      <Chip icon={<MusicGlyph />}>سبوتيفاي</Chip>
      <Chip>تركيز</Chip>
    </div>
  ),
};
