import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { AlertGlyph, CalendarGlyph, InboxGlyph } from '../foundations/glyphs';
import { Button } from './button';
import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';

const meta = {
  title: 'Primitives/EmptyState',
  component: EmptyState,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 320, minBlockSize: 160, display: 'flex' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    icon: <CalendarGlyph />,
    title: "Connect a calendar to see today's events",
    description: 'Google and Outlook are supported',
    action: (
      <Button variant="primary" onPress={fn()}>
        Connect
      </Button>
    ),
  },
} satisfies Meta<typeof EmptyState>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Icon 24 in `--text-3`, one sentence saying what to do, one action. */
export const Default: Story = {};

export const TitleOnly: Story = {
  args: {
    icon: <InboxGlyph />,
    title: 'Nothing playing',
    description: undefined,
    action: undefined,
  },
};

export const LongContent: Story = {
  args: {
    title: 'Connect a calendar account to see the events for today and the rest of the week here',
    description:
      'Google, Outlook and any CalDAV account are supported; nothing leaves the device without you turning an integration on',
  },
};

/** The error variant is announced once as an alert and offers a retry. */
export const Error: Story = {
  render: () => (
    <ErrorState
      icon={<AlertGlyph />}
      title="Could not reach the calendar"
      description="Check the connection and try again"
      retryLabel="Try again"
      onRetry={fn()}
    />
  ),
};

export const ErrorWithoutRetry: Story = {
  render: () => (
    <ErrorState icon={<AlertGlyph />} title="Bluetooth is turned off in Windows settings" />
  ),
};

export const RTL: Story = {
  render: (args) => (
    <div dir="rtl" style={{ display: 'flex', flex: 1 }}>
      <EmptyState
        {...args}
        title="اربط تقويمًا لعرض أحداث اليوم"
        description="يدعم Google وOutlook"
        action={<Button variant="primary">ربط</Button>}
      />
    </div>
  ),
};
