import type { Settings } from '@muna/contracts';
import { Card, EmptyState, Hairline, IconButton, ListRow, Text, Toggle } from '@muna/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import type { ModuleDefinition } from '../../modules/registry';
import { orderModules } from '../../shell/module-order';
import type { RowFilter } from '../rows';
import { useSettingsEditor } from '../settings-editor';

interface PaneProps {
  visible: RowFilter;
  modules: readonly ModuleDefinition[];
}

const ICON_SIZE = 20;
const ICON_STROKE = 1.5;

/** Moves `id` one step; the saved order becomes the full current order so the move sticks. */
export const moveModule = (
  ordered: readonly string[],
  id: string,
  delta: 1 | -1,
): readonly string[] => {
  const from = ordered.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ordered.length) {
    return ordered;
  }
  const next = [...ordered];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) {
    next.splice(to, 0, moved);
  }
  return next;
};

export const setModuleEnabled = (settings: Settings, id: string, enabled: boolean): Settings => {
  const disabled = settings.shell.disabledModules.filter((module) => module !== id);
  return {
    ...settings,
    shell: { ...settings.shell, disabledModules: enabled ? disabled : [...disabled, id] },
  };
};

/** Modules: registry-driven enable switches and keyboard-friendly reordering. */
export function ModulesPane({ visible, modules }: PaneProps) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();

  if (!visible('modules.list')) {
    return null;
  }
  if (modules.length === 0) {
    return (
      <EmptyState
        title={t('settings.modules.emptyTitle')}
        description={t('settings.modules.emptyBody')}
      />
    );
  }

  const ordered = orderModules(modules, settings.shell.moduleOrder);
  const ids = ordered.map((module) => module.id);
  const disabled = new Set(settings.shell.disabledModules);

  return (
    <section aria-label={t('settings.pane.modules')} className="flex flex-col gap-2">
      <Text as="p" variant="footnote" tone="secondary" className="px-3">
        {t('settings.modules.body')}
      </Text>
      <Card>
        {ordered.map((module, index) => {
          const Icon = module.icon;
          const name = t(module.titleKey);
          return (
            <Fragment key={module.id}>
              {index > 0 && <Hairline />}
              <ListRow
                icon={<Icon size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
                label={name}
                trailingIsControl
                trailing={
                  <>
                    <IconButton
                      aria-label={t('settings.modules.moveUp', { name })}
                      isDisabled={index === 0}
                      onPress={() => {
                        update((current) => ({
                          ...current,
                          shell: {
                            ...current.shell,
                            moduleOrder: [...moveModule(ids, module.id, -1)],
                          },
                        }));
                      }}
                    >
                      <ChevronUp />
                    </IconButton>
                    <IconButton
                      aria-label={t('settings.modules.moveDown', { name })}
                      isDisabled={index === ordered.length - 1}
                      onPress={() => {
                        update((current) => ({
                          ...current,
                          shell: {
                            ...current.shell,
                            moduleOrder: [...moveModule(ids, module.id, 1)],
                          },
                        }));
                      }}
                    >
                      <ChevronDown />
                    </IconButton>
                    <Toggle
                      aria-label={t('settings.modules.show', { name })}
                      isSelected={!disabled.has(module.id)}
                      onChange={(enabled) => {
                        update((current) => setModuleEnabled(current, module.id, enabled));
                      }}
                    />
                  </>
                }
              />
            </Fragment>
          );
        })}
      </Card>
    </section>
  );
}
