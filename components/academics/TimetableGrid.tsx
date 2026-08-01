import { Card } from '@/components/ui/Card';
import { subjectShortLabel } from '@/db/schema/subjects';
import { formatTimeOfDay } from '@/db/schema/timetable-slots';
import { WEEKDAY_SHORT_NAMES } from '@/db/schema/timetable-entries';

/**
 * A read-only week.
 *
 * Shared by the teacher and student portals, which want the same grid with a
 * different second line — a teacher needs to know which class they are walking
 * into, a student needs to know who is teaching them. That difference is passed
 * in as `subLabel` rather than branched on here, so this component never has to
 * know whose timetable it is showing.
 */

export interface TimetableGridSlot {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
}

export interface TimetableGridEntry {
  slotId: string;
  dayOfWeek: number;
  subjectName: string;
  subjectCode: string | null;
  subjectColor: string | null;
  /** The second line in a cell: the class, or the teacher. */
  subLabel: string | null;
  room: string | null;
}

export interface TimetableGridProps {
  slots: readonly TimetableGridSlot[];
  entries: readonly TimetableGridEntry[];
  /** Shown in place of the grid when there is nothing scheduled. */
  emptyMessage: string;
}

export function TimetableGrid({ slots, entries, emptyMessage }: TimetableGridProps) {
  if (slots.length === 0 || entries.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-600">{emptyMessage}</p>
      </Card>
    );
  }

  const byCell = new Map<string, TimetableGridEntry>();
  for (const entry of entries) {
    byCell.set(`${entry.slotId}:${entry.dayOfWeek}`, entry);
  }

  return (
    <Card className="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="w-40 px-4 py-3 font-medium">Period</th>
              {WEEKDAY_SHORT_NAMES.map((day) => (
                <th key={day} scope="col" className="px-3 py-3 font-medium">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {slots.map((slot) => (
              <tr key={slot.id}>
                <th scope="row" className="px-4 py-2 text-left align-top">
                  <span className="block font-medium text-slate-900">{slot.name}</span>
                  <span className="block text-xs font-normal text-slate-500">
                    {formatTimeOfDay(slot.startTime)} – {formatTimeOfDay(slot.endTime)}
                  </span>
                </th>

                {slot.isBreak ? (
                  <td
                    colSpan={WEEKDAY_SHORT_NAMES.length}
                    className="bg-slate-50 px-3 py-3 text-center text-xs font-medium uppercase tracking-wide text-slate-500"
                  >
                    {slot.name}
                  </td>
                ) : (
                  WEEKDAY_SHORT_NAMES.map((day, dayIndex) => {
                    const entry = byCell.get(`${slot.id}:${dayIndex}`);

                    return (
                      <td key={`${slot.id}-${day}`} className="px-1.5 py-1.5 align-top">
                        {entry === undefined ? (
                          <div className="h-[4.5rem] w-full rounded-lg border border-dashed border-slate-200" />
                        ) : (
                          <div
                            className="flex h-[4.5rem] w-full flex-col justify-center gap-0.5 rounded-lg px-2 py-1.5 text-white"
                            style={{ backgroundColor: entry.subjectColor ?? '#475569' }}
                          >
                            <span className="truncate text-xs font-semibold">
                              {subjectShortLabel({
                                name: entry.subjectName,
                                code: entry.subjectCode,
                              })}
                            </span>
                            {entry.subLabel === null ? null : (
                              <span className="truncate text-[11px] opacity-90">
                                {entry.subLabel}
                              </span>
                            )}
                            {entry.room === null || entry.room === '' ? null : (
                              <span className="truncate text-[11px] opacity-75">
                                {entry.room}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
