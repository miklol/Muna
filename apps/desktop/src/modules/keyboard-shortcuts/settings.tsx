import {
  commands,
  type HotkeyBinding,
  type HotkeyState,
  type IpcError,
  isSnoozeMinutes,
  type KeyboardShortcutsSettings,
  normaliseChord,
  readKeyboardShortcutsSettings,
  type SnoozeMinutes,
  SHELL_ACTION_IDS,
  SNOOZE_MINUTES_CHOICES,
  writeKeyboardShortcutsSettings,
} from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import { IconButton, ListRow, type SegmentedControlItem } from '@muna/ui';
import { X } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { useTranslation } from 'react-i18next';

import { Keys } from '../../lib/keys';
import { type RowSpec, Section, SegmentedRow, ToggleRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { type ActionEntry, listActions } from '../../shell/actions';
import { modules as registeredModules } from '../registry';
import { recordChord } from './chord';
import './keyboard-shortcuts.css';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

/** Lucide icons at 16 px use stroke 1.75 (docs/05-design-system.md "Iconography"). */
const ICON_STROKE = 1.75;

/** Why the last recording was refused, shown beside the caps until the next attempt. */
type Refusal =
  | { readonly kind: 'inUse' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'needsModifier' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'taken'; readonly by: string };

/** The message key for a binding's OS state; `null` when there is nothing to say. */
export const stateKey = (state: HotkeyState | undefined): MessageKey | null => {
  switch (state) {
    case 'inUse':
      return 'shortcuts.state.inUse';
    case 'invalid':
      return 'shortcuts.state.invalid';
    case 'registered':
    case 'unbound':
    case undefined:
      return null;
  }
};

/** Maps a `set_hotkey` refusal to what the row says; `taken` names the action holding it. */
export const refusalFrom = (
  error: IpcError,
  chord: string,
  bindings: readonly HotkeyBinding[],
): Refusal => {
  switch (error.code) {
    case 'hotkey.inUse':
      return { kind: 'inUse' };
    case 'hotkey.taken': {
      const wanted = normaliseChord(chord);
      const holder = bindings.find(
        (binding) => binding.chord !== null && normaliseChord(binding.chord) === wanted,
      );
      return { kind: 'taken', by: holder?.action ?? '' };
    }
    default:
      return { kind: 'invalid' };
  }
};

interface RecorderProps {
  action: ActionEntry;
  binding: HotkeyBinding | undefined;
  /** Every current binding, for naming the holder of a taken chord. */
  bindings: readonly HotkeyBinding[];
  labelOf: (id: string) => string;
  onBindings: (bindings: HotkeyBinding[]) => void;
}

/**
 * The chord control of one row: shows the caps (or "Not set"), records on press — the next
 * `keydown` with a modifier becomes the binding, Esc cancels, Backspace clears — and asks Rust
 * to register before anything is saved, so a chord another app holds comes back as a refusal
 * and the old binding stays (acceptance: "binding not saved").
 */
function Recorder({ action, binding, bindings, labelOf, onBindings }: RecorderProps) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const chord = binding?.chord ?? null;
  const osState = stateKey(binding?.state);

  const apply = (promise: ReturnType<typeof commands.setHotkey>, chordTried: string | null) => {
    setBusy(true);
    promise
      .then((result) => {
        if (result.status === 'ok') {
          setRefusal(null);
          onBindings(result.data);
        } else if (chordTried !== null) {
          setRefusal(refusalFrom(result.error, chordTried, bindings));
        }
      })
      .catch(() => {
        // Not running inside Tauri: nothing to register against.
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!recording) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setRecording(false);
      return;
    }
    if (event.key === 'Backspace' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      setRecording(false);
      if (chord !== null) {
        apply(commands.clearHotkey(action.id), null);
      }
      return;
    }
    const recorded = recordChord(event);
    switch (recorded.kind) {
      case 'modifiersOnly':
        return;
      case 'needsModifier':
      case 'unsupported':
        setRefusal({ kind: recorded.kind });
        setRecording(false);
        return;
      case 'chord':
        setRecording(false);
        if (recorded.chord !== chord) {
          apply(commands.setHotkey(action.id, recorded.chord), recorded.chord);
        }
    }
  };

  const refusalText = (): string | null => {
    if (refusal === null) {
      return osState === null ? null : t(osState);
    }
    switch (refusal.kind) {
      case 'inUse':
        return t('shortcuts.state.inUse');
      case 'invalid':
        return t('shortcuts.state.invalid');
      case 'needsModifier':
        return t('shortcuts.state.needsModifier');
      case 'unsupported':
        return t('shortcuts.state.unsupported');
      case 'taken':
        return t('shortcuts.state.taken', { action: labelOf(refusal.by) });
    }
  };
  const status = refusalText();

  return (
    <span className="shortcuts-binding">
      {status !== null && (
        <span className="shortcuts-state" data-tone="error" role="status">
          {status}
        </span>
      )}
      <AriaButton
        className="shortcuts-recorder"
        aria-label={t('shortcuts.recorder.label', { action: labelOf(action.id) })}
        data-recording={recording || undefined}
        isDisabled={busy}
        onPress={() => {
          setRefusal(null);
          setRecording(true);
        }}
        onBlur={() => {
          setRecording(false);
        }}
        onKeyDown={onKeyDown}
      >
        {recording ? (
          t('shortcuts.recorder.prompt')
        ) : chord === null ? (
          <span className="shortcuts-recorder__unset">{t('shortcuts.recorder.unset')}</span>
        ) : (
          <Keys shortcut={chord} />
        )}
      </AriaButton>
      {chord !== null && !recording && (
        <IconButton
          aria-label={t('shortcuts.recorder.clear', { action: labelOf(action.id) })}
          isDisabled={busy}
          onPress={() => {
            setRefusal(null);
            apply(commands.clearHotkey(action.id), null);
          }}
        >
          <X strokeWidth={ICON_STROKE} />
        </IconButton>
      )}
    </span>
  );
}

