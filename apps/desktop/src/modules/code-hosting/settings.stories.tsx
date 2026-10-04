import type { CodeHostingSnapshot } from '@muna/contracts';
import { writeCodeHostingSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import { type IpcHandlers, type MunaStoryParameters, refuse } from '../../storybook/ipc';
import { useCodeHostingStore } from './code-hosting-store';
import { CodeHostingSettingsPane } from './settings';

const disconnected = (enabled: boolean): CodeHostingSnapshot => ({
  enabled,
  account: null,
  pullRequests: [],
  fetchedAtMs: null,
  fetching: false,
  error: null,
});

const connected = (): CodeHostingSnapshot => ({
  ...disconnected(true),
  account: { provider: 'gitHub', login: 'octocat', avatarUrl: null },
  fetchedAtMs: 1_790_503_600_000,
});

/**
 * A fake `code-hosting` service: *Connect* accepts any token but `bad`, which GitHub refuses;
 * *Disconnect* forgets the account. Stateless on purpose: the stories share this object, and
 * the pane applies each answer to its store itself.
 */
const codeHostingService = (initial: CodeHostingSnapshot): IpcHandlers => ({
  get_code_hosting_snapshot: () => initial,
  code_hosting_connect: (args) => {
    const { token } = args as { token: string };
    if (token === 'bad') {
      return refuse('codeHosting.unauthorized', 'the code host no longer accepts the token');
    }
    return connected();
  },
  code_hosting_disconnect: () => disconnected(initial.enabled),
  code_hosting_open_token_page: () => null,
});

const meta = {
  title: 'Modules/Code hosting/Settings pane',
  component: CodeHostingSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: codeHostingService(disconnected(true)),
    settings: (base) =>
      writeCodeHostingSettings(base, {
        enabled: true,
        notices: { reviewRequested: true, checksFinished: true },
      }),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="codeHosting.title">
      <CodeHostingSettingsPane />
    </SettingsPaneFrame>
  ),
  beforeEach: () => {
    useCodeHostingStore.setState({ snapshot: null, filter: 'toReview' });
  },
} satisfies Meta<typeof CodeHostingSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** On, with no account yet: the privacy note, the switch and the connect form. */
export const Default: Story = {};

/** A fresh install: off, with the form still shown so the token page is one click away. */
export const Off: Story = {
  parameters: {
    ipc: codeHostingService(disconnected(false)),
    settings: (base) => base,
  } satisfies MunaStoryParameters,
};

/** Connected as octocat: the account row with *Disconnect* replaces the form. */
export const Connected: Story = {
  parameters: { ipc: codeHostingService(connected()) } satisfies MunaStoryParameters,
};

/** Pasting a token and pressing Enter connects; the field clears and the account row appears. */
export const Connecting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = await canvas.findByLabelText('Access token');
    await userEvent.type(field, 'ghp_exampletoken{enter}');
    await expect(await canvas.findByText('Connected as octocat')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Disconnect' })).toBeVisible();
  },
};

/** GitHub refuses the token: the form explains in one line and the field is cleared. */
export const Refused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = await canvas.findByLabelText('Access token');
    await userEvent.type(field, 'bad');
    await userEvent.click(canvas.getByRole('button', { name: 'Connect' }));
    await expect(await canvas.findByRole('status')).toHaveTextContent('GitHub refused the token');
    await expect(field).toHaveValue('');
  },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};

/** The mirrored-English pseudo-locale (ar-XB): longer strings, right-to-left layout. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
