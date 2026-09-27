import type { CodeHostingSnapshot, PullRequest } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { useCodeHostingStore } from './code-hosting-store';
import { CodeHostingWidget } from './widget';

const ipc = vi.hoisted(() => ({
  getCodeHostingSnapshot: vi.fn<() => Promise<CodeHostingSnapshot>>(),
  listen: vi.fn(() =>
    Promise.resolve(() => {
      // Nothing to unlisten from outside Tauri.
    }),
  ),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { getCodeHostingSnapshot: ipc.getCodeHostingSnapshot },
  events: { codeHostingChanged: { listen: ipc.listen } },
}));

let counter = 0;
const row = (overrides: Partial<PullRequest> = {}): PullRequest => {
  counter += 1;
  return {
    id: `PR_${String(counter)}`,
    provider: 'gitHub',
    repo: 'miklol/Muna',
    number: 40 + counter,
    title: `Pull request ${String(counter)}`,
    url: `https://github.com/miklol/Muna/pull/${String(40 + counter)}`,
    author: 'sam-k',
    authorAvatarUrl: null,
    draft: false,
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    checks: 'success',
    reviewDecision: 'none',
    updatedAtMs: 0,
    reviewRequested: true,
    mine: false,
    ...overrides,
  };
};

const snapshot = (
  pullRequests: PullRequest[],
  overrides: Partial<CodeHostingSnapshot> = {},
): CodeHostingSnapshot => ({
  enabled: true,
  account: { provider: 'gitHub', login: 'octocat', avatarUrl: null },
  pullRequests,
  fetchedAtMs: 0,
  fetching: false,
  error: null,
  ...overrides,
});

const renderWidget = (span: 1 | 2) =>
  render(
    <I18nextProvider i18n={i18n}>
      <CodeHostingWidget span={span} />
    </I18nextProvider>,
  );

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('CodeHostingWidget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    counter = 0;
    useCodeHostingStore.setState({ snapshot: null, filter: 'toReview' });
    ipc.getCodeHostingSnapshot.mockReset();
    ipc.listen.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('counts what waits for the review and lists the first three titles', async () => {
    ipc.getCodeHostingSnapshot.mockResolvedValue(
      snapshot([
        row({ title: 'Snap zones' }),
        row({ title: 'Review queue', reviewRequested: false, mine: true }),
        row({ title: 'Retry the fetch', repo: 'octo-org/infra', number: 7 }),
        row({ title: 'Weather icons' }),
        row({ title: 'Notes' }),
      ]),
    );
    const view = renderWidget(1);
    await flush();
    const card = screen.getByLabelText('Review queue');
    expect(card).toHaveTextContent('4 waiting for your review');
    const rows = within(card).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Snap zones');
    expect(rows[1]).toHaveTextContent('Retry the fetch');
    expect(rows[2]).toHaveTextContent('Weather icons');
    expect(screen.queryByText('Review queue', { selector: 'span' })).not.toBeInTheDocument();
    // A single column has no room for the repository.
    expect(card).not.toHaveTextContent('octo-org/infra #7');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('adds where each pull request lives on a wide card', async () => {
    ipc.getCodeHostingSnapshot.mockResolvedValue(
      snapshot([row({ title: 'Retry the fetch', repo: 'octo-org/infra', number: 7 })]),
    );
    renderWidget(2);
    await flush();
    const card = screen.getByLabelText('Review queue');
    expect(card).toHaveTextContent('1 waiting for your review');
    expect(card).toHaveTextContent('octo-org/infra #7');
  });

  it('says so in one line when nothing waits, no account is connected, or the module is off', async () => {
    ipc.getCodeHostingSnapshot.mockResolvedValue(
      snapshot([row({ reviewRequested: false, mine: true })]),
    );
    renderWidget(1);
    await flush();
    expect(screen.getByText('Nothing to review')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    act(() => {
      useCodeHostingStore.getState().setSnapshot(snapshot([], { account: null }));
    });
    expect(screen.getByText('Connect a GitHub account in Settings')).toBeInTheDocument();

    act(() => {
      useCodeHostingStore.getState().setSnapshot(snapshot([], { enabled: false, account: null }));
    });
    expect(screen.getByText('Code hosting is off')).toBeInTheDocument();
  });
});
