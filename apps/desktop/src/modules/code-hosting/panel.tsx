import {
  CODE_HOSTING_FILTERS,
  type CodeHostingFilter,
  type CodeHostingSnapshot,
  commands,
  filterPullRequests,
  type PullRequest,
} from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import {
  Button,
  Chip,
  contentRecipe,
  EmptyState,
  IconButton,
  Text,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import { ExternalLink, GitPullRequest, GitPullRequestDraft, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';

import { useLocale } from '../../lib/locale';
import { useCodeHostingStore } from './code-hosting-store';
import { describeError, formatUpdated, initialOf, providerKey, rowMeta } from './format';
import {
  openPullRequest,
  useCodeHostingCommand,
  useCodeHostingSubscription,
} from './use-code-hosting';
import './code-hosting.css';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

const filterKey: Readonly<Record<CodeHostingFilter, MessageKey>> = {
  toReview: 'codeHosting.filter.toReview',
  mine: 'codeHosting.filter.mine',
  all: 'codeHosting.filter.all',
};

const emptyTitleKey: Readonly<Record<CodeHostingFilter, MessageKey>> = {
  toReview: 'codeHosting.empty.toReview.title',
  mine: 'codeHosting.empty.mine.title',
  all: 'codeHosting.empty.all.title',
};

const emptyBodyKey: Readonly<Record<CodeHostingFilter, MessageKey>> = {
  toReview: 'codeHosting.empty.toReview.body',
  mine: 'codeHosting.empty.mine.body',
  all: 'codeHosting.empty.all.body',
};

const openSettings = () => {
  void commands.openSettings().catch(() => {
    // Outside Tauri (tests, Storybook) there is no settings window.
  });
};

interface RowProps {
  row: PullRequest;
  locale: string;
}

/**
 * One pull request: the author's initial where the plan draws an avatar (the notch never
 * loads remote images), the title, `repo #num`, the author and the host's name as caption text
 * (a `Chip` here would share the filter chips' button shape without being one), the change
 * line, and a button that opens the page through Rust.
 */
function Row({ row, locale }: RowProps) {
  const { t } = useTranslation();
  const provider = t(providerKey[row.provider]);
  return (
    <li className="code-hosting-row" data-draft={row.draft || undefined}>
      <span className="code-hosting-row__avatar" aria-hidden>
        {initialOf(row.author)}
      </span>
      <span className="code-hosting-row__text">
        <span className="code-hosting-row__title">
          {row.draft && (
            <GitPullRequestDraft
              size={14}
              strokeWidth={ICON_STROKE}
              aria-label={t('codeHosting.draft')}
              focusable={false}
            />
          )}
          <Text as="span" variant="footnote" truncate={1}>
            {row.title}
          </Text>
        </span>
        <span className="code-hosting-row__where">
          <Text as="span" variant="caption" tone="tertiary" tabular truncate={1}>
            {t('codeHosting.pullRequest', { repo: row.repo, number: row.number })}
          </Text>
          <Text as="span" variant="caption" tone="tertiary" truncate={1}>
            {t('codeHosting.byAuthor', { author: row.author })}
          </Text>
          <Text
            as="span"
            variant="caption"
            tone="tertiary"
            truncate={1}
            className="code-hosting-row__provider"
          >
            {provider}
          </Text>
        </span>
        <Text
          as="span"
          variant="caption"
          tone="secondary"
          tabular
          truncate={1}
          className="code-hosting-row__meta"
          data-checks={row.checks}
        >
          {rowMeta(row, t, locale)}
        </Text>
      </span>
      <IconButton
        aria-label={t('codeHosting.open', { title: row.title, provider })}
        className="code-hosting-row__open"
        onPress={() => {
          void openPullRequest(row.id);
        }}
      >
        <ExternalLink strokeWidth={ICON_STROKE} />
      </IconButton>
    </li>
  );
}

interface QueueProps {
  snapshot: CodeHostingSnapshot;
  filter: CodeHostingFilter;
  onFilter: (filter: CodeHostingFilter) => void;
  onRefresh: () => void;
  locale: string;
}

/** The filter chips, the count and the refresh button, then the rows or the empty line. */
function Queue({ snapshot, filter, onFilter, onRefresh, locale }: QueueProps) {
  const { t } = useTranslation();
  const rows = filterPullRequests(snapshot.pullRequests, filter);
  const footnote =
    snapshot.error === null
      ? snapshot.fetchedAtMs === null
        ? null
        : t('codeHosting.updated', { time: formatUpdated(snapshot.fetchedAtMs, locale) })
      : describeError(snapshot.error, snapshot.fetchedAtMs, t, locale);

  return (
    <section className="code-hosting-queue" aria-label={t('codeHosting.queue')}>
      <header className="code-hosting-queue__head">
        <div
          className="code-hosting-queue__filters"
          role="group"
          aria-label={t('codeHosting.filter.label')}
        >
          {CODE_HOSTING_FILTERS.map((candidate) => (
            <Chip
              key={candidate}
              isSelected={candidate === filter}
              onChange={(selected) => {
                if (selected) onFilter(candidate);
              }}
            >
              {t(filterKey[candidate])}
            </Chip>
          ))}
        </div>
        <span className="code-hosting-queue__actions">
          <Text as="span" variant="caption" tone="tertiary" tabular>
            {t('codeHosting.count', { count: rows.length })}
          </Text>
          <IconButton
            aria-label={snapshot.fetching ? t('codeHosting.refreshing') : t('codeHosting.refresh')}
            isDisabled={snapshot.fetching}
            onPress={onRefresh}
          >
            <RefreshCw strokeWidth={ICON_STROKE} />
          </IconButton>
        </span>
      </header>
      {rows.length === 0 ? (
        <EmptyState
          className="code-hosting-empty"
          icon={<GitPullRequest size={24} strokeWidth={1.5} />}
          title={t(emptyTitleKey[filter])}
          description={t(emptyBodyKey[filter])}
        />
      ) : (
        <ol className="code-hosting-queue__list">
          {rows.map((row) => (
            <Row key={row.id} row={row} locale={locale} />
          ))}
        </ol>
      )}
      {footnote !== null && (
        <Text
          as="p"
          variant="caption"
          tone="tertiary"
          className="code-hosting-queue__note"
          data-error={snapshot.error ?? undefined}
        >
          {footnote}
        </Text>
      )}
    </section>
  );
}

/**
 * The code-hosting panel (docs/modules/code-hosting.md "Panel"): the review queue with a
 * filter for what waits on the account, its own pull requests, or both. Off, or without an
 * account, it says what to do in Settings; a poll that failed keeps the last queue and
 * explains itself in one line under it, never a dialog. The panel has no timer: the poll
 * clock lives in Rust.
 */
export function CodeHostingPanel() {
  const { t } = useTranslation();
  useCodeHostingSubscription();
  const snapshot = useCodeHostingStore((store) => store.snapshot);
  const filter = useCodeHostingStore((store) => store.filter);
  const setFilter = useCodeHostingStore((store) => store.setFilter);
  const send = useCodeHostingCommand();
  const reduceMotion = useReduceMotion();
  const enterSpring = useMotionPreset('content');
  const locale = useLocale();

  if (snapshot === null) return null;

  let body;
  if (!snapshot.enabled || snapshot.account === null) {
    const why = snapshot.enabled ? 'connect' : 'off';
    body = (
      <EmptyState
        className="code-hosting-empty"
        icon={<GitPullRequest size={24} strokeWidth={1.5} />}
        title={t(`codeHosting.empty.${why}.title`)}
        description={t(`codeHosting.empty.${why}.body`)}
        action={
          <Button variant="secondary" onPress={openSettings}>
            {t(`codeHosting.empty.${why}.action`)}
          </Button>
        }
      />
    );
  } else {
    body = (
      <Queue
        snapshot={snapshot}
        filter={filter}
        onFilter={setFilter}
        onRefresh={() => {
          send({ kind: 'refresh' });
        }}
        locale={locale}
      />
    );
  }

  return (
    <motion.div
      className="code-hosting-panel"
      initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge}
      animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
      transition={enterSpring}
    >
      {body}
    </motion.div>
  );
}
