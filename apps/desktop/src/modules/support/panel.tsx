import type { SupportCommand } from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import {
  Button,
  contentRecipe,
  EmptyState,
  IconButton,
  ListRow,
  Text,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import {
  ArrowLeft,
  FileArchive,
  LifeBuoy,
  MessageSquarePlus,
  Sparkles,
  Star,
  Wrench,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type ChangelogRelease, parseChangelog } from './changelog';
import { useSupportStore } from './support-store';
import {
  loadChangelog,
  openLink,
  type SupportFailure,
  useSupportCommand,
  useSupportSubscription,
} from './use-support';
import './support.css';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

const failureKey: Readonly<Record<SupportFailure, MessageKey>> = {
  noDesktop: 'support.error.noDesktop',
  io: 'support.error.io',
  zip: 'support.error.io',
  updater: 'support.error.updater',
  failed: 'support.error.failed',
};

type View = { kind: 'menu' } | { kind: 'repair' } | { kind: 'changelog'; releases: ChangelogRelease[] };

interface Note {
  tone: 'ok' | 'error';
  text: string;
}

/** The file name of a bundle path, whichever separator Rust used. */
export const bundleName = (path: string): string => path.split(/[\\/]/u).pop() ?? path;

interface HeadProps {
  title: string;
  onBack: () => void;
}

/** A sub-view's header: back, then its title. */
function Head({ title, onBack }: HeadProps) {
  const { t } = useTranslation();
  return (
    <header className="support-view__head">
      <IconButton aria-label={t('support.back')} onPress={onBack}>
        <ArrowLeft strokeWidth={ICON_STROKE} />
      </IconButton>
      <Text as="h2" variant="body" weight={600} truncate={1} className="support-view__title">
        {title}
      </Text>
    </header>
  );
}

interface ChangelogProps {
  releases: readonly ChangelogRelease[];
  onBack: () => void;
}

/**
 * *What's new* (docs/modules/support.md "Changelog viewer"): the bundled `CHANGELOG.md`, newest
 * release first, each change on one line without commit hashes; GitHub has the full notes.
 */
function Changelog({ releases, onBack }: ChangelogProps) {
  const { t } = useTranslation();
  return (
    <section className="support-view" aria-label={t('support.whatsNew.title')}>
      <Head title={t('support.whatsNew.title')} onBack={onBack} />
      {releases.length === 0 ? (
        <EmptyState
          className="support-empty"
          icon={<Sparkles size={24} strokeWidth={1.5} />}
          title={t('support.whatsNew.empty.title')}
          description={t('support.whatsNew.empty.body')}
          action={
            <Button
              variant="secondary"
              onPress={() => {
                void openLink('releaseNotes');
              }}
            >
              {t('support.whatsNew.onGitHub')}
            </Button>
          }
        />
      ) : (
        <div className="support-view__scroll">
          <ol className="support-releases">
            {releases.map((release) => (
              <li key={release.version} className="support-release">
                <div className="support-release__head">
                  <Text as="span" variant="footnote" weight={600} tabular>
                    {release.version}
                  </Text>
                  {release.date !== null && (
                    <Text as="span" variant="caption" tone="tertiary" tabular>
                      {release.date}
                    </Text>
                  )}
                </div>
                {release.groups.map((group) => (
                  <div key={group.title} className="support-release__group">
                    {group.title !== '' && (
                      <Text as="span" variant="caption" tone="secondary">
                        {group.title}
                      </Text>
                    )}
                    <ul className="support-release__notes">
                      {group.notes.map((note) => (
                        <li key={note} className="support-release__note">
                          <Text as="span" variant="footnote">
                            {note}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </li>
            ))}
          </ol>
          <Button
            variant="secondary"
            className="support-view__link"
            onPress={() => {
              void openLink('releaseNotes');
            }}
          >
            {t('support.whatsNew.onGitHub')}
          </Button>
        </div>
      )}
    </section>
  );
}

interface RepairProps {
  busy: SupportCommand['kind'] | null;
  onRepair: (kind: 'repairFlyouts' | 'repairAppBar') => void;
  onBack: () => void;
}

/**
 * The repairs (docs/modules/support.md): the volume and brightness flyouts, which Windows shows
 * again then hides as the HUD setting says, and the reserved space, which is registered again.
 */
function Repair({ busy, onRepair, onBack }: RepairProps) {
  const { t } = useTranslation();
  return (
    <section className="support-view" aria-label={t('support.repair.title')}>
      <Head title={t('support.repair.title')} onBack={onBack} />
      <ul className="support-list">
        <li>
          <ListRow
            label={t('support.repair.flyouts')}
            description={t('support.repair.flyoutsBody')}
            trailingIsControl
            trailing={
              <Button
                variant="secondary"
                isPending={busy === 'repairFlyouts'}
                onPress={() => {
                  onRepair('repairFlyouts');
                }}
              >
                {t('support.repair.action')}
              </Button>
            }
          />
        </li>
        <li>
          <ListRow
            label={t('support.repair.appBar')}
            description={t('support.repair.appBarBody')}
            trailingIsControl
            trailing={
              <Button
                variant="secondary"
                isPending={busy === 'repairAppBar'}
                onPress={() => {
                  onRepair('repairAppBar');
                }}
              >
                {t('support.repair.action')}
              </Button>
            }
          />
        </li>
      </ul>
    </section>
  );
}

/**
 * The support panel (docs/modules/support.md): help, feedback, a diagnostics bundle, what is new
 * in this build, the repairs and the GitHub link, as one list under a line naming the version
 * and the machine. Every outcome — the bundle's name, a finished repair, a refusal — is one line
 * under the list, never a dialog. Links open in the browser; the URLs are Rust's.
 */
export function SupportPanel() {
  const { t } = useTranslation();
  useSupportSubscription();
  const snapshot = useSupportStore((store) => store.snapshot);
  const send = useSupportCommand();
  const reduceMotion = useReduceMotion();
  const enterSpring = useMotionPreset('content');
  const [view, setView] = useState<View>({ kind: 'menu' });
  const [busy, setBusy] = useState<SupportCommand['kind'] | null>(null);
  const [note, setNote] = useState<Note | null>(null);

  if (snapshot === null) return null;

  const run = (command: SupportCommand, done: MessageKey) => {
    setBusy(command.kind);
    setNote(null);
    void send(command)
      .then((result) => {
        if (result.status === 'error') {
          setNote({ tone: 'error', text: t(failureKey[result.failure]) });
        } else if (result.outcome.kind === 'bundle') {
          setNote({
            tone: 'ok',
            text: t('support.diagnostics.saved', { name: bundleName(result.outcome.path) }),
          });
        } else {
          setNote({ tone: 'ok', text: t(done) });
        }
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const showChangelog = () => {
    if (!snapshot.changelog) {
      void openLink('releaseNotes');
      return;
    }
    void loadChangelog().then((markdown) => {
      setView({ kind: 'changelog', releases: markdown === null ? [] : parseChangelog(markdown) });
    });
  };

  const backToMenu = () => {
    setView({ kind: 'menu' });
  };

  let body;
  switch (view.kind) {
    case 'changelog':
      body = <Changelog releases={view.releases} onBack={backToMenu} />;
      break;
    case 'repair':
      body = (
        <Repair
          busy={busy}
          onBack={backToMenu}
          onRepair={(kind) => {
            run({ kind }, kind === 'repairFlyouts' ? 'support.repair.flyoutsDone' : 'support.repair.appBarDone');
          }}
        />
      );
      break;
    default:
      body = (
        <section className="support-view" aria-label={t('support.title')}>
          <Text as="p" variant="caption" tone="tertiary" truncate={1} className="support-view__about">
            {t('support.about', { version: snapshot.version, os: snapshot.system.os })}
          </Text>
          <ul className="support-list">
            <li>
              <ListRow
                icon={<LifeBuoy strokeWidth={1.5} />}
                label={t('support.help.title')}
                description={t('support.help.body')}
                onPress={() => {
                  void openLink('help');
                }}
              />
            </li>
            <li>
              <ListRow
                icon={<MessageSquarePlus strokeWidth={1.5} />}
                label={t('support.feedback.title')}
                description={t('support.feedback.body')}
                onPress={() => {
                  void openLink('feedback');
                }}
              />
            </li>
            <li>
              <ListRow
                icon={<FileArchive strokeWidth={1.5} />}
                label={t('support.diagnostics.title')}
                description={
                  busy === 'diagnostics'
                    ? t('support.diagnostics.saving')
                    : t('support.diagnostics.body')
                }
                isDisabled={busy === 'diagnostics'}
                onPress={() => {
                  run({ kind: 'diagnostics' }, 'support.done');
                }}
              />
            </li>
            <li>
              <ListRow
                icon={<Sparkles strokeWidth={1.5} />}
                label={t('support.whatsNew.title')}
                description={t('support.whatsNew.body', { version: snapshot.version })}
                onPress={showChangelog}
              />
            </li>
            <li>
              <ListRow
                icon={<Wrench strokeWidth={1.5} />}
                label={t('support.repair.title')}
                description={t('support.repair.body')}
                onPress={() => {
                  setView({ kind: 'repair' });
                }}
              />
            </li>
            <li>
              <ListRow
                icon={<Star strokeWidth={1.5} />}
                label={t('support.rate.title')}
                description={t('support.rate.body')}
                onPress={() => {
                  void openLink('rate');
                }}
              />
            </li>
          </ul>
        </section>
      );
  }

  return (
    <motion.div
      className="support-panel"
      initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge}
      animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
      transition={enterSpring}
    >
      {body}
      {note !== null && (
        <Text
          as="p"
          variant="caption"
          tone={note.tone === 'error' ? 'primary' : 'secondary'}
          role="status"
          className="support-note"
        >
          {note.text}
        </Text>
      )}
    </motion.div>
  );
}
