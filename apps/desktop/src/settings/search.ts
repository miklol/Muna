import type { MessageKey } from '@muna/i18n';

/** The built-in panes, in sidebar order. Module panes follow as `module:<id>`. */
export const paneIds = [
  'general',
  'layout',
  'position',
  'screens',
  'appearance',
  'modules',
  'about',
] as const;

export type BuiltInPaneId = (typeof paneIds)[number];
export type PaneId = BuiltInPaneId | `module:${string}`;

export const paneTitleKey: Record<BuiltInPaneId, MessageKey> = {
  general: 'settings.pane.general',
  layout: 'settings.pane.layout',
  position: 'settings.pane.position',
  screens: 'settings.pane.screens',
  appearance: 'settings.pane.appearance',
  modules: 'settings.pane.modules',
  about: 'settings.pane.about',
};

/** One searchable setting: where it lives, its visible label and the words people try. */
export interface SettingEntry {
  readonly pane: BuiltInPaneId;
  readonly id: string;
  readonly labelKey: MessageKey;
  readonly synonyms: readonly string[];
}

/**
 * The search index (docs/modules/settings.md, "Search filters panes and individual settings
 * by label and synonyms"). Ids are the row ids the panes render, so a match can show exactly
 * that row.
 */
export const settingsIndex: readonly SettingEntry[] = [
  {
    pane: 'general',
    id: 'general.launchAtLogin',
    labelKey: 'settings.general.launchAtLogin',
    synonyms: ['startup', 'start up', 'autostart', 'boot', 'sign in', 'run at start'],
  },
  {
    pane: 'general',
    id: 'general.hideFromCaptures',
    labelKey: 'settings.general.hideFromCaptures',
    synonyms: ['screenshot', 'recording', 'screen share', 'sharing', 'capture', 'privacy'],
  },
  {
    pane: 'general',
    id: 'general.toggleHotkey',
    labelKey: 'settings.general.toggleHotkey',
    synonyms: ['shortcut', 'hotkey', 'keyboard', 'toggle', 'expand', 'collapse'],
  },
  {
    pane: 'layout',
    id: 'layout.shape',
    labelKey: 'settings.layout.shape',
    synonyms: ['notch', 'island', 'capsule', 'pill', 'form'],
  },
  {
    pane: 'layout',
    id: 'layout.mode',
    labelKey: 'settings.layout.mode',
    synonyms: ['overlay', 'reserved', 'title bar', 'maximised', 'maximized', 'appbar', 'overlap'],
  },
  {
    pane: 'layout',
    id: 'layout.stripHeight',
    labelKey: 'settings.layout.stripHeight',
    synonyms: ['size', 'compact', 'comfortable', 'height', 'thickness'],
  },
  {
    pane: 'position',
    id: 'position.offsetX',
    labelKey: 'settings.position.offsetX',
    synonyms: ['horizontal', 'left', 'right', 'centre', 'center', 'move', 'nudge', 'position'],
  },
  {
    pane: 'position',
    id: 'position.offsetY',
    labelKey: 'settings.position.offsetY',
    synonyms: ['vertical', 'top', 'down', 'move', 'nudge', 'position', 'gap'],
  },
  {
    pane: 'position',
    id: 'position.reset',
    labelKey: 'settings.position.reset',
    synonyms: ['reset', 'centre', 'center', 'default', 'undo'],
  },
  {
    pane: 'screens',
    id: 'screens.monitors',
    labelKey: 'settings.pane.screens',
    synonyms: ['monitor', 'display', 'screen', 'primary', 'external', 'per screen', 'dpi'],
  },
  {
    pane: 'appearance',
    id: 'appearance.accent',
    labelKey: 'settings.appearance.accent',
    synonyms: ['colour', 'color', 'theme', 'tint', 'blue', 'purple', 'green', 'orange'],
  },
  {
    pane: 'appearance',
    id: 'appearance.reduceMotion',
    labelKey: 'settings.appearance.reduceMotion',
    synonyms: ['animation', 'animations', 'motion', 'spring', 'accessibility', 'effects'],
  },
  {
    pane: 'modules',
    id: 'modules.list',
    labelKey: 'settings.pane.modules',
    synonyms: ['module', 'enable', 'disable', 'order', 'arrange', 'bar', 'hide'],
  },
  {
    pane: 'about',
    id: 'about.version',
    labelKey: 'settings.about.versionLabel',
    synonyms: ['about', 'build', 'update', 'release'],
  },
  {
    pane: 'about',
    id: 'about.platform',
    labelKey: 'settings.about.platform',
    synonyms: ['windows', 'system', 'backend'],
  },
  {
    pane: 'about',
    id: 'about.profile',
    labelKey: 'settings.about.profile',
    synonyms: ['folder', 'data', 'appdata', 'path', 'where', 'files', 'database'],
  },
  {
    pane: 'about',
    id: 'about.logs',
    labelKey: 'settings.about.openLogs',
    synonyms: ['log', 'logs', 'diagnostics', 'debug', 'report', 'problem', 'folder'],
  },
  {
    pane: 'about',
    id: 'about.export',
    labelKey: 'settings.about.export',
    synonyms: ['backup', 'save', 'json', 'file', 'transfer'],
  },
  {
    pane: 'about',
    id: 'about.import',
    labelKey: 'settings.about.import',
    synonyms: ['restore', 'load', 'json', 'file', 'transfer'],
  },
  {
    pane: 'about',
    id: 'about.reset',
    labelKey: 'settings.about.reset',
    synonyms: ['defaults', 'default', 'clear', 'start over', 'factory'],
  },
];

export interface SearchMatches {
  /** Row ids to show; everything else in a matching pane is hidden. */
  readonly rows: ReadonlySet<string>;
  /** Panes with at least one match, in sidebar order. */
  readonly panes: readonly PaneId[];
}

export interface SearchablePane {
  readonly id: PaneId;
  readonly title: string;
}

const normalise = (text: string): string =>
  text
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

/**
 * Filters the index by a query: every whitespace-separated word must appear in the row's
 * label, one of its synonyms or its pane title (so "general" lists the whole pane). Returns
 * `null` for an empty query, meaning "show everything".
 */
export const searchSettings = (
  query: string,
  panes: readonly SearchablePane[],
  label: (entry: SettingEntry) => string,
): SearchMatches | null => {
  const words = normalise(query)
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) {
    return null;
  }
  const titles = new Map(panes.map((pane) => [pane.id, normalise(pane.title)] as const));
  const rows = new Set<string>();
  const matched = new Set<PaneId>();
  for (const entry of settingsIndex) {
    const haystack = [
      normalise(label(entry)),
      ...entry.synonyms.map(normalise),
      titles.get(entry.pane) ?? '',
    ];
    if (words.every((word) => haystack.some((text) => text.includes(word)))) {
      rows.add(entry.id);
      matched.add(entry.pane);
    }
  }
  for (const pane of panes) {
    if (!pane.id.startsWith('module:')) continue;
    const title = titles.get(pane.id) ?? '';
    if (words.every((word) => title.includes(word))) {
      matched.add(pane.id);
    }
  }
  return { rows, panes: panes.map((pane) => pane.id).filter((id) => matched.has(id)) };
};
