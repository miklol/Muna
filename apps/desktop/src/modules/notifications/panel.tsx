import type {
  IpcError,
  NotificationGroup,
  NotificationsCommand,
  NotificationsSnapshot,
  NotificationView,
} from '@muna/contracts';
import {
  defaultSettings,
  readNotificationsSettings,
  writeNotificationsSettings,
} from '@muna/contracts';
import type { MessageKey, Translate } from '@muna/i18n';
import {
  Button,
  Chip,
  contentExitTransition,
  contentRecipe,
  EmptyState,
  IconButton,
  Text,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, ExternalLink, Moon, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocale } from '../../lib/locale';
import { useMinuteNow } from '../../lib/minute-now';
import { persistSettings, useSettings } from '../../lib/settings';
import { type PendingKey, useNotificationsStore } from './notifications-store';
import './notifications.css';
import { relativeTime } from './relative-time';
import {
  openWindowsSettings,
  useNotificationsCommand,
  useNotificationsSubscription,
} from './use-notifications';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/** The i18n key for a refused command, by the IPC error code the platform layer maps to. */
export const errorKey = (error: IpcError): MessageKey => {
  switch (error.code) {
    case 'platform.notFound':
      return 'notifications.error.notFound';
    case 'platform.accessDenied':
      return 'notifications.error.accessDenied';
    case 'platform.unsupported':
      return 'notifications.error.unsupported';
    default:
      return 'notifications.error.os';
  }
};

/** A toast's title as the card shows it; one without text is still a notification. */
export const cardTitle = (view: NotificationView, t: Translate): string =>
  view.title === '' ? t('notifications.untitled') : view.title;

/** The letter that stands in for a sender Windows has no logo for. */
export const initialOf = (appName: string, locale: string): string => {
  const [first] = appName.trim();
  return (first ?? '?').toLocaleUpperCase(locale);
};

interface ErrorTextProps {
  children: ReactNode;
}

/** A refusal under a card or the header, in `--accent-red`; announced when it appears. */
function ErrorText({ children }: ErrorTextProps) {
  return (
    <span role="alert" className="ntf-error">
      {children}
    </span>
  );
}

interface SenderLogoProps {
  group: NotificationGroup;
  locale: string;
}

/** The sender's 36 px logo, or its initial on a tinted disc when Windows has none. */
function SenderLogo({ group, locale }: SenderLogoProps) {
  if (group.logo !== null) {
    return <img className="ntf-logo" src={group.logo} alt="" draggable={false} />;
  }
  return (
    <span className="ntf-logo ntf-logo--initial" aria-hidden="true">
      {initialOf(group.appName, locale)}
    </span>
  );
}

interface CardProps {
  view: NotificationView;
  fresh: boolean;
  pending: boolean;
  error: IpcError | undefined;
  nowMs: number;
  locale: string;
  send: (command: NotificationsCommand) => void;
}

/**
 * One notification: title, up to two lines of body, when it arrived, and *Open* and *Dismiss*
 * that show on hover or focus (and always without a pointer). A dot marks what was unread
 * when the panel opened.
 */
function Card({ view, fresh, pending, error, nowMs, locale, send }: CardProps) {
  const { t } = useTranslation();
  const title = cardTitle(view, t);
  return (
    <div className="ntf-card" data-fresh={fresh || undefined} data-pending={pending || undefined}>
      <div className="ntf-card__text">
        <span className="ntf-card__head">
          {fresh && (
            <span className="ntf-card__dot" role="img" aria-label={t('notifications.unreadMark')} />
          )}
          <Text as="span" variant="footnote" truncate={1} className="ntf-card__title">
            {title}
          </Text>
          <Text as="span" variant="caption2" tone="secondary" className="ntf-card__time">
            {relativeTime(view.createdAtMs, nowMs, locale, { justNow: t('notifications.justNow') })}
          </Text>
        </span>
        {view.body !== '' && (
          <Text
            as="span"
            variant="caption"
            tone="secondary"
            truncate={2}
            className="ntf-card__body"
          >
            {view.body}
          </Text>
        )}
        {error !== undefined && <ErrorText>{t(errorKey(error))}</ErrorText>}
      </div>
      <span className="ntf-card__actions">
        <IconButton
          aria-label={t('notifications.openNamed', { title })}
          isDisabled={pending}
          onPress={() => {
            send({ kind: 'open', id: view.id });
          }}
        >
          <ExternalLink strokeWidth={ICON_STROKE} />
        </IconButton>
        <IconButton
          aria-label={t('notifications.dismissNamed', { title })}
          isDisabled={pending}
          onPress={() => {
            send({ kind: 'dismiss', id: view.id });
          }}
        >
          <X strokeWidth={ICON_STROKE} />
        </IconButton>
      </span>
    </div>
  );
}

