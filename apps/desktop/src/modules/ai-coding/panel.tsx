import { type AiCodingSnapshot, type AiSession, commands } from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import {
  Button,
  Chip,
  contentRecipe,
  DecisionButtons,
  EmptyState,
  IconButton,
  Text,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import { RefreshCw, SquareArrowOutUpRight, Terminal, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocale } from '../../lib/locale';
import { useAiCodingStore } from './ai-coding-store';
import {
  agentKey,
  fileName,
  formatClock,
  formatElapsed,
  stateSince,
  statusKey,
  statusTint,
  usageLine,
  waitingText,
} from './format';
import { type AiCodingFailure, useAiCodingCommand, useAiCodingSubscription } from './use-ai-coding';
import './ai-coding.css';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

const failureKey: Readonly<Record<AiCodingFailure, MessageKey>> = {
  unknown: 'aiCoding.error.unknown',
  notWaiting: 'aiCoding.error.notWaiting',
  noProfile: 'aiCoding.error.noProfile',
  hooksFile: 'aiCoding.error.hooksFile',
  io: 'aiCoding.error.io',
  failed: 'aiCoding.error.failed',
};

const openSettings = () => {
  void commands.openSettings().catch(() => {
    // Outside Tauri (tests, Storybook) there is no settings window.
  });
};

interface RowActions {
  onDecide: (session: string, allow: boolean) => void;
  onFocus: (session: string) => void;
  onDismiss: (session: string) => void;
  /** The session whose answer is on its way: its pair dims until Rust retracts the prompt. */
  pending: string | null;
}

interface RowProps extends RowActions {
  session: AiSession;
  /** The snapshot's clock, which every elapsed time is measured against. */
  now: number;
  locale: string;
}

/**
 * One live session (docs/modules/ai-coding.md "Panel"): the terminal glyph with a status dot,
 * the project and its chips, what the agent does or waits for, and the meta line. A held
 * permission prompt puts the *Allow* / *Deny* pair on the right; any session whose terminal
 * Rust can find gets *Show*; a session that stopped for the user can be dismissed.
 */
function Row({ session, now, locale, onDecide, onFocus, onDismiss, pending }: RowProps) {
  const { t } = useTranslation();
  const project = session.project ?? t('aiCoding.row.noProject');
  const agent = t(agentKey[session.agent]);
  const tint = statusTint(session.status);
  const waiting = session.waiting;
  const elapsed = formatElapsed(now - stateSince(session), t);

  const meta = [
    agent,
    session.branch,
    session.status === 'waiting'
      ? t('aiCoding.row.waitingFor', { duration: elapsed })
      : t('aiCoding.row.running', { duration: elapsed }),
    usageLine(session, t, locale),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  let line: string | null;
  let detail: string | null = null;
  if (waiting !== null) {
    line = waitingText(waiting, t);
    detail = waiting.detail;
  } else {
    line = session.task;
    detail = session.file === null ? null : fileName(session.file);
  }

  return (
    <li
      className="ai-coding-row"
      data-status={session.status}
      aria-label={t('aiCoding.row.describe', {
        agent,
        project,
        status: t(statusKey[session.status]),
      })}
    >
      <span className="ai-coding-row__glyph" aria-hidden>
        <Terminal size={20} strokeWidth={1.5} />
        {tint !== null && <span className="ai-coding-row__dot" data-tint={tint} />}
      </span>
      <span className="ai-coding-row__text">
        <span className="ai-coding-row__title">
          <Text as="span" variant="footnote" weight={600} truncate={1}>
            {project}
          </Text>
          <Chip>{t(statusKey[session.status])}</Chip>
          {session.agent === 'copilot' && <Chip>{t('aiCoding.row.cli')}</Chip>}
          {session.model !== null && <Chip className="ai-coding-row__model">{session.model}</Chip>}
        </span>
        {(line !== null || detail !== null) && (
          <span className="ai-coding-row__line">
            {line !== null && (
              <Text
                as="span"
                variant="caption"
                tone="secondary"
                truncate={1}
                className="ai-coding-row__task"
                data-waiting={waiting !== null || undefined}
              >
                {line}
              </Text>
            )}
            {detail !== null && (
              <Text
                as="span"
                variant="caption"
                tone="tertiary"
                truncate={1}
                className="ai-coding-row__detail"
              >
                {detail}
              </Text>
            )}
          </span>
        )}
        <Text
          as="span"
          variant="caption"
          tone="tertiary"
          tabular
          truncate={1}
          className="ai-coding-row__meta"
        >
          {meta}
        </Text>
      </span>
      <span className="ai-coding-row__actions">
        {waiting?.decidable === true && (
          <DecisionButtons
            aria-label={t('strip.describe.decision')}
            allowLabel={t('aiCoding.row.allow')}
            denyLabel={t('aiCoding.row.deny')}
            isDisabled={pending === session.id}
            onAllow={() => {
              onDecide(session.id, true);
            }}
            onDeny={() => {
              onDecide(session.id, false);
            }}
          />
        )}
        {session.canFocus && (
          <IconButton
            aria-label={t('aiCoding.row.showLabel', { project })}
            onPress={() => {
              onFocus(session.id);
            }}
          >
            <SquareArrowOutUpRight strokeWidth={ICON_STROKE} />
          </IconButton>
        )}
        {session.status === 'waiting' && waiting?.decidable !== true && (
          <IconButton
            aria-label={t('aiCoding.row.dismissLabel', { project })}
            onPress={() => {
              onDismiss(session.id);
            }}
          >
            <X strokeWidth={ICON_STROKE} />
          </IconButton>
        )}
      </span>
    </li>
  );
}

interface RecentRowProps {
  session: AiSession;
  locale: string;
  onDismiss: (session: string) => void;
}

/** A finished session: the project, the agent and when it ended, with a way to take it out. */
function RecentRow({ session, locale, onDismiss }: RecentRowProps) {
  const { t } = useTranslation();
  const project = session.project ?? t('aiCoding.row.noProject');
  return (
    <li className="ai-coding-recent__row">
      <Text as="span" variant="caption" truncate={1} className="ai-coding-recent__project">
        {project}
      </Text>
      <Text as="span" variant="caption" tone="tertiary" tabular truncate={1}>
        {t('aiCoding.recent.finished', {
          time: formatClock(session.updatedAtMs, locale),
        })}
        {' · '}
        {t(agentKey[session.agent])}
      </Text>
      <IconButton
        aria-label={t('aiCoding.row.dismissLabel', { project })}
        onPress={() => {
          onDismiss(session.id);
        }}
      >
        <X strokeWidth={ICON_STROKE} />
      </IconButton>
    </li>
  );
}

interface SessionsProps extends RowActions {
  snapshot: AiCodingSnapshot;
  locale: string;
  onRefresh: () => void;
  note: string | null;
}

/** The counts and the refresh button, the live rows (or why there are none), then *Recent*. */
function Sessions({ snapshot, locale, onRefresh, note, ...actions }: SessionsProps) {
  const { t } = useTranslation();
  const waiting = snapshot.sessions.filter((session) => session.status === 'waiting').length;
  const counts = [t('aiCoding.header.active', { count: snapshot.sessions.length })];
  if (waiting > 0) counts.push(t('aiCoding.header.waiting', { count: waiting }));

  let live;
  if (snapshot.sessions.length === 0) {
    const why = snapshot.receiver.claudeHooksInstalled ? 'none' : 'hooks';
    live = (
      <EmptyState
        className="ai-coding-empty"
        icon={<Terminal size={24} strokeWidth={1.5} />}
        title={t(`aiCoding.empty.${why}.title`)}
        description={t(`aiCoding.empty.${why}.body`)}
        action={
          why === 'hooks' ? (
            <Button variant="secondary" onPress={openSettings}>
              {t('aiCoding.empty.hooks.action')}
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    live = (
      <ol className="ai-coding-sessions__list" aria-label={t('aiCoding.sessions')}>
        {snapshot.sessions.map((session) => (
          <Row
            key={session.id}
            session={session}
            now={snapshot.generatedAtMs}
            locale={locale}
            {...actions}
          />
        ))}
      </ol>
    );
  }

  return (
    <section className="ai-coding-sessions" aria-label={t('aiCoding.title')}>
      <header className="ai-coding-sessions__head">
        <Text as="span" variant="caption" tone="tertiary" tabular truncate={1}>
          {counts.join(' · ')}
        </Text>
        <IconButton aria-label={t('aiCoding.header.refresh')} onPress={onRefresh}>
          <RefreshCw strokeWidth={ICON_STROKE} />
        </IconButton>
      </header>
      <div className="ai-coding-sessions__scroll">
        {live}
        {snapshot.recent.length > 0 && (
          <section className="ai-coding-recent" aria-label={t('aiCoding.recent.label')}>
            <Text as="p" variant="caption" tone="tertiary" className="ai-coding-recent__label">
              {t('aiCoding.recent.label')}
            </Text>
            <ol className="ai-coding-recent__list">
              {snapshot.recent.map((session) => (
                <RecentRow
                  key={session.id}
                  session={session}
                  locale={locale}
                  onDismiss={actions.onDismiss}
                />
              ))}
            </ol>
          </section>
        )}
      </div>
      {note !== null && (
        <Text as="p" variant="caption" tone="secondary" role="status" className="ai-coding-note">
          {note}
        </Text>
      )}
    </section>
  );
}

/**
 * The AI coding panel (docs/modules/ai-coding.md "Panel"): every live Claude Code and Copilot
 * CLI session, the ones that stopped for the user first, with *Allow* / *Deny* where the agent
 * holds a permission prompt, then the sessions that finished today. Off, it says what to do in
 * Settings; a refused command explains itself in one line under the list, never a dialog. The
 * panel has no timer: the elapsed times are the snapshot's, which Rust refreshes while the
 * panel watches.
 */
export function AiCodingPanel() {
  const { t } = useTranslation();
  useAiCodingSubscription();
  const snapshot = useAiCodingStore((store) => store.snapshot);
  const send = useAiCodingCommand();
  const reduceMotion = useReduceMotion();
  const enterSpring = useMotionPreset('content');
  const locale = useLocale();
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<AiCodingFailure | null>(null);

  if (snapshot === null) return null;

  const run = (command: Parameters<typeof send>[0]) => {
    setFailure(null);
    return send(command).then((outcome) => {
      if (outcome.status === 'error') setFailure(outcome.failure);
    });
  };

  let body;
  if (!snapshot.enabled) {
    body = (
      <EmptyState
        className="ai-coding-empty"
        icon={<Terminal size={24} strokeWidth={1.5} />}
        title={t('aiCoding.empty.off.title')}
        description={t('aiCoding.empty.off.body')}
        action={
          <Button variant="secondary" onPress={openSettings}>
            {t('aiCoding.empty.off.action')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <Sessions
        snapshot={snapshot}
        locale={locale}
        note={failure === null ? null : t(failureKey[failure])}
        pending={pending}
        onRefresh={() => {
          void run({ kind: 'refresh' });
        }}
        onDecide={(session, allow) => {
          setPending(session);
          void run({ kind: allow ? 'allow' : 'deny', session }).finally(() => {
            setPending((current) => (current === session ? null : current));
          });
        }}
        onFocus={(session) => {
          void run({ kind: 'focus', session });
        }}
        onDismiss={(session) => {
          void run({ kind: 'dismiss', session });
        }}
      />
    );
  }

  return (
    <motion.div
      className="ai-coding-panel"
      initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge}
      animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
      transition={enterSpring}
    >
      {body}
    </motion.div>
  );
}
