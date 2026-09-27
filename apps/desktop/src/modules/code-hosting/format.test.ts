import type { CodeHostingSnapshot, PullRequest } from '@muna/contracts';
import { describe, expect, it } from 'vitest';

import { i18n } from '../../lib/i18n';
import { describeError, formatUpdated, initialOf, rowMeta, waitingCount } from './format';

const t = i18n.t.bind(i18n);

const row = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  id: 'PR_1',
  provider: 'gitHub',
  repo: 'miklol/Muna',
  number: 41,
  title: 'Snap zones',
  url: 'https://github.com/miklol/Muna/pull/41',
  author: 'sam-k',
  authorAvatarUrl: null,
  draft: false,
  additions: 5_041,
  deletions: 69,
  changedFiles: 65,
  checks: 'failure',
  reviewDecision: 'reviewRequired',
  updatedAtMs: 0,
  reviewRequested: true,
  mine: false,
  ...overrides,
});

describe('code hosting formatting', () => {
  it('joins the change size, the files, the checks and the review decision', () => {
    expect(rowMeta(row(), t, 'en')).toBe('+5,041 −69 · 65 files · Checks failed · Review required');
    expect(
      rowMeta(row({ additions: 1, deletions: 0, changedFiles: 1, checks: 'none' }), t, 'en'),
    ).toBe('+1 −0 · 1 file · Review required');
    expect(rowMeta(row({ checks: 'pending', reviewDecision: 'none' }), t, 'en')).toBe(
      '+5,041 −69 · 65 files · Checks running',
    );
    expect(rowMeta(row({ checks: 'success', reviewDecision: 'approved' }), t, 'en')).toBe(
      '+5,041 −69 · 65 files · Checks passed · Approved',
    );
    // German groups thousands with a dot.
    expect(rowMeta(row({ checks: 'none', reviewDecision: 'none' }), t, 'de')).toBe(
      '+5.041 −69 · 65 files',
    );
  });

  it('takes the first grapheme of a login as its initial, upper-cased', () => {
    expect(initialOf('octocat')).toBe('O');
    expect(initialOf('  sam-k ')).toBe('S');
    expect(initialOf('émile')).toBe('É');
    expect(initialOf('👩‍💻dev')).toBe('👩‍💻');
    expect(initialOf('')).toBe('?');
  });

  it('formats the fetch time as a short time for the locale', () => {
    const atMs = new Date(2026, 8, 27, 10, 5).getTime();
    expect(formatUpdated(atMs, 'en')).toMatch(/^10:05\sAM$/);
    expect(formatUpdated(atMs, 'de')).toBe('10:05');
  });

  it('explains each failed poll in one sentence, offline naming the cached time', () => {
    const atMs = new Date(2026, 8, 27, 10, 5).getTime();
    expect(describeError('offline', atMs, t, 'en')).toMatch(
      /^Offline, showing the queue from 10:05\sAM$/,
    );
    expect(describeError('offline', null, t, 'en')).toBe(
      'Offline. The queue appears when the connection is back.',
    );
    expect(describeError('unauthorized', atMs, t, 'en')).toBe(
      'GitHub no longer accepts the token. Connect again in Settings.',
    );
    expect(describeError('rateLimited', atMs, t, 'en')).toBe(
      'GitHub asked for a pause. The queue refreshes in a while.',
    );
    expect(describeError('provider', atMs, t, 'en')).toBe(
      'GitHub answered with something unexpected. Muna tries again in a while.',
    );
  });

  it("counts the rows that ask for the account's review, whoever opened them", () => {
    const snapshot: CodeHostingSnapshot = {
      enabled: true,
      account: { provider: 'gitHub', login: 'octocat', avatarUrl: null },
      pullRequests: [
        row({ id: 'a' }),
        row({ id: 'b', reviewRequested: true, mine: true }),
        row({ id: 'c', reviewRequested: false, mine: true }),
      ],
      fetchedAtMs: null,
      fetching: false,
      error: null,
    };
    expect(waitingCount(snapshot)).toBe(2);
  });
});
