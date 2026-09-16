import type { Settings } from '@muna/contracts';
import { EmptyState, ErrorState, SearchField, Text } from '@muna/ui';
import { useQuery } from '@tanstack/react-query';
import {
  Blocks,
  Info,
  type LucideProps,
  Monitor,
  MoveHorizontal,
  Palette,
  PanelTop,
  Settings2,
} from 'lucide-react';
import { type ComponentType, type ReactNode, Suspense, useMemo, useState } from 'react';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import { useTranslation } from 'react-i18next';

import { useSystemTheme } from '../lib/appearance';
import { settingsQueryOptions } from '../lib/settings';
import { type ModuleDefinition, modules as registeredModules } from '../modules/registry';
import { OnboardingFlow } from './onboarding/onboarding-flow';
import { AboutPane } from './panes/about';
import { AppearancePane } from './panes/appearance';
import { GeneralPane } from './panes/general';
import { LayoutPane, PositionPane } from './panes/layout';
import { ModulesPane } from './panes/modules';
import { ScreensPane } from './panes/screens';
import type { RowFilter } from './rows';
import {
  type BuiltInPaneId,
  type PaneId,
  paneIds,
  paneTitleKey,
  type SearchablePane,
  searchSettings,
} from './search';
import { SettingsEditorProvider, useSettingsEditor } from './settings-editor';
import './settings.css';

const paneIcon: Record<BuiltInPaneId, ComponentType<LucideProps>> = {
  general: Settings2,
  layout: PanelTop,
  position: MoveHorizontal,
  screens: Monitor,
  appearance: Palette,
  modules: Blocks,
  about: Info,
};

const NAV_ICON_SIZE = 16;
const NAV_ICON_STROKE = 1.5;

interface NavPane extends SearchablePane {
  readonly icon: ReactNode;
}

const builtInIcon = (id: BuiltInPaneId): ReactNode => {
  const Icon = paneIcon[id];
  return <Icon size={NAV_ICON_SIZE} strokeWidth={NAV_ICON_STROKE} />;
};

const moduleIcon = (module: ModuleDefinition): ReactNode => {
  const Icon = module.icon;
  return <Icon size={NAV_ICON_SIZE} strokeWidth={NAV_ICON_STROKE} />;
};

export interface SettingsAppProps {
  /** Registry override for tests and stories; the product passes the real registry. */
  modules?: readonly ModuleDefinition[];
}

interface PaneContentProps {
  pane: PaneId;
  visible: RowFilter;
  modules: readonly ModuleDefinition[];
  onShowTour: () => void;
}

const modulePaneId = (module: ModuleDefinition): PaneId => `module:${module.id}`;

function PaneContent({ pane, visible, modules, onShowTour }: PaneContentProps) {
  switch (pane) {
    case 'general':
      return <GeneralPane visible={visible} onShowTour={onShowTour} />;
    case 'layout':
      return <LayoutPane visible={visible} />;
    case 'position':
      return <PositionPane visible={visible} />;
    case 'screens':
      return <ScreensPane visible={visible} />;
    case 'appearance':
      return <AppearancePane visible={visible} />;
    case 'modules':
      return <ModulesPane visible={visible} modules={modules} />;
    case 'about':
      return <AboutPane visible={visible} />;
    default: {
      const module = modules.find((candidate) => modulePaneId(candidate) === pane);
      if (module?.settings === undefined) {
        return null;
      }
      return <ModuleSettings key={module.id} section={module.settings} />;
    }
  }
}

interface ModuleSettingsProps {
  section: ComponentType;
}

/** A module's own settings section; a `lazy` one loads its chunk on first visit. */
function ModuleSettings({ section: Section }: ModuleSettingsProps) {
  const { t } = useTranslation();
  return (
    <Suspense
      fallback={
        <Text as="p" variant="body" tone="tertiary">
          {t('settings.loading')}
        </Text>
      }
    >
      <Section />
    </Suspense>
  );
}

interface WindowProps {
  modules: readonly ModuleDefinition[];
  onShowTour: () => void;
}

