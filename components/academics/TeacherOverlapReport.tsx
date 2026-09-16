import { Card, CardTitle } from '@/components/ui/Card';
import { formatTimeOfDay } from '@/db/schema/timetable-slots';
import { WEEKDAY_NAMES } from '@/db/schema/timetable-entries';
import type { TeacherOverlapRow } from '@/lib/academics-queries';

/**
 * Teachers who are already booked into two periods at once.
 *
 * ── Why this reports and never repairs ───────────────────────────────────
 * Sprint 33a closed the write that allowed it: two lessons in different
 * `period_structures` were compared on `slot_id` and never on the clock, so
 * Nursery period 2 (08:40–09:20) and Year 1 against period 3 (09:05–09:45)
 * were both legal rows. Closing the door says nothing about the rows already
 * through it — and one of those rows is **a lesson a class is sitting in**.
 *
 * Deleting either half automatically would take a real lesson off a real grid,
 * choosing between two classes on a rule no school agreed to, and leaving
 * nothing on any screen to say which one went. So this names both classes and
 * both clocks and stops there. The fix is one click in the grid above, made by
 * somebody who knows which of the two the teacher actually stands in.
 *
 * Silent when there is nothing to report. A panel that renders an empty state
 * on every timetable screen at every school teaches people to scroll past the
 * one week it is not empty.
 */

export interface TeacherOverlapReportProps {
  overlaps: readonly TeacherOverlapRow[];
  /** The year the report was read for, named so the reader knows its scope. */
  academicYearName: string;
}

export function TeacherOverlapReport({
  overlaps,
  academicYearName,
}: TeacherOverlapReportProps) {
  if (overlaps.length === 0) return null;

  const teachers = new Set(overlaps.map((row) => row.teacherId)).size;

  return (
    <Card
      header={
        <CardTitle
          title="Teachers booked twice at the same time"
          description={`${String(overlaps.length)} clash${
            overlaps.length === 1 ? '' : 'es'
          } across ${String(teachers)} teacher${teachers === 1 ? '' : 's'} in ${academicYearName}. Nothing has been changed — a lesson removed automatically is a class left with nobody in front of it.`}
        />
      }
    >
      <ul className="space-y-3">
        {overlaps.map((row) => (
          <li
            key={`${row.first.entryId}:${row.second.entryId}`}
            className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle"
          >
            <p className="font-medium">
              {row.teacherName} · {WEEKDAY_NAMES[row.dayOfWeek] ?? 'That day'}
            </p>
            <p>
              {row.first.sectionLabel}, {row.first.slotName} (
              {formatTimeOfDay(row.first.startTime)} –{' '}
              {formatTimeOfDay(row.first.endTime)})
            </p>
            <p>
              {row.second.sectionLabel}, {row.second.slotName} (
              {formatTimeOfDay(row.second.startTime)} –{' '}
              {formatTimeOfDay(row.second.endTime)})
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
