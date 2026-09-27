import type { CodeHostingSnapshot, PullRequest } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { useCodeHostingStore } from './code-hosting-store';
import { CodeHostingPanel } from './panel';

const NOW = 1_790_503_600_000;

const pullRequest = (
  overrides: Partial<PullRequest> & Pick<PullRequest, 'id' | 'title' | 'repo' | 'number'>,
): PullRequest => ({
  provider: 'gitHub',
  url: `https://github.com/${overrides.repo}/pull/${String(overrides.number)}`,
  author: 'hubot',
  authorAvatarUrl: null,
  draft: false,
  additions: 64,
  deletions: 51,
  changedFiles: 6,
  checks: 'pending',
  reviewDecision: 'none',
  updatedAtMs: NOW - 600_000,
  reviewRequested: true,
  mine: false,
  ...overrides,
});

/** A morning's queue: two review requests, a draft, and two of the account's own with checks. */
const queue = (): PullRequest[] => [
  pullRequest({
    id: 'PR_1',
    title: 'Snap zones for dragged windows',
    repo: 'miklol/Muna',
    number: 41,
    author: 'sam-k',
    additions: 5_041,
    deletions: 69,
    changedFiles: 65,
    checks: 'failure',
    reviewDecision: 'reviewRequired',
  }),
  pullRequest({
    id: 'PR_2',
    title: 'Retry the ICS fetch with jitter so a flaky feed does not stall the strip',
    repo: 'octo-org/infra',
    number: 7,
    author: 'priya',
    draft: true,
    additions: 12,
    deletions: 3,
    changedFiles: 2,
    checks: 'none',
  }),
  pullRequest({
    id: 'PR_3',
    title: 'Shared lint config',
    repo: 'octo-org/shared',
    number: 99,
    author: 'octocat',
    checks: 'success',
    reviewDecision: 'approved',
    reviewRequested: true,
    mine: true,
  }),
  pullRequest({
    id: 'PR_4',
    title: 'GitHub review queue behind a token',
    repo: 'miklol/Muna',
    number: 42,
    author: 'octocat',
    additions: 2_310,
    deletions: 18,
    changedFiles: 38,
    checks: 'pending',
    reviewDecision: 'changesRequested',
    reviewRequested: false,
    mine: true,
  }),
];

const connected = (
  pullRequests: PullRequest[],
  extra: Partial<CodeHostingSnapshot> = {},
): CodeHostingSnapshot => ({
  enabled: true,
  account: { provider: 'gitHub', login: 'octocat', avatarUrl: null },
  pullRequests,
  fetchedAtMs: NOW - 45_000,
  fetching: false,
  error: null,
  ...extra,
});

/** A fake `code-hosting` service: the snapshot in memory; *Refresh* marks a fetch in flight. */
const codeHostingService = (initial: CodeHostingSnapshot): IpcHandlers => {
  let current = initial;
  return {
    get_code_hosting_snapshot: () => current,
    code_hosting_command: () => {
      current = { ...current, fetching: true };
      return current;
    },
    code_hosting_open: () => null,
    open_settings: () => null,
  };
};

const meta = {
  title: 'Modules/Code hosting/Panel',
  component: CodeHostingPanel,
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: codeHostingService(connected(queue())),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Code hosting">
      <CodeHostingPanel />
    </PanelFrame>
  ),
  // Every story starts on *To review*; the filter outlives the panel in the store otherwise.
  beforeEach: () => {
    useCodeHostingStore.setState({ snapshot: null, filter: 'toReview' });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof CodeHostingPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Three pull requests wait for a review: one with failed checks, a draft, one already approved. */
export const Default: Story = {};

/** *Mine* shows the account's own pull requests with where their checks stand. */
export const Mine: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Mine' }));
    // The panel enters through the `content` preset from opacity 0; wait for the frame.
    await waitFor(async () => {
      await expect(canvas.getByText('GitHub review queue behind a token')).toBeVisible();
      await expect(canvas.getByText('2 pull requests')).toBeVisible();
    });
  },
};

/** Nothing asks for a review: the panel says so and what would bring a row here. */
export const NothingToReview: Story = {
  parameters: {
    ipc: codeHostingService(connected(queue().filter((row) => !row.reviewRequested))),
  } satisfies MunaStoryParameters,
};

/** Offline: the last queue stands and one line under it says when it is from. */
export const Offline: Story = {
  parameters: {
    ipc: codeHostingService(connected(queue(), { error: 'offline' })),
  } satisfies MunaStoryParameters,
};

/** The token was refused: the queue stays, the footnote points at Settings. */
export const TokenRefused: Story = {
  parameters: {
    ipc: codeHostingService(connected(queue(), { error: 'unauthorized' })),
  } satisfies MunaStoryParameters,
};

/** The module is on but no account is connected yet. */
export const NotConnected: Story = {
  parameters: {
    ipc: codeHostingService(connected([], { account: null, fetchedAtMs: null })),
  } satisfies MunaStoryParameters,
};

/** The module is off: the panel says where to turn it on. */
export const Off: Story = {
  parameters: {
    ipc: codeHostingService({
      enabled: false,
      account: null,
      pullRequests: [],
      fetchedAtMs: null,
      fetching: false,
      error: null,
    }),
  } satisfies MunaStoryParameters,
};

/** Long titles and repository names end in an ellipsis; the list scrolls inside the panel. */
export const LongContent: Story = {
  parameters: {
    ipc: codeHostingService(
      connected(
        Array.from({ length: 12 }, (_, index) =>
          pullRequest({
            id: `PR_${String(index)}`,
            title: `A pull request title long enough to overflow the row and keep going ${String(index + 1)}`,
            repo: 'an-organisation-with-a-long-name/a-repository-with-an-even-longer-name',
            number: 1_000 + index,
            additions: index * 1_000,
            deletions: index * 100,
            changedFiles: index * 10,
          }),
        ),
      ),
    ),
  } satisfies MunaStoryParameters,
};

export const RTL: Story = {
  globals: { direction: 'rtl' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
