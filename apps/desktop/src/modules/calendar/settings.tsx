import {
  CALENDAR_REFRESH_CHOICES_MINUTES,
  type CalendarRefreshMinutes,
  type CalendarSettings,
  isCalendarRefresh,
  readCalendarSettings,
  type SourceSetting,
  type SourceView,
  type Tint,
  writeCalendarSettings,
} from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import {
  Button,
  Chip,
  IconButton,
  ListRow,
  type SegmentedControlItem,
  Text,
  TextField,
  tintVar,
  Toggle,
} from '@muna/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Plus, Trash2 } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cacheSettings } from '../../lib/settings';
import { Section, SegmentedRow, ToggleRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { useCalendarStore } from './calendar-store';
import { type AddFailure, addSource, removeSource, useCalendarSubscription } from './use-calendar';
import './calendar-settings.css';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

/** The colours a calendar can take, in the order the chips show them. */
export const SOURCE_TINTS: readonly Tint[] = [
  'purple',
  'blue',
  'cyan',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
];

const tintKey: Record<Tint, MessageKey> = {
  blue: 'calendar.settings.colors.blue',
  cyan: 'calendar.settings.colors.cyan',
  green: 'calendar.settings.colors.green',
  orange: 'calendar.settings.colors.orange',
  red: 'calendar.settings.colors.red',
  purple: 'calendar.settings.colors.purple',
  yellow: 'calendar.settings.colors.yellow',
  pink: 'calendar.settings.colors.pink',
};

const failureKey: Record<AddFailure, MessageKey> = {
  malformed: 'calendar.settings.addFailed.malformed',
  scheme: 'calendar.settings.addFailed.scheme',
  credentials: 'calendar.settings.addFailed.credentials',
  vault: 'calendar.settings.addFailed.vault',
  failed: 'calendar.settings.addFailed.failed',
};

const dotStyle = (tint: Tint): CSSProperties =>
  ({ '--calendar-tint': tintVar(tint) }) as CSSProperties;

type Translate = ReturnType<typeof useTranslation>['t'];

const formatUpdated = (ms: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(ms);

/** One line under a calendar's name: its host and where its last fetch stands. */
export const describeSource = (
  setting: SourceSetting,
  view: SourceView | undefined,
  t: Translate,
  locale: string,
): string => {
  const parts: string[] = [setting.host];
  if (!setting.enabled) {
    parts.push(t('calendar.settings.status.off'));
  } else if (view === undefined || view.status.kind === 'idle') {
    const fetchedAtMs = view?.fetchedAtMs ?? null;
    parts.push(
      fetchedAtMs === null
        ? t('calendar.settings.status.idle')
        : t('calendar.settings.status.ok', { time: formatUpdated(fetchedAtMs, locale) }),
    );
  } else if (view.status.kind === 'fetching') {
    parts.push(t('calendar.settings.status.fetching'));
  } else if (view.status.kind === 'ok') {
    parts.push(
      t('calendar.settings.status.ok', {
        time: view.fetchedAtMs === null ? '' : formatUpdated(view.fetchedAtMs, locale),
      }),
      t('calendar.settings.events', { count: view.eventCount }),
    );
  } else if (view.status.error === 'offline') {
    parts.push(
      view.fetchedAtMs === null
        ? t('calendar.settings.status.offline')
        : t('calendar.settings.status.offlineCached', {
            time: formatUpdated(view.fetchedAtMs, locale),
          }),
    );
  } else {
    parts.push(t(`calendar.settings.status.${view.status.error}`));
  }
  return parts.join(' · ');
};

type AddState =
  | { phase: 'idle' }
  | { phase: 'adding' }
  | { phase: 'added'; name: string }
  | { phase: 'failed'; failure: AddFailure | 'nameMissing' };

interface AddSourceProps {
  onAdded: (source: SourceSetting) => void;
}

/**
 * The form that subscribes to a feed: a name, the link and a colour. The link goes to Rust
 * once and is never echoed back; a refusal is explained under the form in plain words.
 */
export function AddSource({ onAdded }: AddSourceProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState<Tint>('purple');
  const [state, setState] = useState<AddState>({ phase: 'idle' });

  const submit = () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (trimmedUrl === '') return;
    if (trimmedName === '') {
      setState({ phase: 'failed', failure: 'nameMissing' });
      return;
    }
    setState({ phase: 'adding' });
    void addSource(trimmedName, trimmedUrl, color).then((outcome) => {
      if (outcome.status === 'ok') {
        setName('');
        setUrl('');
        setState({ phase: 'added', name: outcome.source.name });
        onAdded(outcome.source);
      } else {
        setState({ phase: 'failed', failure: outcome.failure });
      }
    });
  };

  let feedback: string | null = null;
  if (state.phase === 'adding') feedback = t('calendar.settings.adding');
  else if (state.phase === 'added') feedback = t('calendar.settings.added', { name: state.name });
  else if (state.phase === 'failed') {
    feedback =
      state.failure === 'nameMissing'
        ? t('calendar.settings.nameMissing')
        : t(failureKey[state.failure]);
  }

  return (
    <div className="calendar-add">
      <div className="calendar-add__fields">
        <TextField
          aria-label={t('calendar.settings.name')}
          placeholder={t('calendar.settings.namePlaceholder')}
          className="calendar-add__name"
          value={name}
          onChange={setName}
          onSubmit={submit}
        />
        <TextField
          aria-label={t('calendar.settings.address')}
          placeholder={t('calendar.settings.addressPlaceholder')}
          className="calendar-add__url"
          leading={<Link size={16} strokeWidth={1.75} aria-hidden focusable={false} />}
          value={url}
          onChange={setUrl}
          onSubmit={submit}
        />
      </div>
      <div className="calendar-add__row">
        <div
          className="calendar-add__colors"
          role="group"
          aria-label={t('calendar.settings.color')}
        >
          {SOURCE_TINTS.map((tint) => (
            <Chip
              key={tint}
              icon={<span className="calendar-dot" style={dotStyle(tint)} />}
              isSelected={tint === color}
              onChange={(selected) => {
                if (selected) setColor(tint);
              }}
            >
              {t(tintKey[tint])}
            </Chip>
          ))}
        </div>
        <Button
          variant="primary"
          icon={<Plus strokeWidth={1.75} />}
          isDisabled={state.phase === 'adding' || url.trim() === ''}
          onPress={submit}
        >
          {t('calendar.settings.addAction')}
        </Button>
      </div>
      {feedback !== null && (
        <Text
          as="p"
          variant="footnote"
          tone="secondary"
          role="status"
          className="calendar-add__note"
        >
          {feedback}
        </Text>
      )}
    </div>
  );
}

/**
 * Settings → Calendar (docs/modules/calendar.md): the subscribed calendars with their state,
 * the form that adds one, the refresh period and the strip options. The pane leads with what
 * leaves the PC and where the links are kept, because that is the decision adding one is.
 */
export function CalendarSettingsPane() {
  const { t, i18n } = useTranslation();
  const { settings, update } = useSettingsEditor();
  const queryClient = useQueryClient();
  useCalendarSubscription();
  const snapshot = useCalendarStore((store) => store.snapshot);
  const calendar = readCalendarSettings(settings);
  const locale = i18n.resolvedLanguage ?? i18n.language;

  const write = (recipe: (current: CalendarSettings) => CalendarSettings) => {
    update((current) => writeCalendarSettings(current, recipe(readCalendarSettings(current))));
  };

  const refreshItems: readonly SegmentedControlItem<`${CalendarRefreshMinutes}`>[] =
    CALENDAR_REFRESH_CHOICES_MINUTES.map((minutes) => ({
      id: `${minutes}` as const,
      label: t('calendar.settings.minutes', { count: minutes }),
    }));

  const viewOf = (id: string): SourceView | undefined =>
    snapshot?.sources.find((source) => source.id === id);

  return (
    <>
      <Section
        title={t('calendar.settings.section')}
        description={t('calendar.settings.privacy')}
        visible={everything}
        rows={[
          ...calendar.sources.map((source) => ({
            id: `calendar.source.${source.id}`,
            node: (
              <ListRow
                icon={
                  <span
                    className="calendar-dot calendar-dot--large"
                    style={dotStyle(source.color)}
                  />
                }
                label={source.name}
                description={describeSource(source, viewOf(source.id), t, locale)}
                trailingIsControl
                trailing={
                  <span className="calendar-source__controls">
                    <Toggle
                      aria-label={t('calendar.settings.show', { name: source.name })}
                      isSelected={source.enabled}
                      onChange={(enabled) => {
                        write((current) => ({
                          ...current,
                          sources: current.sources.map((candidate) =>
                            candidate.id === source.id ? { ...candidate, enabled } : candidate,
                          ),
                        }));
                      }}
                    />
                    <IconButton
                      aria-label={t('calendar.settings.remove', { name: source.name })}
                      onPress={() => {
                        void removeSource(source.id).then((saved) => {
                          if (saved !== null) cacheSettings(queryClient, saved);
                        });
                      }}
                    >
                      <Trash2 />
                    </IconButton>
                  </span>
                }
              />
            ),
          })),
          {
            id: 'calendar.add',
            node: (
              <div className="calendar-add__frame">
                <div className="calendar-add__heading">
                  <Text as="span" variant="footnote" weight={600}>
                    {t('calendar.settings.add')}
                  </Text>
                  <Text as="span" variant="caption" tone="secondary">
                    {t('calendar.settings.addBody')}
                  </Text>
                </div>
                <AddSource
                  onAdded={(source) => {
                    cacheSettings(
                      queryClient,
                      writeCalendarSettings(settings, {
                        ...calendar,
                        sources: [
                          ...calendar.sources.filter((candidate) => candidate.id !== source.id),
                          source,
                        ],
                      }),
                    );
                  }}
                />
              </div>
            ),
          },
        ]}
      />
      <Section
        title={t('calendar.settings.refresh')}
        visible={everything}
        rows={[
          {
            id: 'calendar.refresh',
            node: (
              <SegmentedRow
                label={t('calendar.settings.refreshEvery')}
                description={t('calendar.settings.refreshBody')}
                items={refreshItems}
                value={`${calendar.refreshMinutes}`}
                onChange={(id) => {
                  const minutes = Number(id);
                  write((current) => ({
                    ...current,
                    refreshMinutes: isCalendarRefresh(minutes) ? minutes : current.refreshMinutes,
                  }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('calendar.settings.strip')}
        visible={everything}
        rows={[
          {
            id: 'calendar.showNextInStrip',
            node: (
              <ToggleRow
                label={t('calendar.settings.showNextInStrip')}
                description={t('calendar.settings.showNextInStripBody')}
                isSelected={calendar.showNextInStrip}
                onChange={(showNextInStrip) => {
                  write((current) => ({ ...current, showNextInStrip }));
                }}
              />
            ),
          },
          {
            id: 'calendar.notices',
            node: (
              <ToggleRow
                label={t('calendar.settings.notices')}
                description={t('calendar.settings.noticesBody')}
                isSelected={calendar.notices}
                onChange={(notices) => {
                  write((current) => ({ ...current, notices }));
                }}
              />
            ),
          },
        ]}
      />
    </>
  );
}
