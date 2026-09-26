import { SearchField } from '@muna/ui/primitives';
import { useEffect, useMemo, useRef } from 'react';
import {
  Autocomplete,
  Collection,
  Header,
  Menu,
  MenuItem,
  MenuSection,
  useFilter,
} from 'react-aria-components';
import { useTranslation } from 'react-i18next';

import { Keys } from '../lib/keys';
import type { ActionEntry } from './actions';
import './palette.css';

export interface CommandPaletteProps {
  /** The actions the palette may run, in display order (`listActions`, runnable only). */
  actions: readonly ActionEntry[];
  /** Action id → chord, for the caps beside each row. */
  bindings: ReadonlyMap<string, string>;
  onRun: (id: string) => void;
}

interface Group {
  readonly key: string;
  readonly title: string;
  readonly items: readonly { id: string; label: string }[];
}

/**
 * The command palette (docs/modules/keyboard-shortcuts.md; default `Ctrl+Shift+Space`): a
 * search field that filters every runnable action, grouped by owner, with the bound chord as
 * caps. Arrows move the highlight from the field, Enter runs, Esc clears the field and, once
 * it is empty, reaches the shell and closes the panel. The field takes focus on mount, which
 * is what pins the panel and lets the window accept keys (docs/modules/notch-shell.md).
 */
export function CommandPalette({ actions, bindings, onRun }: CommandPaletteProps) {
  const { t } = useTranslation();
  const { contains } = useFilter({ sensitivity: 'base' });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.querySelector('input')?.focus();
  }, []);

  const groups = useMemo<readonly Group[]>(() => {
    const byGroup = new Map<string, Group>();
    for (const action of actions) {
      const label = t(action.labelKey, action.labelValues ?? {});
      const group = byGroup.get(action.groupKey) ?? {
        key: action.groupKey,
        title: t(action.groupKey),
        items: [],
      };
      byGroup.set(action.groupKey, { ...group, items: [...group.items, { id: action.id, label }] });
    }
    return [...byGroup.values()];
  }, [actions, t]);

  return (
    <div ref={rootRef} className="muna-palette" data-testid="command-palette">
      <Autocomplete filter={contains}>
        <SearchField
          aria-label={t('shortcuts.palette.search')}
          placeholder={t('shortcuts.palette.placeholder')}
          clearLabel={t('shortcuts.palette.clear')}
        />
        <Menu
          aria-label={t('shortcuts.palette.title')}
          className="muna-palette__list"
          items={groups}
          onAction={(key) => {
            onRun(String(key));
          }}
          renderEmptyState={() => (
            <span className="muna-palette__empty">{t('shortcuts.palette.empty')}</span>
          )}
        >
          {(group) => (
            <MenuSection id={group.key} className="muna-palette__section">
              <Header className="muna-palette__heading">{group.title}</Header>
              <Collection items={group.items}>
                {(item) => {
                  const chord = bindings.get(item.id);
                  return (
                    <MenuItem
                      id={item.id}
                      textValue={item.label}
                      aria-label={item.label}
                      className="muna-list-row muna-list-row--pressable muna-palette__item"
                    >
                      <span className="muna-list-row__text">
                        <span className="muna-list-row__label">{item.label}</span>
                      </span>
                      {chord !== undefined && (
                        <span className="muna-list-row__trailing" aria-hidden="true">
                          <Keys shortcut={chord} />
                        </span>
                      )}
                    </MenuItem>
                  );
                }}
              </Collection>
            </MenuSection>
          )}
        </Menu>
      </Autocomplete>
    </div>
  );
}