function SettingsWindow({ modules, onShowTour }: WindowProps) {
  const { t } = useTranslation();
  const { saveError } = useSettingsEditor();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PaneId>('general');

  const panes = useMemo<readonly NavPane[]>(
    () => [
      ...paneIds.map((id) => ({ id, title: t(paneTitleKey[id]), icon: builtInIcon(id) })),
      ...modules
        .filter((module) => module.settings !== undefined)
        .map((module) => ({
          id: modulePaneId(module),
          title: t(module.titleKey),
          icon: moduleIcon(module),
        })),
    ],
    [modules, t],
  );

  const matches = useMemo(
    () => searchSettings(query, panes, (entry) => t(entry.labelKey)),
    [panes, query, t],
  );
  const visiblePanes =
    matches === null ? panes : panes.filter((pane) => matches.panes.includes(pane.id));
  const current: PaneId | null = visiblePanes.some((pane) => pane.id === selected)
    ? selected
    : (visiblePanes[0]?.id ?? null);
  const visible: RowFilter = matches === null ? () => true : (rowId) => matches.rows.has(rowId);
  const currentTitle = panes.find((pane) => pane.id === current)?.title ?? '';

  return (
    <Tabs
      orientation="vertical"
      {...(current === null ? {} : { selectedKey: current })}
      onSelectionChange={(key) => {
        const pane = panes.find((candidate) => candidate.id === key);
        if (pane !== undefined) {
          setSelected(pane.id);
        }
      }}
      className="grid h-full grid-cols-[220px_1fr]"
    >
      <aside className="flex min-h-0 flex-col gap-3 border-e border-hairline p-3">
        <header className="flex h-8 items-center gap-2 px-2">
          <span aria-hidden="true" className="size-4 rounded-full bg-accent" />
          <Text as="span" variant="body" weight={600}>
            {t('app.name')}
          </Text>
        </header>
        <SearchField
          aria-label={t('settings.search.label')}
          placeholder={t('settings.search.placeholder')}
          clearLabel={t('settings.search.clear')}
          value={query}
          onChange={setQuery}
        />
        <TabList aria-label={t('settings.nav')} className="flex flex-col gap-0.5">
          {visiblePanes.map((pane) => (
            <Tab key={pane.id} id={pane.id} className="settings-nav-row">
              <span aria-hidden="true" className="inline-flex">
                {pane.icon}
              </span>
              <Text as="span" variant="body" truncate={1}>
                {pane.title}
              </Text>
            </Tab>
          ))}
        </TabList>
      </aside>
      <main className="min-h-0 overflow-y-auto">
        {current === null ? (
          <div className="mx-auto max-w-160 p-8">
            <EmptyState
              title={t('settings.search.emptyTitle', { query })}
              description={t('settings.search.emptyBody')}
            />
          </div>
        ) : (
          <TabPanel id={current} className="mx-auto flex max-w-160 flex-col gap-6 p-8 outline-none">
            <Text as="h1" variant="title2">
              {currentTitle}
            </Text>
            {saveError !== null && (
              <Text as="p" role="alert" variant="footnote" className="px-3">
                {t('settings.saveError')}
              </Text>
            )}
            <PaneContent
              pane={current}
              visible={visible}
              modules={modules}
              onShowTour={onShowTour}
            />
          </TabPanel>
        )}
      </main>
    </Tabs>
  );
}

/**
 * The settings window (docs/modules/settings.md): sidebar with search and one pane per section,
 * every change applied live through `update_settings`. Loads the document once; afterwards the
 * cache is kept fresh by the editor and `SettingsChanged`. Until the welcome tour has been
 * finished or skipped (`general.onboarded`), and whenever General → Welcome tour asks for it,
 * the window shows the tour instead.
 */
export function SettingsApp({ modules = registeredModules }: SettingsAppProps) {
  const { t } = useTranslation();
  useSystemTheme();
  const settings = useQuery(settingsQueryOptions);
  const [tourRequested, setTourRequested] = useState(false);

  if (settings.isPending) {
    return (
      <main className="mx-auto flex h-full max-w-160 flex-col gap-6 p-8">
        <Text as="p" variant="body" tone="tertiary">
          {t('settings.loading')}
        </Text>
      </main>
    );
  }
  if (settings.isError) {
    return (
      <main className="mx-auto flex h-full max-w-160 flex-col gap-6 p-8">
        <ErrorState
          title={t('settings.error')}
          retryLabel={t('settings.retry')}
          onRetry={() => {
            void settings.refetch();
          }}
        />
      </main>
    );
  }
  const document: Settings = settings.data;
  const showTour = tourRequested || !document.general.onboarded;
  return (
    <SettingsEditorProvider settings={document}>
      {showTour ? (
        <OnboardingFlow
          onDone={() => {
            setTourRequested(false);
          }}
        />
      ) : (
        <SettingsWindow
          modules={modules}
          onShowTour={() => {
            setTourRequested(true);
          }}
        />
      )}
    </SettingsEditorProvider>
  );
}
