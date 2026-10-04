import type { Settings, SourceSetting, Tint } from '@muna/contracts';
import {
  defaultCalendarSettings,
  readCalendarSettings,
  writeCalendarSettings,
} from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { refuse } from '../../storybook/ipc';
import { calendarSnapshot, calendarSources } from '../../storybook/samples';
import { useCalendarStore } from './calendar-store';
import { CalendarSettingsPane } from './settings';

const sourceSettings: SourceSetting[] = Object.values(calendarSources).map((source) => ({
  id: source.id,
  name: source.name,
  color: source.color,
  enabled: source.enabled,
  host: source.host,
}));

const withSources = (base: Settings, sources: SourceSetting[]): Settings =>
  writeCalendarSettings(base, { ...defaultCalendarSettings(), sources });

/** The document the story started from; `calendar_remove_source` answers with it minus a feed. */
let stored: Settings | null = null;

const storedSettings = (): Settings => {
  if (stored === null) throw new Error('the story settings have not been resolved yet');
  return stored;
};

/**
 * A fake calendar service for the pane. Adding a feed answers the way Rust does once the link
 * is in the credential vault: with the source's public half. A `refuses.example` link fails
 * the way a vault write does, so the form shows how a refusal reads.
 */
const calendarService: IpcHandlers = {
  get_calendar_snapshot: () => calendarSnapshot(),
  calendar_command: () => calendarSnapshot(),
  calendar_add_source: (args) => {
    const { name, url, color } = args as { name: string; url: string; color: Tint };
    if (url.includes('refuses.example')) {
      return refuse('calendar.vault', 'Windows refused to store the link.');
    }
    const host = new URL(url).host;
    return { id: `${host}:${name}`, name, color, enabled: true, host } satisfies SourceSetting;
  },
  calendar_remove_source: (args) => {
    const { id } = args as { id: string };
    const current = storedSettings();
    const calendar = readCalendarSettings(current);
    return writeCalendarSettings(current, {
      ...calendar,
      sources: calendar.sources.filter((source) => source.id !== id),
    });
  },
};

const meta = {
  title: 'Modules/Calendar/Settings pane',
  component: CalendarSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    settings: (base) => {
      stored = withSources(base, sourceSettings);
      return stored;
    },
    ipc: calendarService,
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="calendar.title">
      <CalendarSettingsPane />
    </SettingsPaneFrame>
  ),
  beforeEach: () => {
    useCalendarStore.setState({ snapshot: null });
  },
} satisfies Meta<typeof CalendarSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Two subscribed feeds with their last refresh, the add form, refresh cadence and strip rows. */
export const Default: Story = {};

/** Adding a feed: name, link and colour, then the row appears and the form clears. */
export const AddsAFeed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Name' }), 'Holidays');
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Link' }),
      'https://calendar.example.org/holidays.ics',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Add' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('switch', { name: 'Show Holidays' })).toBeChecked();
    });
  },
};

/** The link cannot be stored: the reason stays under the form and nothing is saved. */
export const LinkRefused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Name' }), 'Work 2');
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Link' }),
      'https://refuses.example/feed.ics',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Add' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('status')).toHaveTextContent(/could not store/);
    });
  },
};

/** No feed yet: only the add form and the general rows. */
export const NoFeeds: Story = {
  parameters: {
    settings: (base) => {
      stored = withSources(base, []);
      return stored;
    },
    ipc: {
      ...calendarService,
      get_calendar_snapshot: () => calendarSnapshot({ sources: [], events: [] }),
    },
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale on the feed rows, the form and the segmented control. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
