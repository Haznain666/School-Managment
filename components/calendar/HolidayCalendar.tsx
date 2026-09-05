'use client';

import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { HOLIDAY_TYPE_LABELS, type HolidayType } from '@/db/schema/holidays';
import { formatDateOnly } from '@/lib/dates';
import {
  addDays,
  expandHolidays,
  isWorkingDay,
  parseIsoDate,
  saturdayOrdinal,
  toIsoDate,
  type HolidayRange,
} from '@/lib/holiday-calendar';
import { cn } from '@/lib/utils';

/**
 * The school's calendar as a month grid, plus the list underneath it.
 *
 * ── One component, four portals ──────────────────────────────────────────
 * The admin screen, the teacher's, the parent's and the pupil's all draw the
 * same thing. Four copies would be four places for the Saturday rule to be
 * implemented, and the first divergence would be a teacher's calendar saying
 * she is off on a day the payroll says she was absent.
 *
 * Everything about *what is a working day* comes from `lib/holiday-calendar.ts`,
 * which the server also uses. The grid renders the answer; it does not compute
 * one.
 *
 * ── The tentative badge is not decoration ────────────────────────────────
 * Every Islamic date the seed writes is an arithmetical approximation of a
 * decision Pakistan makes by moon sighting. A calendar that showed those with
 * the same confidence as 14 August would have a parent booking travel around a
 * date the school is going to move. So they carry *"Tentative — confirm the
 * date"*, everywhere, until somebody with `calendar.manage` edits them.
 */

export interface CalendarHoliday extends HolidayRange {
  id: string;
  holidayType: HolidayType;
  isTentative: boolean;
  notes?: string | null;
}

export interface HolidayCalendarProps {
  holidays: readonly CalendarHoliday[];
  /** The month drawn first, as `YYYY-MM`. */
  initialMonth: string;
  /**
   * Which Saturdays the person reading this works.
   *
   * Empty for a parent or a pupil, which is correct rather than a fallback:
   * the roster is a staff rota and a family is looking at whether the school is
   * open. An empty set means every Saturday reads as a day off, which is what
   * it is for them.
   */
  saturdayOrdinals?: readonly number[];
  /** Rendered under the grid, for the admin screen's actions. */
  children?: React.ReactNode;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const TYPE_VARIANT: Record<HolidayType, 'success' | 'warning' | 'neutral'> = {
  public: 'success',
  religious: 'warning',
  school: 'neutral',
};

/** `2026-10` → the first and last dates of that month, as `YYYY-MM-DD`. */
function monthBounds(month: string): { first: string; last: string } {
  const [yearRaw, monthRaw] = month.split('-');
  const year = Number(yearRaw);
  const index = Number(monthRaw);

  return {
    first: `${month}-01`,
    last: toIsoDate(new Date(Date.UTC(year, index, 0))),
  };
}

/** `2026-10` shifted by n months, staying a valid `YYYY-MM`. */
function shiftMonth(month: string, by: number): string {
  const [yearRaw, monthRaw] = month.split('-');
  const shifted = new Date(Date.UTC(Number(yearRaw), Number(monthRaw) - 1 + by, 1));

  return `${String(shifted.getUTCFullYear())}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function HolidayCalendar({
  holidays,
  initialMonth,
  saturdayOrdinals = [],
  children,
}: HolidayCalendarProps) {
  const [month, setMonth] = useState(initialMonth);

  const { first, last } = monthBounds(month);

  const byDate = useMemo(
    () => expandHolidays(holidays, first, last),
    [holidays, first, last],
  );

  /*
   * The grid runs Monday to Sunday and starts on the Monday on or before the
   * 1st, so a month beginning on a Thursday shows the three days before it
   * greyed rather than an empty gap the eye reads as a missing week.
   */
  const leading = (parseIsoDate(first).getUTCDay() + 6) % 7;
  const gridStart = addDays(first, -leading);

  const cells: string[] = [];
  for (let index = 0; index < 42; index += 1) cells.push(addDays(gridStart, index));

  // Six rows is the most any month needs and the fewest that never clips one.
  // Trimming the trailing week when it is entirely outside the month keeps a
  // 28-day February from drawing a blank row.
  const visible = cells.filter((date, index) => index < 35 || date <= last);

  const inMonth = holidays
    .filter((holiday) => holiday.startsOn <= last && holiday.endsOn >= first)
    .sort((left, right) => left.startsOn.localeCompare(right.startsOn));

  const monthLabel = parseIsoDate(first).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className="space-y-4">
      <Card
        header={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle title={monthLabel} description="Sundays and holidays are shaded." />
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface-subtle"
                onClick={() => {
                  setMonth(shiftMonth(month, -1));
                }}
              >
                Previous
              </button>
              <button
                type="button"
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface-subtle"
                onClick={() => {
                  setMonth(shiftMonth(month, 1));
                }}
              >
                Next
              </button>
            </div>
          </div>
        }
      >
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-line">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="bg-surface-subtle px-2 py-1.5 text-center text-xs font-medium text-ink-muted"
            >
              {label}
            </div>
          ))}

          {visible.map((date) => {
            const outside = date < first || date > last;
            const onDate = byDate.get(date) ?? [];
            const working = isWorkingDay(date, byDate, saturdayOrdinals);
            const isDutySaturday =
              saturdayOrdinal(date) > 0 && saturdayOrdinals.includes(saturdayOrdinal(date));

            return (
              <div
                key={date}
                className={cn(
                  'min-h-[5rem] bg-surface px-2 py-1.5 text-xs',
                  outside && 'opacity-40',
                  !working && !outside && 'bg-surface-subtle',
                )}
              >
                <span
                  className={cn(
                    'font-medium',
                    working ? 'text-ink' : 'text-ink-muted',
                  )}
                >
                  {Number(date.slice(8, 10))}
                </span>

                {isDutySaturday ? (
                  <span className="mt-0.5 block text-[0.65rem] text-status-success-ink">
                    Saturday duty
                  </span>
                ) : null}

                {onDate.map((holiday) => (
                  <span
                    key={`${date}-${holiday.name}`}
                    className="mt-0.5 block truncate text-[0.7rem] text-ink"
                    title={holiday.name}
                  >
                    {holiday.name}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        header={
          <CardTitle
            title="Holidays this month"
            description="A holiday is one row however many days it runs."
          />
        }
      >
        {inMonth.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No holidays fall in {monthLabel}. Sundays are always off, and Saturdays
            follow the duty roster.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {inMonth.map((holiday) => (
              <li
                key={holiday.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">{holiday.name}</p>
                  <p className="text-xs text-ink-muted">
                    {holiday.startsOn === holiday.endsOn
                      ? formatDateOnly(holiday.startsOn)
                      : `${formatDateOnly(holiday.startsOn)} – ${formatDateOnly(holiday.endsOn)}`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={TYPE_VARIANT[holiday.holidayType]}>
                    {HOLIDAY_TYPE_LABELS[holiday.holidayType]}
                  </Badge>
                  {holiday.isTentative ? (
                    <Badge variant="warning">Tentative — confirm the date</Badge>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {children}
    </div>
  );
}
