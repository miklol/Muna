import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import {
  BatteryGlyph,
  BellGlyph,
  CalendarGlyph,
  GridGlyph,
  InboxGlyph,
  MusicGlyph,
  TimerGlyph,
} from '../foundations/glyphs';
import { ModuleBar, type ModuleBarItem } from './module-bar';
import { Text } from './text';

const modules: readonly ModuleBarItem[] = [
  { id: 'media', label: 'Media', icon: <MusicGlyph /> },
  { id: 'calendar', label: 'Calendar', icon: <CalendarGlyph /> },
  { id: 'pomodoro', label: 'Pomodoro', icon: <TimerGlyph /> },
  { id: 'notifications', label: 'Notifications', icon: <BellGlyph /> },
  { id: 'battery', label: 'Battery', icon: <BatteryGlyph /> },
  { id: 'shelf', label: 'Shelf', icon: <InboxGlyph /> },
];

function Controlled(props: {
  items?: readonly ModuleBarItem[];
  initial?: string | null;
  reorderable?: boolean;
}) {
  const [order, setOrder] = useState<readonly ModuleBarItem[]>(props.items ?? modules);
  const [active, setActive] = useState<string | null>(
    props.initial === undefined ? 'media' : props.initial,
  );
  const reorderable = props.reorderable !== false;
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)', justifyItems: 'center' }}>
      <ModuleBar
        aria-label="Modules"
        items={order}
        activeId={active}
        onActivate={setActive}
        overflowLabel="More modules"
        {...(reorderable
          ? {
              onReorder: (ids: readonly string[]) => {
                setOrder(ids.flatMap((id) => order.filter((item) => item.id === id)));
              },
            }
          : {})}
      />
      <Text variant="footnote" tone="secondary">
        {active === null ? 'No module selected' : `Active: ${active}`}
        {reorderable ? ' · drag or Ctrl+Arrow to reorder' : ''}
      </Text>
    </div>
  );
}

const meta = {
  title: 'Primitives/ModuleBar',
  component: ModuleBar,
  parameters: { layout: 'centered' },
  globals: { backgrounds: { value: 'desktop' } },
  args: { 'aria-label': 'Modules', items: modules, activeId: 'media', onActivate: fn() },
  render: () => <Controlled />,
} satisfies Meta<typeof ModuleBar>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * 640 × 40 bar of 32 px icon slots at 8 px gaps under the panel; the active pill glides with
 * `switch`, arrows move and activate, Ctrl+Arrow or a pointer drag reorders.
 */
export const Default: Story = {};

export const NoneActive: Story = {
  render: () => <Controlled initial={null} />,
};

export const FixedOrder: Story = {
  render: () => <Controlled reorderable={false} />,
};

/** Beyond 16 modules the bar pages: 15 slots plus a dots button that steps through the pages. */
export const Overflow: Story = {
  render: () => (
    <Controlled
      items={Array.from({ length: 20 }, (_, index) => ({
        id: `module-${String(index + 1)}`,
        label: `Module ${String(index + 1)}`,
        icon: <GridGlyph />,
      }))}
      initial="module-18"
    />
  ),
};

/** Reduced motion: the pill and reordered tabs jump; the hover scale is off. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on', backgrounds: { value: 'desktop' } },
};

/** In RTL the first module sits on the right and the arrow keys follow reading direction. */
export const RTL: Story = {
  render: () => (
    <div dir="rtl">
      <Controlled
        items={[
          { id: 'media', label: 'الوسائط', icon: <MusicGlyph /> },
          { id: 'calendar', label: 'التقويم', icon: <CalendarGlyph /> },
          { id: 'pomodoro', label: 'بومودورو', icon: <TimerGlyph /> },
        ]}
      />
    </div>
  ),
};
