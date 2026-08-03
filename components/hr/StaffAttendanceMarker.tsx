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

export interface StaffAttendanceMarkerProps {
  canEdit: boolean;
}

const STATUS_STYLES: Record<StaffAttendanceStatus, string> = {
  present: 'bg-emerald-600 text-white',
  absent: 'bg-red-600 text-white',
  late: 'bg-amber-500 text-white',
  half_day: 'bg-sky-600 text-white',
  leave: 'bg-violet-600 text-white',
  holiday: 'bg-slate-500 text-white',
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function StaffAttendanceMarker({ canEdit }: StaffAttendanceMarkerProps) {
  const [date, setDate] = useState(todayIso);
  const [roster, setRoster] = useState<StaffRow[] | null>(null);
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
      }>(`/api/school/hr/attendance?date=${encodeURIComponent(date)}`);

      setRoster(payload.staff);

      // Default everyone to present, then overlay whatever was already marked.
      const next: Record<string, StaffAttendanceStatus> = {};
      for (const row of payload.staff) next[row.id] = 'present';
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
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
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
      </Card>

      {roster === null ? (
        <Card>
          <p className="text-sm text-slate-500">Loading the register…</p>
        </Card>
      ) : roster.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No active staff to mark. Add staff before taking the register.
          </p>
        </Card>
      ) : (
        <Card
          header={
            <CardTitle
              title="Staff register"
              description="Everyone starts present — change only the exceptions."
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
          <ul className="divide-y divide-slate-100">
            {roster.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div>
                  <p className="font-medium text-slate-900">{row.fullName}</p>
                  <p className="text-xs text-slate-500">
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
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
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
