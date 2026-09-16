import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import {
  CalendarGlyph,
  CollapseGlyph,
  MusicGlyph,
  PauseGlyph,
  PinGlyph,
  SkipGlyph,
} from '../foundations/glyphs';
import { notchRadii } from '../shape/notch-path';
import { Button } from './button';
import { Card } from './card';
import { Chip } from './chip';
import { EmptyState } from './empty-state';
import { IconButton } from './icon-button';
import { ListRow } from './list-row';
import { NotchSurface } from './notch-surface';
import { PanelChrome } from './panel-chrome';
import { ProgressTrack } from './progress-track';
import { Text } from './text';

/** The panel body is 420 wide plus the two 19 px flares (docs/05-design-system.md#spacing--sizing). */
const panelWidth = 420 + 2 * notchRadii.expanded.topRadius;

function Rail(props: { pinned?: boolean }) {
  return (
    <>
      <IconButton
        aria-label={props.pinned === true ? 'Unpin' : 'Pin'}
        isActive={props.pinned === true}
        onPress={fn()}
      >
        <PinGlyph />
      </IconButton>
      <IconButton aria-label="Collapse" onPress={fn()}>
        <CollapseGlyph />
      </IconButton>
    </>
  );
}

const meta = {
  title: 'Primitives/PanelChrome',
  component: PanelChrome,
  parameters: { layout: 'fullscreen' },
  globals: { backgrounds: { value: 'desktop' } },
  decorators: [
    // The expanded notch hangs from the top edge; the chrome fills the black-glass surface.
    (Story) => (
      <div style={{ display: 'flex', justifyContent: 'center', minBlockSize: 360 }}>
        <NotchSurface shape="notch" state="expanded" style={{ inlineSize: panelWidth }}>
          <Story />
        </NotchSurface>
      </div>
    ),
  ],
  args: {
    title: 'Calendar',
    subtitle: '3 events today',
    rail: <Rail />,
    children: (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <ListRow
          icon={<CalendarGlyph />}
          label="Design review"
          description="Teams"
          trailing="10:00"
        />
        <ListRow icon={<CalendarGlyph />} label="Lunch with Ana" trailing="12:30" />
        <ListRow icon={<CalendarGlyph />} label="1:1 with Sam" trailing="15:00" />
      </div>
    ),
  },
} satisfies Meta<typeof PanelChrome>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 16 px padding, 44 px header (title + subtitle, rail right), body, no footer. */
export const Default: Story = {};

export const WithChips: Story = {
  args: {
    title: 'Media',
    subtitle: undefined,
    chips: (
      <>
        <Chip icon={<MusicGlyph />}>Spotify</Chip>
        <Chip>Lossless</Chip>
      </>
    ),
    rail: <Rail pinned />,
    children: (
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span
            aria-hidden="true"
            style={{
              inlineSize: 64,
              blockSize: 64,
              borderRadius: 'var(--radius-tile)',
              background: 'var(--accent-cyan)',
              flex: 'none',
            }}
          />
          <div style={{ display: 'grid', gap: 'var(--space-1)', minInlineSize: 0, flex: 1 }}>
            <Text weight={600} truncate={1}>
              Nothing else matters
            </Text>
            <Text variant="footnote" tone="secondary" truncate={1}>
              Metallica — Metallica
            </Text>
          </div>
          <IconButton aria-label="Pause" size="large">
            <PauseGlyph />
          </IconButton>
          <IconButton aria-label="Next">
            <SkipGlyph />
          </IconButton>
        </div>
        <ProgressTrack aria-label="Playback" tint="cyan" seekable value={38} />
      </Card>
    ),
  },
};

export const WithFooter: Story = {
  args: {
    footer: (
      <>
        <Text variant="footnote" tone="secondary">
          Updated a moment ago
        </Text>
        <span style={{ flex: 1 }} />
        <Button>Open calendar</Button>
      </>
    ),
  },
};

export const Empty: Story = {
  args: {
    subtitle: undefined,
    children: (
      <EmptyState
        icon={<CalendarGlyph />}
        title="Connect a calendar to see today's events"
        action={<Button variant="primary">Connect</Button>}
      />
    ),
  },
};

export const LongContent: Story = {
  args: {
    title: 'A module title long enough to be cut off before it reaches the chips and the rail',
    subtitle: 'A subtitle that is also far too long for one line and gets an ellipsis of its own',
    chips: <Chip>Context</Chip>,
  },
};

/** The rail keeps its order in RTL: the collapse control stays outermost. */
export const RTL: Story = {
  render: (args) => (
    <div dir="rtl" style={{ display: 'contents' }}>
      <PanelChrome {...args} title="التقويم" subtitle="٣ أحداث اليوم">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <ListRow
            icon={<CalendarGlyph />}
            label="مراجعة التصميم"
            description="تيمز"
            trailing="10:00"
          />
          <ListRow icon={<CalendarGlyph />} label="غداء مع آنا" trailing="12:30" />
        </div>
      </PanelChrome>
    </div>
  ),
};
