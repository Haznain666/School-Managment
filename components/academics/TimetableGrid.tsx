import { Card } from '@/components/ui/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { subjectShortLabel } from '@/db/schema/subjects';
import { formatTimeOfDay } from '@/db/schema/timetable-slots';
import { WEEKDAY_SHORT_NAMES } from '@/db/schema/timetable-entries';
import { readableForeground } from '@/lib/color-contrast';

/** Used when a subject has no colour of its own. */
const SUBJECT_FALLBACK = '#475569';

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
        <p className="text-sm text-ink-muted">{emptyMessage}</p>
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
        <Table caption="Weekly timetable" className="rounded-none border-0">
          <TableHead>
            <TableRow>
              <TableHeaderCell className="w-40">Period</TableHeaderCell>
              {WEEKDAY_SHORT_NAMES.map((day) => (
                <TableHeaderCell key={day}>
                  {day}
                </TableHeaderCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {slots.map((slot) => (
              <TableRow key={slot.id}>
                <TableCell rowHeader>
                  <span className="block font-medium text-ink">{slot.name}</span>
                  <span className="block text-xs font-normal text-ink-muted">
                    {formatTimeOfDay(slot.startTime)} – {formatTimeOfDay(slot.endTime)}
                  </span>
                </TableCell>

                {slot.isBreak ? (
                  <TableCell align="center" muted className="bg-surface-sunken text-center text-xs uppercase tracking-wide" colSpan={WEEKDAY_SHORT_NAMES.length}>
                    {slot.name}
                  </TableCell>
                ) : (
                  WEEKDAY_SHORT_NAMES.map((day, dayIndex) => {
                    const entry = byCell.get(`${slot.id}:${dayIndex}`);

                    return (
                      <TableCell key={`${slot.id}-${day}`}>
                        {entry === undefined ? (
                          <div className="h-[4.5rem] w-full rounded-lg border border-dashed border-line" />
                        ) : (
                          <div
                            className="flex h-[4.5rem] w-full flex-col justify-center gap-0.5 rounded-lg px-2 py-1.5"
                            /*
                             * The lettering is computed from the subject's own
                             * colour, not assumed white. Subject colours are
                             * picked by the school and can be anything: a pale
                             * yellow "Chemistry" rendered white-on-yellow was
                             * the same defect §5p records for the palette, one
                             * level down.
                             */
                            style={{
                              backgroundColor: entry.subjectColor ?? SUBJECT_FALLBACK,
                              color: readableForeground(entry.subjectColor ?? SUBJECT_FALLBACK),
                            }}
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
                      </TableCell>
                    );
                  })
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
