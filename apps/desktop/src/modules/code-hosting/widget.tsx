import { Text } from '@muna/ui';
import { GitPullRequest, GitPullRequestArrow } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { WidgetProps } from '../registry';
import { useCodeHostingStore } from './code-hosting-store';
import { waitingCount } from './format';
import { useCodeHostingSubscription } from './use-code-hosting';
import './code-hosting.css';

/** Lucide icons in the card body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/** The card lists this many titles under the count (docs/modules/dashboard.md "Widgets"). */
export const WIDGET_ROWS = 3;

/**
 * The review-queue card on the dashboard: how many pull requests wait for the account's
 * review, then the first few titles; a wide card adds where each lives. Off, unconnected or
 * with nothing waiting it says so in one line.
 */
export function CodeHostingWidget({ span }: WidgetProps) {
  const { t } = useTranslation();
  useCodeHostingSubscription();
  const snapshot = useCodeHostingStore((store) => store.snapshot);

  if (snapshot === null) return null;

  const waiting = snapshot.pullRequests.filter((row) => row.reviewRequested);
  if (!snapshot.enabled || snapshot.account === null || waiting.length === 0) {
    let note: string;
    if (!snapshot.enabled) note = t('codeHosting.widget.off');
    else if (snapshot.account === null) note = t('codeHosting.widget.connect');
    else note = t('codeHosting.widget.none');
    return (
      <div className="code-hosting-widget" data-empty>
        <span className="code-hosting-widget__glyph">
          <GitPullRequest strokeWidth={ICON_STROKE} />
        </span>
        <Text as="p" variant="footnote" tone="secondary" className="code-hosting-widget__note">
          {note}
        </Text>
      </div>
    );
  }

  return (
    <div className="code-hosting-widget" aria-label={t('codeHosting.widget.label')}>
      <Text as="p" variant="footnote" weight={600} tabular className="code-hosting-widget__count">
        <GitPullRequestArrow size={14} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />
        {t('codeHosting.widget.waiting', { count: waitingCount(snapshot) })}
      </Text>
      <ol className="code-hosting-widget__list">
        {waiting.slice(0, WIDGET_ROWS).map((row) => (
          <li key={row.id} className="code-hosting-widget__row">
            <Text as="span" variant="caption" truncate={1} className="code-hosting-widget__title">
              {row.title}
            </Text>
            {span === 2 && (
              <Text
                as="span"
                variant="caption"
                tone="tertiary"
                tabular
                truncate={1}
                className="code-hosting-widget__where"
              >
                {t('codeHosting.pullRequest', { repo: row.repo, number: row.number })}
              </Text>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
