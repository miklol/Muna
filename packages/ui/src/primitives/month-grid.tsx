import { type CalendarDate, getLocalTimeZone, parseDate, today } from '@internationalized/date';
import { useContext } from 'react';
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  CalendarStateContext,
  Heading,
} from 'react-aria-components';

import { IconButton } from './icon-button';
import './month-grid.css';
import { cx, type Tint, tintVar } from './shared';

/** How many dots a day shows at most; more events than that still show three. */
export const MONTH_GRID_MAX_MARKS = 3;

export interface MonthGridProps {
  /** Names the grid for assistive tech (the month is announced by the heading). */
  'aria-label': string;
  /** The selected day as `YYYY-MM-DD` in the local calendar. */
  value: string;
  onChange: (day: string) => void;
  /** The month on view, as any `YYYY-MM-DD` inside it; uncontrolled when omitted. */
  focusedValue?: string;
  onFocusChange?: (day: string) => void;
  /** Tinted dots under a day, by `YYYY-MM-DD`; at most three are drawn. */
  marks?: Readonly<Record<string, readonly Tint[]>>;
  previousLabel: string;
  nextLabel: string;
  /** Label of the button that returns to and selects today; omit it to hide the button. */
  todayLabel?: string;
  className?: string;
}

const glyph = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  focusable: false,
} as const;

interface TodayButtonProps {
  label: string;
}

/** Brings the view back to today and selects it, through the calendar's own state. */
function TodayButton({ label }: TodayButtonProps) {
  const state = useContext(CalendarStateContext);
  return (
    <AriaButton
      slot={null}
      className="muna-month-grid__today"
      onPress={() => {
        const now = today(getLocalTimeZone());
        state?.setFocusedDate(now);
        state?.selectDate(now);
      }}
    >
      {label}
    </AriaButton>
  );
}

const asDay = (date: CalendarDate): string => date.toString();

/**
 * Month grid (docs/05-design-system.md#components): a month of days with today as a filled
 * accent circle, the selected day on `--surface-3`, and up to three tinted dots under days
 * that have something on. Built on React Aria's `Calendar`: the arrow keys move between days,
 * Page Up and Down between months, and the week starts where the locale says. Always six
 * rows, so the surface never changes height between months.
 */
export function MonthGrid({
  value,
  onChange,
  focusedValue,
  onFocusChange,
  marks = {},
  previousLabel,
  nextLabel,
  todayLabel,
  className,
  ...labelling
}: MonthGridProps) {
  return (
    <Calendar
      aria-label={labelling['aria-label']}
      className={cx('muna-month-grid', className)}
      value={parseDate(value)}
      onChange={(date) => {
        onChange(asDay(date));
      }}
      {...(focusedValue === undefined ? {} : { focusedValue: parseDate(focusedValue) })}
      {...(onFocusChange === undefined
        ? {}
        : {
            onFocusChange: (date: CalendarDate) => {
              onFocusChange(asDay(date));
            },
          })}
      weeksInMonth={6}
    >
      {/* A div, not a header: inside the application role a header is a misplaced banner. */}
      <div className="muna-month-grid__header">
        <IconButton slot="previous" aria-label={previousLabel}>
          <svg {...glyph} aria-hidden="true">
            <path d="m10 3.5-4.5 4.5 4.5 4.5" />
          </svg>
        </IconButton>
        <Heading className="muna-month-grid__heading" />
        <IconButton slot="next" aria-label={nextLabel}>
          <svg {...glyph} aria-hidden="true">
            <path d="m6 3.5 4.5 4.5-4.5 4.5" />
          </svg>
        </IconButton>
        {todayLabel !== undefined && <TodayButton label={todayLabel} />}
      </div>
      <CalendarGrid className="muna-month-grid__grid" weekdayStyle="short">
        <CalendarGridHeader>
          {(day) => (
            <CalendarHeaderCell className="muna-month-grid__weekday">{day}</CalendarHeaderCell>
          )}
        </CalendarGridHeader>
        <CalendarGridBody>
          {(date) => {
            const dots = (marks[asDay(date)] ?? []).slice(0, MONTH_GRID_MAX_MARKS);
            return (
              <CalendarCell date={date} className="muna-month-grid__cell">
                {({ formattedDate }) => (
                  <>
                    <span className="muna-month-grid__number">{formattedDate}</span>
                    <span className="muna-month-grid__marks" aria-hidden="true">
                      {dots.map((tint, index) => (
                        <span
                          key={`${tint}-${String(index)}`}
                          className="muna-month-grid__mark"
                          style={{ background: tintVar(tint) }}
                        />
                      ))}
                    </span>
                  </>
                )}
              </CalendarCell>
            );
          }}
        </CalendarGridBody>
      </CalendarGrid>
    </Calendar>
  );
}
