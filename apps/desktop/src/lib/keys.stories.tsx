import type { Meta, StoryObj } from '@storybook/react-vite';

import { Keys } from './keys';

const meta = {
  title: 'Shell/Keys',
  component: Keys,
  parameters: { layout: 'centered' },
  args: { shortcut: 'ctrl+alt+space' },
} satisfies Meta<typeof Keys>;

export default meta;

type Story = StoryObj<typeof meta>;

/** One cap per token in the chord's own order; modifiers spell out as Windows names them. */
export const Default: Story = {};

export const Arrows: Story = {
  args: { shortcut: 'ctrl+alt+up' },
};

export const WindowsKeyAndNumpad: Story = {
  args: { shortcut: 'super+shift+num7' },
};

export const FunctionKey: Story = {
  args: { shortcut: 'f13' },
};

/** Every chord the shortcuts pane and the palette show, side by side. */
export const Gallery: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      {[
        'ctrl+alt+space',
        'ctrl+shift+space',
        'ctrl+alt+1',
        'ctrl+alt+n',
        'super+shift+num7',
        'ctrl+alt+up',
        'f13',
        'ctrl+alt+shift+super+delete',
      ].map((shortcut) => (
        <Keys key={shortcut} shortcut={shortcut} />
      ))}
    </div>
  ),
};