interface GroupProps {
  group: NotificationGroup;
  fresh: ReadonlySet<number>;
  pending: ReadonlySet<PendingKey>;
  errors: Readonly<Partial<Record<PendingKey, IpcError>>>;
  nowMs: number;
  locale: string;
  send: (command: NotificationsCommand) => void;
  onMute: (appId: string, muted: boolean) => void;
}

/** One sender: logo, name, how many, mute and clear on the right, then its cards newest first. */
function Group({ group, fresh, pending, errors, nowMs, locale, send, onMute }: GroupProps) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const layoutSpring = useMotionPreset('layout');
  const enterSpring = useMotionPreset('content');
  const appKey: PendingKey = `app:${group.appId}`;
  const appPending = pending.has(appKey);
  const appError = errors[appKey];
  const enterFrom = reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge;
  const visible = reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible;
  const exitTo = {
    ...(reduceMotion ? contentRecipe.reducedExitTo : contentRecipe.exitTo),
    transition: contentExitTransition,
  };
  return (
    <section className="ntf-group" aria-label={group.appName} data-muted={group.muted || undefined}>
      <div className="ntf-group__head">
        <SenderLogo group={group} locale={locale} />
        <span className="ntf-group__name">
          <Text as="span" variant="body" truncate={1} className="ntf-group__app">
            {group.appName}
          </Text>
          <Text as="span" variant="caption" tone="secondary" tabular>
            {t('notifications.count', { count: group.notifications.length })}
          </Text>
        </span>
        {group.muted && (
          <Chip icon={<BellOff strokeWidth={ICON_STROKE} />}>{t('notifications.muted')}</Chip>
        )}
        <span className="ntf-group__actions">
          <IconButton
            aria-label={t(group.muted ? 'notifications.unmute' : 'notifications.mute', {
              app: group.appName,
            })}
            onPress={() => {
              onMute(group.appId, !group.muted);
            }}
          >
            {group.muted ? (
              <Bell strokeWidth={ICON_STROKE} />
            ) : (
              <BellOff strokeWidth={ICON_STROKE} />
            )}
          </IconButton>
          <IconButton
            aria-label={t('notifications.clearApp', { app: group.appName })}
            isDisabled={appPending}
            onPress={() => {
              send({ kind: 'dismissApp', appId: group.appId });
            }}
          >
            <Trash2 strokeWidth={ICON_STROKE} />
          </IconButton>
        </span>
      </div>
      {appError !== undefined && <ErrorText>{t(errorKey(appError))}</ErrorText>}
      <ul className="ntf-cards">
        <AnimatePresence mode="popLayout" initial={false}>
          {group.notifications.map((view) => {
            const key: PendingKey = `notification:${view.id}`;
            return (
              <motion.li
                key={view.id}
                layout={!reduceMotion}
                initial={enterFrom}
                animate={visible}
                exit={exitTo}
                transition={{ ...enterSpring, layout: layoutSpring }}
                className="ntf-cards__item"
              >
                <Card
                  view={view}
                  fresh={fresh.has(view.id)}
                  pending={appPending || pending.has(key)}
                  error={errors[key]}
                  nowMs={nowMs}
                  locale={locale}
                  send={send}
                />
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}

interface AccessNoticeProps {
  snapshot: NotificationsSnapshot;
  pending: boolean;
  error: IpcError | undefined;
  send: (command: NotificationsCommand) => void;
}

/**
 * The single explanatory state for each way the Action Center is out of reach: never asked
 * (*Allow* shows the consent prompt), refused (Windows Settings, then *Check again*), or a
 * Windows without a listener. Nothing polls in any of them.
 */
function AccessNotice({ snapshot, pending, error, send }: AccessNoticeProps) {
  const { t } = useTranslation();
  const refusal = error === undefined ? null : <ErrorText>{t(errorKey(error))}</ErrorText>;
  switch (snapshot.access) {
    case 'unspecified':
      return (
        <EmptyState
          className="ntf-empty"
          icon={<Bell size={24} strokeWidth={1.5} />}
          title={t('notifications.unspecified.title')}
          description={t('notifications.unspecified.body')}
          action={
            <span className="ntf-empty__actions">
              <Button
                variant="primary"
                isDisabled={pending}
                onPress={() => {
                  send({ kind: 'requestAccess' });
                }}
              >
                {pending
                  ? t('notifications.unspecified.asking')
                  : t('notifications.unspecified.action')}
              </Button>
              {refusal}
            </span>
          }
        />
      );
    case 'denied':
      return (
        <EmptyState
          className="ntf-empty"
          icon={<BellOff size={24} strokeWidth={1.5} />}
          title={t('notifications.denied.title')}
          description={t('notifications.denied.body')}
          action={
            <span className="ntf-empty__actions">
              <Button
                variant="primary"
                onPress={() => {
                  openWindowsSettings('privacy');
                }}
              >
                {t('notifications.denied.action')}
              </Button>
              <Button
                variant="secondary"
                isDisabled={pending}
                onPress={() => {
                  send({ kind: 'requestAccess' });
                }}
              >
                {t('notifications.denied.recheck')}
              </Button>
              {refusal}
            </span>
          }
        />
      );
    case 'unavailable':
      return (
        <EmptyState
          className="ntf-empty"
          icon={<BellOff size={24} strokeWidth={1.5} />}
          title={t('notifications.unavailable.title')}
          description={t('notifications.unavailable.body')}
        />
      );
    case 'allowed':
      return null;
  }
}

/**
 * The notifications panel (docs/modules/notifications.md): the Action Center grouped by
 * sender, newest sender first, each with its logo, name, count, and mute and clear on the
 * right; cards carry the title, two lines of body, when it arrived, and *Open* and *Dismiss*.
 * The header counts what is unread, points at Windows focus settings while a focus session
 * is on, and clears everything. Opening the panel marks everything read — the glance in the
 * strip retracts — while the cards that were new keep a dot until the panel closes. Without
 * consent, one explanatory state says what to do. The panel's only timer is the shared minute
 * clock that moves the relative times while it is open.
 */
export function NotificationsPanel() {
  const { t } = useTranslation();
  useNotificationsSubscription();
  const snapshot = useNotificationsStore((store) => store.snapshot);
  const fresh = useNotificationsStore((store) => store.fresh);
  const pending = useNotificationsStore((store) => store.pending);
  const errors = useNotificationsStore((store) => store.errors);
  const forgetFresh = useNotificationsStore((store) => store.forgetFresh);
  const send = useNotificationsCommand();
  const queryClient = useQueryClient();
  const document = useSettings() ?? defaultSettings();
  const reduceMotion = useReduceMotion();
  const enterSpring = useMotionPreset('content');
  const locale = useLocale();
  const nowMs = useMinuteNow().getTime();

  // Whatever was fresh before this opening is not any more; and nothing is once it closes.
  useEffect(() => {
    forgetFresh();
    return forgetFresh;
  }, [forgetFresh]);

  // The panel is the Action Center on screen: seeing it is reading it (mark read on expand).
  const unread = snapshot?.access === 'allowed' ? snapshot.unread : 0;
  useEffect(() => {
    if (unread > 0) send({ kind: 'markRead' });
  }, [unread, send]);

  if (snapshot === null) return null;

  const setMuted = (appId: string, muted: boolean) => {
    const current = readNotificationsSettings(document);
    const others = current.mutedApps.filter((known) => known !== appId);
    persistSettings(
      queryClient,
      writeNotificationsSettings(document, {
        ...current,
        mutedApps: muted ? [...others, appId] : others,
      }),
    );
  };

  let body: ReactNode;
  if (snapshot.access !== 'allowed') {
    body = (
      <AccessNotice
        snapshot={snapshot}
        pending={pending.has('access')}
        error={errors.access}
        send={send}
      />
    );
  } else if (snapshot.groups.length === 0) {
    body = (
      <EmptyState
        className="ntf-empty"
        icon={<Bell size={24} strokeWidth={1.5} />}
        title={t('notifications.empty.title')}
        description={t('notifications.empty.body')}
      />
    );
  } else {
    body = (
      <ul className="ntf-groups" aria-label={t('notifications.list')}>
        {snapshot.groups.map((group) => (
          <li key={group.appId} className="ntf-groups__item">
            <Group
              group={group}
              fresh={fresh}
              pending={pending}
              errors={errors}
              nowMs={nowMs}
              locale={locale}
              send={send}
              onMute={setMuted}
            />
          </li>
        ))}
      </ul>
    );
  }

  const showHead =
    snapshot.access === 'allowed' && (snapshot.groups.length > 0 || snapshot.focusActive === true);
  const clearing = pending.has('all');

  return (
    <motion.div
      className="ntf-panel"
      data-access={snapshot.access}
      initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge}
      animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
      transition={enterSpring}
    >
      {showHead && (
        <div className="ntf-head">
          <span className="ntf-head__state">
            {fresh.size > 0 && (
              <Chip icon={<Bell strokeWidth={ICON_STROKE} />}>
                {t('notifications.unread', { count: fresh.size })}
              </Chip>
            )}
            {snapshot.focusActive === true && (
              <Button
                variant="secondary"
                icon={<Moon strokeWidth={ICON_STROKE} />}
                className="ntf-head__focus"
                onPress={() => {
                  openWindowsSettings('focus');
                }}
              >
                {t('notifications.focusOn')}
              </Button>
            )}
          </span>
          {errors.all !== undefined && <ErrorText>{t(errorKey(errors.all))}</ErrorText>}
          {snapshot.groups.length > 0 && (
            <Button
              variant="secondary"
              isDisabled={clearing}
              onPress={() => {
                send({ kind: 'clear' });
              }}
            >
              {clearing ? t('notifications.clearing') : t('notifications.clearAll')}
            </Button>
          )}
        </div>
      )}
      {body}
    </motion.div>
  );
}
