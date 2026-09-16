import {
  Card,
  Hairline,
  ListRow,
  SegmentedControl,
  type SegmentedControlItem,
  Slider,
  Text,
  Toggle,
} from '@muna/ui';
import { Fragment, type ReactNode } from 'react';

/** Whether a row survives the current search; `() => true` when nothing is typed. */
export type RowFilter = (rowId: string) => boolean;

export interface RowSpec {
  readonly id: string;
  readonly node: ReactNode;
}

interface SectionProps {
  /** Section header, 13/600 `--text-2` (docs/05-design-system.md, Settings). */
  title: string;
  /** Explanation under the header for anything a one-line row description cannot carry. */
  description?: string;
  rows: readonly RowSpec[];
  visible: RowFilter;
}

/** A settings section: header, optional explanation, then the surviving rows in one card. */
export function Section({ title, description, rows, visible }: SectionProps) {
  const shown = rows.filter((row) => visible(row.id));
  if (shown.length === 0) {
    return null;
  }
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex flex-col gap-1 px-3">
        <Text as="h2" variant="body" weight={600} tone="secondary">
          {title}
        </Text>
        {description !== undefined && (
          <Text as="p" variant="footnote" tone="secondary">
            {description}
          </Text>
        )}
      </div>
      <Card>
        {shown.map((row, index) => (
          <Fragment key={row.id}>
            {index > 0 && <Hairline />}
            {row.node}
          </Fragment>
        ))}
      </Card>
    </section>
  );
}

interface RowTextProps {
  label: string;
  description?: string;
}

interface ToggleRowProps extends RowTextProps {
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  isDisabled?: boolean;
}

export function ToggleRow({
  label,
  description,
  isSelected,
  onChange,
  isDisabled = false,
}: ToggleRowProps) {
  return (
    <ListRow
      label={label}
      description={description}
      trailingIsControl
      trailing={
        <Toggle
          aria-label={label}
          isSelected={isSelected}
          onChange={onChange}
          isDisabled={isDisabled}
        />
      }
    />
  );
}

interface SegmentedRowProps<Id extends string> extends RowTextProps {
  items: readonly SegmentedControlItem<Id>[];
  value: Id;
  onChange: (value: Id) => void;
}

export function SegmentedRow<Id extends string>({
  label,
  description,
  items,
  value,
  onChange,
}: SegmentedRowProps<Id>) {
  return (
    <ListRow
      label={label}
      description={description}
      trailingIsControl
      trailing={
        <SegmentedControl aria-label={label} items={items} value={value} onChange={onChange} />
      }
    />
  );
}

interface SliderRowProps extends RowTextProps {
  value: number;
  minValue: number;
  maxValue: number;
  step?: number;
  /** Visible value next to the track, e.g. "12 px". */
  format: (value: number) => string;
  /** Fires on every step of a drag; the editor coalesces these. */
  onChange: (value: number) => void;
  /** Fires once when the pointer or key is released; saves immediately. */
  onChangeEnd: (value: number) => void;
}

export function SliderRow({
  label,
  description,
  value,
  minValue,
  maxValue,
  step = 1,
  format,
  onChange,
  onChangeEnd,
}: SliderRowProps) {
  return (
    <ListRow
      label={label}
      description={description}
      trailingIsControl
      trailing={
        <span className="flex items-center gap-3">
          <Text as="span" variant="footnote" tone="secondary" tabular className="min-w-12 text-end">
            {format(value)}
          </Text>
          <Slider
            aria-label={label}
            className="settings-slider"
            value={value}
            minValue={minValue}
            maxValue={maxValue}
            step={step}
            onChange={onChange}
            onChangeEnd={onChangeEnd}
          />
        </span>
      }
    />
  );
}

interface ValueRowProps extends RowTextProps {
  value: ReactNode;
}

/** Read-only fact (version, data folder, the toggle shortcut). */
export function ValueRow({ label, description, value }: ValueRowProps) {
  return <ListRow label={label} description={description} trailing={value} />;
}

interface ActionRowProps extends RowTextProps {
  action: ReactNode;
}

/** A row whose trailing slot is a button or a small control group. */
export function ActionRow({ label, description, action }: ActionRowProps) {
  return <ListRow label={label} description={description} trailingIsControl trailing={action} />;
}

interface KeysProps {
  /** `tauri-plugin-global-shortcut` syntax, e.g. `ctrl+alt+space`. */
  shortcut: string;
}

const keyNames: Record<string, string> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  super: 'Win',
  meta: 'Win',
  cmd: 'Win',
  space: 'Space',
};

const keyName = (key: string): string =>
  keyNames[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key);

/** Renders a shortcut as keyboard caps. */
export function Keys({ shortcut }: KeysProps) {
  return (
    <span className="inline-flex items-center gap-1">
      {shortcut.split('+').map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className="rounded-control bg-surface-2 px-1.5 py-0.5 font-sans text-caption font-medium text-text-1"
        >
          {keyName(key)}
        </kbd>
      ))}
    </span>
  );
}
