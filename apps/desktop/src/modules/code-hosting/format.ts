import type {
  ChecksState,
  CodeHostError,
  CodeHostingSnapshot,
  Provider,
  PullRequest,
  ReviewDecision,
} from '@muna/contracts';
import type { MessageKey, Translate } from '@muna/i18n';

/** The host's name as the chips and the accessible labels say it. */
export const providerKey: Readonly<Record<Provider, MessageKey>> = {
  gitHub: 'codeHosting.provider.gitHub',
};

export const checksKey: Readonly<Record<ChecksState, MessageKey>> = {
  none: 'codeHosting.checks.none',
  pending: 'codeHosting.checks.pending',
  success: 'codeHosting.checks.success',
  failure: 'codeHosting.checks.failure',
};

/** `none` has no words: the row says nothing about a review that nobody asked for. */
const reviewKey: Readonly<Record<Exclude<ReviewDecision, 'none'>, MessageKey>> = {
  reviewRequired: 'codeHosting.review.reviewRequired',
  approved: 'codeHosting.review.approved',
  changesRequested: 'codeHosting.review.changesRequested',
};

/** `10:05 AM` in the window's locale: when the queue was last fetched. */
export const formatUpdated = (ms: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(ms);

const formatInt = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);

/**
 * The line under a row's title (docs/modules/code-hosting.md "Panel"): the change size, the
 * file count, where the checks stand and the review decision when there is one, joined with
 * middle dots. Numbers follow the locale; the words follow the catalog.
 */
export const rowMeta = (row: PullRequest, t: Translate, locale: string): string => {
  const parts: string[] = [
    t('codeHosting.changes', {
      additions: formatInt(row.additions, locale),
      deletions: formatInt(row.deletions, locale),
    }),
    t('codeHosting.files', { count: row.changedFiles }),
  ];
  if (row.checks !== 'none') parts.push(t(checksKey[row.checks]));
  if (row.reviewDecision !== 'none') parts.push(t(reviewKey[row.reviewDecision]));
  return parts.join(' · ');
};

/** The first letter of a login, upper-cased, for the initial that stands in for an avatar. */
export const initialOf = (login: string): string => {
  const first = new Intl.Segmenter().segment(login.trim())[Symbol.iterator]().next();
  return first.done ? '?' : first.value.segment.toLocaleUpperCase();
};

/**
 * One sentence about a poll that did not work, for the footnote under the list. Offline keeps
 * the last queue and says when it is from; the token being refused points at Settings.
 */
export const describeError = (
  error: CodeHostError,
  fetchedAtMs: number | null,
  t: Translate,
  locale: string,
): string => {
  switch (error) {
    case 'offline':
      return fetchedAtMs === null
        ? t('codeHosting.error.offlineNoCache')
        : t('codeHosting.error.offline', { time: formatUpdated(fetchedAtMs, locale) });
    case 'unauthorized':
      return t('codeHosting.error.unauthorized');
    case 'rateLimited':
      return t('codeHosting.error.rateLimited');
    case 'provider':
      return t('codeHosting.error.provider');
  }
};

/** How many rows wait for the account's review: the widget's headline and the panel's chip. */
export const waitingCount = (snapshot: CodeHostingSnapshot): number =>
  snapshot.pullRequests.filter((row) => row.reviewRequested).length;
