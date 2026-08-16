import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Card, CardTitle } from '@/components/ui/Card';
import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus } from '@/db/schema';
import { WEEKDAY_LABELS, type CalendarMonth } from '@/lib/attendance-calendar';

/**
 * A month of one child's attendance, as a grid.
 *
 * ── Colour is never the only signal ──────────────────────────────────────
 * Every marked cell carries a one-letter code as well as its tint — P, A, L, E,
 * H — and its full status in the `title` and in a visually-hidden span. A
 * calendar that says "absent" only in red is unreadable to a colour-blind
 * parent, and this is the screen most likely to be the one they check.
 *
 * ── An unmarked school day is blank, not "absent" ────────────────────────
 * Nothing recorded means nothing recorded. Schools miss registers, and drawing
 * a missing register as an absence would put a mark against a child who was in
 * class — the single worst thing this screen could get wrong. Weekends and
 * future dates are drawn quieter still, so a blank Saturday does not read as a
 * gap either.
 *
 * ── It navigates with links, so it works with no JavaScript ──────────────
 * The month is in the URL. That makes this a server component with no client
 * bundle at all, and it makes a month shareable — the same reasoning the report
 * filters follow.
 */

const STATUS_CODES: Record<AttendanceStatus, string> = {
  present: 'P',
  absent: 'A',
  late: 'L',
  excused: 'E',
  holiday: 'H',
};

const STATUS_CLASSES: Record<AttendanceStatus, string> = {
  present: 'bg-status-success-subtle text-status-success-onSubtle',
  absent: 'bg-status-danger-subtle text-status-danger-onSubtle',
  late: 'bg-status-warning-subtle text-status-warning-onSubtle',
  excused: 'bg-status-info-subtle text-status-info-onSubtle',
  holiday: 'bg-surface-sunken text-ink-muted',
};

export function AttendanceCalendar({
  calendar,
  basePath,
  childId,
  childName,
}: {
  calendar: CalendarMonth;
  basePath: string;
  childId: string | null;
  childName: string;
}) {
  const hrefFor = (month: string): string => {
    const params = new URLSearchParams({ month });
    if (childId !== null) params.set('child', childId);
    return `${basePath}?${params.toString()}`;
  };

  return (
    <Card
      header={
        <CardTitle
          title={calendar.label}
          description={`${childName}. A blank school day means the register was not taken, not that anybody was away.`}
          action={
            <div className="flex items-center gap-1">
              <Link
                href={hrefFor(calendar.previous)}
                aria-label="Previous month"
                className="rounded-lg p-2 text-ink-muted hover:bg-surface-sunken hover:text-ink"
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </Link>
              <Link
                href={hrefFor(calendar.next)}
                aria-label="Next month"
                className="rounded-lg p-2 text-ink-muted hover:bg-surface-sunken hover:text-ink"
              >
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          }
        />
      }
    >
      {/* A table, because it is one: seven columns of days with headers. The
          screen reader announcement a parent gets from a grid of divs is a run
          of unrelated numbers. */}
      <table className="w-full table-fixed border-separate border-spacing-1">
        <caption className="sr-only">
          {childName}&rsquo;s attendance for {calendar.label}
        </caption>
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((label) => (
              <th
                key={label}
                scope="col"
                className="pb-1 text-center text-xs font-medium uppercase tracking-wide text-ink-muted"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calendar.weeks.map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((day, dayIndex) => {
                if (day === null) {
                  return <td key={dayIndex} aria-hidden="true" className="h-11" />;
                }

                const quiet = day.isWeekend || day.isFuture;

                return (
                  <td key={day.date} className="h-11 align-top">
                    <div
                      title={
                        day.status === null
                          ? `${day.date} — nothing recorded`
                          : `${day.date} — ${ATTENDANCE_STATUS_LABELS[day.status]}`
                      }
                      className={[
                        'flex h-full flex-col items-center justify-center rounded-lg text-xs',
                        day.status !== null
                          ? STATUS_CLASSES[day.status]
                          : quiet
                            ? 'text-ink-faint'
                            : 'bg-surface-sunken text-ink-muted',
                      ].join(' ')}
                    >
                      <span className="font-medium">{day.dayOfMonth}</span>
                      {day.status === null ? null : (
                        <>
                          <span aria-hidden="true" className="font-bold">
                            {STATUS_CODES[day.status]}
                          </span>
                          <span className="sr-only">
                            {ATTENDANCE_STATUS_LABELS[day.status]}
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        {(Object.keys(STATUS_CODES) as AttendanceStatus[]).map((status) => (
          <li key={status} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 items-center justify-center rounded font-bold ${STATUS_CLASSES[status]}`}
            >
              {STATUS_CODES[status]}
            </span>
            {ATTENDANCE_STATUS_LABELS[status]}
          </li>
        ))}
      </ul>
    </Card>
  );
}
