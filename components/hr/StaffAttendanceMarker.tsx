'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  STAFF_ATTENDANCE_STATUS_LABELS,
  STAFF_ATTENDANCE_STATUSES,
  type StaffAttendanceStatus,
} from '@/db/schema/staff-attendance';
import { formatDateOnly } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The staff register for one day.
 *
 * Everyone active is listed with `present` preselected, because marking a
 * register is an exercise in noting the exceptions — asking an administrator to
 * tap "present" forty times to record a normal day is how registers stop being
 * taken at all.
 *
 * Payroll reads absences and half days from here. `leave` is deliberately not
 * counted as loss of pay by the register: whether a day of leave docks anyone
 * is the leave request's business, and counting it in both places would dock
 * the same day twice.
 */

interface StaffRow {
  id: string;
  fullName: string;
  employeeCode: string;
  designation: string | null;
}

interface MarkRow {
  staffId: string;
  status: StaffAttendanceStatus;
}

/** Whether the chosen date was a day off, and whom it was a day off for. */
interface DayOff {
  holidayNames: string[];
  /** 1–5 when the date is a Saturday, 0 when it is not. */
  saturdayOrdinal: number;
  staffIds: string[];
}

const ORDINAL_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

export interface StaffAttendanceMarkerProps {
  canEdit: boolean;
}

const STATUS_STYLES: Record<StaffAttendanceStatus, string> = {
  present: 'bg-status-success text-status-success-on',
  absent: 'bg-status-danger text-status-danger-on',
  late: 'bg-status-warning text-status-warning-on',
  half_day: 'bg-status-info text-status-info-on',
  leave: 'bg-brand-accent text-brand-onAccent',
  holiday: 'bg-ink-muted text-surface',
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function StaffAttendanceMarker({ canEdit }: StaffAttendanceMarkerProps) {
  const [date, setDate] = useState(todayIso);
  const [roster, setRoster] = useState<StaffRow[] | null>(null);
  const [dayOff, setDayOff] = useState<DayOff | null>(null);
  const [marks, setMarks] = useState<Record<string, StaffAttendanceStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setNotice(null);

    try {
      const payload = await schoolFetch<{
        staff: StaffRow[];
        attendance: MarkRow[];
        dayOff: DayOff;
      }>(`/api/school/hr/attendance?date=${encodeURIComponent(date)}`);

      setRoster(payload.staff);
      setDayOff(payload.dayOff);

      /*
       * The default is `present` on a working day and `holiday` on a day off —
       * Sprint 27, item B6.
       *
       * Marking a register is an exercise in noting the exceptions, and on Eid
       * the exception is whoever *came in*. Defaulting forty rows to `present`
       * on a day the school was shut asks an administrator to tap "holiday"
       * forty times, which is how registers stop being taken.
       *
       * Per person, not per date: the day off is a Saturday half the staff are
       * rostered on, and the other half are not.
       */
      const off = new Set(payload.dayOff.staffIds);

      const next: Record<string, StaffAttendanceStatus> = {};
      for (const row of payload.staff) {
        next[row.id] = off.has(row.id) ? 'holiday' : 'present';
      }
      // Overlaid last, so a day already marked reads back as it was marked
      // rather than being reset to the default a moment before it is saved.
      for (const row of payload.attendance) next[row.staffId] = row.status;

      setMarks(next);
      setError(null);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the register.'));
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (roster === null || roster.length === 0) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const payload = await schoolFetch<{ marked: number }>(
        '/api/school/hr/attendance',
        {
          method: 'POST',
          body: JSON.stringify({
            date,
            marks: roster.map((row) => ({
              staffId: row.id,
              status: marks[row.id] ?? 'present',
            })),
          }),
        },
      );

      setNotice(`Register saved for ${payload.marked} staff.`);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the register.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink">
          {notice}
        </p>
      ) : null}

      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Date"
            type="date"
            max={todayIso()}
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
        </div>

        {/*
          What kind of day this is, said out loud — Sprint 27, item B6.

          Without it a person marking a past Eid sees forty rows defaulted to
          "holiday" and no reason why, which reads as a bug. The sentence names
          the holiday, or names the Saturday, and says the register is for
          whoever actually came in.
        */}
        {dayOff !== null && dayOff.staffIds.length > 0 ? (
          <p
            role="status"
            className="mt-4 rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle"
          >
            {dayOff.holidayNames.length > 0
              ? `${formatDateOnly(date)} — ${dayOff.holidayNames.join(' and ')}.`
              : `${formatDateOnly(date)} — the ${ORDINAL_WORDS[dayOff.saturdayOrdinal] ?? ''} Saturday of the month, a day off for ${dayOff.staffIds.length} of these staff.`}{' '}
            Everyone off is marked <strong>Holiday</strong>. Mark whoever came in
            as <strong>Present</strong>.
          </p>
        ) : null}
      </Card>

      {roster === null ? (
        <Card>
          <p className="text-sm text-ink-muted">Loading the register…</p>
        </Card>
      ) : roster.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No active staff to mark. Add staff before taking the register.
          </p>
        </Card>
      ) : (
        <Card
          header={
            <CardTitle
              title="Staff register"
              description="Change only the exceptions — on a day the school was shut, that is whoever came in."
              action={
                canEdit ? (
                  <Button
                    size="sm"
                    isLoading={busy}
                    onClick={() => {
                      void save();
                    }}
                  >
                    Save register
                  </Button>
                ) : undefined
              }
            />
          }
          className="p-0"
        >
          <ul className="divide-y divide-line">
            {roster.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div>
                  <p className="font-medium text-ink">{row.fullName}</p>
                  <p className="text-xs text-ink-muted">
                    {row.employeeCode}
                    {row.designation === null ? '' : ` · ${row.designation}`}
                  </p>
                </div>

                <div
                  role="group"
                  aria-label={`Attendance for ${row.fullName}`}
                  className="flex flex-wrap gap-1"
                >
                  {STAFF_ATTENDANCE_STATUSES.map((status) => {
                    const isChosen = (marks[row.id] ?? 'present') === status;

                    return (
                      <button
                        key={status}
                        type="button"
                        aria-pressed={isChosen}
                        disabled={!canEdit}
                        onClick={() => {
                          setMarks({ ...marks, [row.id]: status });
                        }}
                        className={cn(
                          'rounded-full px-3 py-1 text-xs font-medium transition',
                          'disabled:cursor-not-allowed disabled:opacity-60',
                          isChosen
                            ? STATUS_STYLES[status]
                            : 'bg-surface-sunken text-ink-muted hover:bg-line',
                        )}
                      >
                        {STAFF_ATTENDANCE_STATUS_LABELS[status]}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
