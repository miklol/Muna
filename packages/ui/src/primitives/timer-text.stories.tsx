import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from 'react-aria-components';

import { Text } from './text';
import { TimerText } from './timer-text';

const meta = {
  title: 'Primitives/TimerText',
  component: TimerText,
  parameters: { layout: 'centered' },
  args: { remainingMs: 25 * 60_000, running: false, receivedAt: 0 },
} satisfies Meta<typeof TimerText>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Paused: shows the published value as is. */
export const Paused: Story = {};

function RunningDemo() {
  const [published, setPublished] = useState(() => ({
    remainingMs: 90_000,
    receivedAt: Date.now(),
  }));
  const [running, setRunning] = useState(true);
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)', justifyItems: 'center' }}>
      <TimerText
        variant="title3"
        remainingMs={published.remainingMs}
        receivedAt={published.receivedAt}
        running={running}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button
          className="muna-chip muna-chip--selectable"
          onPress={() => {
            setRunning((value) => !value);
          }}
        >
          <span className="muna-chip__label">{running ? 'Pause' : 'Resume'}</span>
        </Button>
        <Button
          className="muna-chip muna-chip--selectable"
          onPress={() => {
            setPublished({ remainingMs: 25 * 60_000, receivedAt: Date.now() });
          }}
        >
          <span className="muna-chip__label">Republish 25:00</span>
        </Button>
      </div>
      <Text variant="footnote" tone="secondary">
        Counts locally from the published value; the interval stops when paused or unmounted.
      </Text>
    </div>
  );
}

/** Running: ticks once a second from the moment the value arrived. */
export const Running: Story = {
  render: () => <RunningDemo />,
};

/** Over an hour the format switches to h:mm:ss. */
export const Hours: Story = {
  args: { remainingMs: 3_661_000, running: false, receivedAt: 0, variant: 'body' },
};
