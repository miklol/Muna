import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from 'react-aria-components';

import './foundations.css';
import { MunaMotionProvider } from '../motion/reduced-motion';
import { PlayGlyph } from './glyphs';
import { IconButton } from '../primitives/icon-button';
import { ProgressTrack } from '../primitives/progress-track';
import { Ring } from '../primitives/ring';
import { Text } from '../primitives/text';

interface ColumnProps {
  title: string;
  value: number;
}

function Column({ title, value }: ColumnProps) {
  return (
    <div className="motion-compare__column">
      <Text variant="footnote" weight={600} tone="secondary">
        {title}
      </Text>
      <Ring aria-label={`${title} ring`} diameter={72} tint="orange" value={value}>
        <Text variant="footnote" weight={600} tabular>
          {value}
        </Text>
      </Ring>
      <ProgressTrack aria-label={`${title} progress`} tint="orange" value={value} />
      <IconButton aria-label={`${title} play`}>
        <PlayGlyph />
      </IconButton>
    </div>
  );
}

/**
 * Left: full motion. Right: the same primitives inside a nested `MunaMotionProvider
 * reduceMotion` — springs become 150 ms ease-out and the ring appears at its value. Pure-CSS
 * states (press scale) follow the window-level setting: use the Motion toolbar switch for those.
 */
function Comparison() {
  const [value, setValue] = useState(35);
  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
        <Button
          className="muna-chip muna-chip--selectable"
          onPress={() => {
            setValue((v) => (v >= 90 ? 15 : v + 30));
          }}
        >
          <span className="muna-chip__label">Change value</span>
        </Button>
        <Text variant="footnote" tone="secondary">
          Hold times also grow by 50 % under reduced motion (`useHoldTime`).
        </Text>
      </div>
      <div className="motion-compare">
        <Column title="Full motion" value={value} />
        <MunaMotionProvider reduceMotion>
          <Column title="Reduce motion" value={value} />
        </MunaMotionProvider>
      </div>
    </div>
  );
}

const meta = {
  title: 'Foundations/Reduced motion',
  component: Comparison,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Comparison>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SideBySide: Story = {};