const OPEN_MODULE_PREFIX = 'shell.openModule';

/**
 * Settings › Keyboard shortcuts: the shell's actions, "open module by number", each module's
 * actions, then the two preferences — *only while hovering* and the snooze length. Bindings go
 * through `set_hotkey` / `clear_hotkey` (Rust registers with the OS, then persists); the
 * preferences through the shared editor like any other setting.
 */
export function KeyboardShortcutsSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  const shortcuts = readKeyboardShortcutsSettings(settings);
  const [bindings, setBindings] = useState<readonly HotkeyBinding[]>([]);

  useEffect(() => {
    let cancelled = false;
    commands
      .getHotkeys()
      .then((current) => {
        if (!cancelled) {
          setBindings(current);
        }
      })
      .catch(() => {
        // Not running inside Tauri: every row shows as not set.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const write = (recipe: (current: KeyboardShortcutsSettings) => KeyboardShortcutsSettings) => {
    update((current) =>
      writeKeyboardShortcutsSettings(current, recipe(readKeyboardShortcutsSettings(current))),
    );
  };

  const actions = listActions(registeredModules);
  const labelOf = (id: string): string => {
    const entry = actions.find((action) => action.id === id);
    return entry === undefined ? id : t(entry.labelKey, entry.labelValues ?? {});
  };
  const row = (action: ActionEntry): RowSpec => ({
    id: `shortcuts.${action.id}`,
    node: (
      <ListRow
        label={t(action.labelKey, action.labelValues ?? {})}
        trailingIsControl
        trailing={
          <Recorder
            action={action}
            binding={bindings.find((binding) => binding.action === action.id)}
            bindings={bindings}
            labelOf={labelOf}
            onBindings={setBindings}
          />
        }
      />
    ),
  });

  const shellRows = actions.filter(
    (action) =>
      action.groupKey === 'shortcuts.group.shell' && !action.id.startsWith(OPEN_MODULE_PREFIX),
  );
  const openModuleRows = actions.filter((action) => action.id.startsWith(OPEN_MODULE_PREFIX));
  const moduleGroups = new Map<MessageKey, ActionEntry[]>();
  for (const action of actions) {
    if (action.groupKey === 'shortcuts.group.shell') continue;
    moduleGroups.set(action.groupKey, [...(moduleGroups.get(action.groupKey) ?? []), action]);
  }

  const snoozeItems: SegmentedControlItem<`${SnoozeMinutes}`>[] = SNOOZE_MINUTES_CHOICES.map(
    (minutes) => ({ id: `${minutes}`, label: t('shortcuts.snoozeMinutes', { minutes }) }),
  );

  return (
    <>
      <Section
        title={t('shortcuts.group.shell')}
        description={t('shortcuts.settings.shellBody')}
        visible={everything}
        rows={shellRows.map(row)}
      />
      <Section
        title={t('shortcuts.settings.openModule')}
        description={t('shortcuts.settings.openModuleBody')}
        visible={everything}
        rows={openModuleRows.map(row)}
      />
      {[...moduleGroups.entries()].map(([groupKey, groupActions]) => (
        <Section
          key={groupKey}
          title={t(groupKey)}
          visible={everything}
          rows={groupActions.map(row)}
        />
      ))}
      <Section
        title={t('shortcuts.settings.options')}
        visible={everything}
        rows={[
          {
            id: 'shortcuts.onlyWhileHovering',
            node: (
              <ToggleRow
                label={t('shortcuts.settings.onlyWhileHovering')}
                description={t('shortcuts.settings.onlyWhileHoveringBody')}
                isSelected={shortcuts.onlyWhileHovering}
                onChange={(onlyWhileHovering) => {
                  write((current) => ({ ...current, onlyWhileHovering }));
                }}
              />
            ),
          },
          {
            id: 'shortcuts.snoozeMinutes',
            node: (
              <SegmentedRow
                label={t('shortcuts.settings.snooze')}
                description={t('shortcuts.settings.snoozeBody', {
                  chord:
                    bindings.find((binding) => binding.action === SHELL_ACTION_IDS.snooze)?.chord ??
                    t('shortcuts.recorder.unset'),
                })}
                items={snoozeItems}
                value={`${shortcuts.snoozeMinutes}`}
                onChange={(value) => {
                  const snoozeMinutes = Number(value);
                  if (isSnoozeMinutes(snoozeMinutes)) {
                    write((current) => ({ ...current, snoozeMinutes }));
                  }
                }}
              />
            ),
          },
        ]}
      />
    </>
  );
}
