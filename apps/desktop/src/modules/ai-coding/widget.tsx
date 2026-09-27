import { runningSessions, waitingSessions } from '@muna/contracts';
import { Text } from '@muna/ui';
import { Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { WidgetProps } from '../registry';
import { useAiCodingStore } from './ai-coding-store';
import { agentKey, waitingText } from './format';
import { useAiCodingSubscription } from './use-ai-coding';
import './ai-coding.css';

/** Lucide icons in the card body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/** The card lists this many sessions under the count (docs/modules/dashboard.md "Widgets"). */
export const WIDGET_ROWS = 3;

/**
 * The AI coding card on the dashboard: how many agents run and how many wait for the user,
 * then the first projects, the waiting ones first; a wide card adds what each is doing. Off or
 * with nothing running it says so in one line.
 */
export function AiCodingWidget({ span }: WidgetProps) {
  const { t } = useTranslation();
  useAiCodingSubscription();
  const snapshot = useAiCodingStore((store) => store.snapshot);

  if (snapshot === null) return null;

  if (!snapshot.enabled || snapshot.sessions.length === 0) {
    return (
      <div className="ai-coding-widget" data-empty>
        <span className="ai-coding-widget__glyph">
          <Terminal strokeWidth={ICON_STROKE} />
        </span>
        <Text as="p" variant="footnote" tone="secondary" className="ai-coding-widget__note">
          {snapshot.enabled ? t('aiCoding.widget.empty') : t('aiCoding.widget.off')}
        </Text>
      </div>
    );
  }

  const waiting = waitingSessions(snapshot.sessions);
  const running = runningSessions(snapshot.sessions);
  const counts: string[] = [];
  if (waiting.length > 0) counts.push(t('aiCoding.widget.waiting', { count: waiting.length }));
  if (running.length > 0) counts.push(t('aiCoding.widget.running', { count: running.length }));

  return (
    <div className="ai-coding-widget" aria-label={t('aiCoding.widget.label')}>
      <Text
        as="p"
        variant="footnote"
        weight={600}
        tabular
        className="ai-coding-widget__count"
        data-waiting={waiting.length > 0 || undefined}
      >
        <Terminal size={14} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />
        {counts.join(' · ')}
      </Text>
      <ol className="ai-coding-widget__list">
        {snapshot.sessions.slice(0, WIDGET_ROWS).map((session) => (
          <li key={session.id} className="ai-coding-widget__row">
            <Text as="span" variant="caption" truncate={1} className="ai-coding-widget__project">
              {session.project ?? t(agentKey[session.agent])}
            </Text>
            {span === 2 && (
              <Text
                as="span"
                variant="caption"
                tone="tertiary"
                truncate={1}
                className="ai-coding-widget__state"
                data-waiting={session.waiting !== null || undefined}
              >
                {session.waiting !== null
                  ? waitingText(session.waiting, t)
                  : (session.task ?? t(agentKey[session.agent]))}
              </Text>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
