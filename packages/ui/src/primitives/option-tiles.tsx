import { type CSSProperties, type ReactNode, useId } from 'react';
import { RadioButton, RadioField, RadioGroup } from 'react-aria-components';

import './option-tiles.css';
import { cx } from './shared';
import { Text } from './text';

export interface OptionTileItem<Id extends string = string> {
  readonly id: Id;
  /** The option's name, 13/600; also the radio's accessible name. */
  readonly title: ReactNode;
  /** One sentence under the title, 12 px `--text-2`; announced as the description. */
  readonly description?: ReactNode;
  /** Art across the top of the tile, built from tokens (a `NotchSurface`, a mini screen). */
  readonly illustration?: ReactNode;
  readonly isDisabled?: boolean;
}

export interface OptionTilesProps<Id extends string = string> {
  /** Required: the tiles have no visible caption of their own. */
  'aria-label': string;
  items: readonly OptionTileItem<Id>[];
  value: Id;
  onChange: (value: Id) => void;
  /** Tiles per row; defaults to one column per item. */
  columns?: number;
  isDisabled?: boolean;
  className?: string;
}

const isId = <Id extends string>(
  items: readonly OptionTileItem<Id>[],
  value: string,
): value is Id => items.some((item) => item.id === value);

/**
 * Option tiles (docs/05-design-system.md#components): a radio group whose options are cards,
 * for the few choices that deserve a picture — Notch or Island, Overlay or Reserved. Each tile
 * is `--surface-1` on radius `--radius-card` with an illustration slot, a title and one line
 * of description; the selected tile carries a 2 px accent ring and a filled check, so the
 * choice never rests on colour alone. Arrow keys move the selection like any radio group.
 */
export function OptionTiles<Id extends string>({
  items,
  value,
  onChange,
  columns = items.length,
  isDisabled = false,
  className,
  ...labelling
}: OptionTilesProps<Id>) {
  const baseId = useId();
  return (
    <RadioGroup
      aria-label={labelling['aria-label']}
      value={value}
      isDisabled={isDisabled}
      onChange={(next) => {
        if (isId(items, next) && next !== value) {
          onChange(next);
        }
      }}
      className={cx('muna-option-tiles', className)}
      style={{ '--muna-option-tiles-columns': String(Math.max(1, columns)) } as CSSProperties}
    >
      {items.map((item) => {
        const titleId = `${baseId}-${item.id}-title`;
        const descriptionId = `${baseId}-${item.id}-description`;
        return (
          <RadioField
            key={item.id}
            value={item.id}
            isDisabled={item.isDisabled === true}
            aria-labelledby={titleId}
            {...(item.description === undefined ? {} : { 'aria-describedby': descriptionId })}
            className="muna-option-tile"
          >
            <RadioButton className="muna-option-tile__button">
              <span aria-hidden="true" className="muna-option-tile__check">
                <svg viewBox="0 0 16 16" fill="none" className="muna-option-tile__check-glyph">
                  <path
                    d="M4 8.5 6.8 11 12 5.5"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              {item.illustration !== undefined && (
                <span aria-hidden="true" className="muna-option-tile__illustration">
                  {item.illustration}
                </span>
              )}
              <span className="muna-option-tile__text">
                <Text as="span" id={titleId} variant="body" weight={600}>
                  {item.title}
                </Text>
                {item.description !== undefined && (
                  <Text as="span" id={descriptionId} variant="footnote" tone="secondary">
                    {item.description}
                  </Text>
                )}
              </span>
            </RadioButton>
          </RadioField>
        );
      })}
    </RadioGroup>
  );
}
