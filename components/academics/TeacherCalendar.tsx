'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { subjectShortLabel } from '@/db/schema/subjects';
import { formatTimeOfDay } from '@/db/schema/timetable-slots';
import { readableForeground } from '@/lib/color-contrast';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * A teacher's day, week or month.
 *
 * ── What this answers that the weekly grid does not ──────────────────────
 * The weekly grid answers "what is the shape of this teacher's week". Three
 * questions a school actually asks are not in it:
 *
 *   * "Is Sumera free on Thursday afternoon?" — the day view, in clock order,
 *     with the gaps visible as gaps rather than as blank cells in a table.
 *   * "How heavily is she loaded this month?" — the month view, which counts
 *     periods per day and shows the shape of the term rather than of one week.
 *   * "Who is off next week?" — leave, drawn on the days it covers, because
 *     that is the question behind most of the others.
 *
 * ── The honest limit, stated on screen ───────────────────────────────────
 * There is no school-holiday table in this product yet, so a day the school is
 * shut still shows its periods. The month view says so in one line rather than
 * quietly implying that Eid is a teaching day. See `lib/teacher-calendar.ts`.
 */

interface Lesson {
  entryId: string;
  date: string;
  dayOfWeek: number;
  slotId: string;
  slotName: string;
  startTime: string;
  endTime: string;
  subjectName: string;
  subjectCode: string | null;
  subjectColor: string | null;
  sectionLabel: string;
  room: string | null;
}

interface Leave {
  id: string;
  startDate: string;
  endDate: string;
  leaveTypeName: string;
  status: string;
}

interface CalendarPayload {
  view: 'day' | 'week' | 'month';
  date: string;
  range: { from: string; to: string };
  academicYearName?: string;
  reason: string | null;
  calendar: {
    teacherId: string;
    teacherName: string;
    structureNames: string[];
    lessons: Lesson[];
    leave: Leave[];
  } | null;
}

export interface TeacherCalendarTeacher {
  id: string;
  name: string;
}

export interface TeacherCalendarProps {
  /** Empty for the teacher's own calendar, where there is nothing to pick. */
  teachers?: readonly TeacherCalendarTeacher[];
  /** Preselected, and fixed when `teachers` is empty. */
  teacherId: string;
  /** Shown instead of the selector when there is no choice to make. */
  fixedTeacherName?: string | undefined;
}

const SUBJECT_FALLBACK = '#475569';

const VIEW_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const WEEKDAY_HEADS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const MS_PER_DAY = 86_400_000;

/**
 * Dates are handled as `YYYY-MM-DD` through UTC midnight here, exactly as they
 * are on the server. A browser in Karachi and a server in Frankfurt must agree
 * on which day Friday's last period falls on, and only one of them can win if
 * either side uses a local `Date`.
 */
function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    ...options,
  });
}

function stepFor(view: CalendarPayload['view']): number {
  return view === 'day' ? 1 : view === 'week' ? 7 : 0;
}

export function TeacherCalendar({
  teachers = [],
  teacherId: initialTeacherId,
  fixedTeacherName,
}: TeacherCalendarProps) {
  const [teacherId, setTeacherId] = useState(initialTeacherId);
  const [view, setView] = useState<CalendarPayload['view']>('week');
  const [date, setDate] = useState(todayIso);
  const [payload, setPayload] = useState<CalendarPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    if (teacherId === '') {
      setPayload(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      setPayload(
        await schoolFetch<CalendarPayload>(
          `/api/school/teachers/${teacherId}/calendar?view=${view}&date=${date}`,
        ),
      );
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the calendar.'));
      setPayload(null);
    } finally {
      setIsLoading(false);
    }
  }, [teacherId, view, date]);

  useEffect(() => {
    void load();
  }, [load]);

  const lessonsByDate = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    for (const lesson of payload?.calendar?.lessons ?? []) {
      const list = map.get(lesson.date) ?? [];
      list.push(lesson);
      map.set(lesson.date, list);
    }
    return map;
  }, [payload]);

  const leaveByDate = useMemo(() => {
    const map = new Map<string, Leave>();
    for (const period of payload?.calendar?.leave ?? []) {
      for (
        let cursor = period.startDate;
        cursor <= period.endDate;
        cursor = addDays(cursor, 1)
      ) {
        map.set(cursor, period);
      }
    }
    return map;
  }, [payload]);

  const days = useMemo(() => {
    if (payload === null) return [];

    const out: string[] = [];
    for (
      let cursor = payload.range.from;
      cursor <= payload.range.to;
      cursor = addDays(cursor, 1)
    ) {
      out.push(cursor);
    }
    return out;
  }, [payload]);

  const step = (direction: number): void => {
    const size = stepFor(view);

    if (size === 0) {
      // A month steps by calendar month, not by 30 days — otherwise stepping
      // forward and back from the 31st lands somewhere else.
      const anchor = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
      anchor.setUTCMonth(anchor.getUTCMonth() + direction);
      setDate(anchor.toISOString().slice(0, 10));
      return;
    }

    setDate(addDays(date, size * direction));
  };

  const rangeLabel = useMemo(() => {
    if (payload === null) return '';

    if (view === 'day') {
      return formatDate(payload.date, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }
    if (view === 'week') {
      return `${formatDate(payload.range.from, { day: 'numeric', month: 'short' })} – ${formatDate(
        payload.range.to,
        { day: 'numeric', month: 'short', year: 'numeric' },
      )}`;
    }
    return formatDate(payload.date, { month: 'long', year: 'numeric' });
  }, [payload, view]);

  const teacherName =
    payload?.calendar?.teacherName ?? fixedTeacherName ?? 'this teacher';

  return (
    <div className="space-y-4">
      <Card header={<CardTitle title="Choose a view" />}>
        <div className="grid gap-4 sm:grid-cols-3">
          {teachers.length === 0 ? null : (
            <Select
              label="Teacher"
              options={teachers.map((teacher) => ({
                value: teacher.id,
                label: teacher.name,
              }))}
              value={teacherId}
              placeholder="Select a teacher"
              onChange={(event) => {
                setTeacherId(event.target.value);
              }}
            />
          )}

          <Select
            label="View"
            options={VIEW_OPTIONS}
            value={view}
            onChange={(event) => {
              setView(event.target.value as CalendarPayload['view']);
            }}
          />

          <div className="flex items-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              aria-label="Previous"
              onClick={() => {
                step(-1);
              }}
            >
              ←
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDate(todayIso());
              }}
            >
              Today
            </Button>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Next"
              onClick={() => {
                step(1);
              }}
            >
              →
            </Button>
          </div>
        </div>
      </Card>

      {error !== null ? (
        <p
          role="alert"
          className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {teacherId === '' ? (
        <Card>
          <p className="text-sm text-ink-muted">
            Choose a teacher to see their day, week or month.
          </p>
        </Card>
      ) : isLoading && payload === null ? (
        <Card>
          <p className="text-sm text-ink-muted">Loading the calendar…</p>
        </Card>
      ) : payload === null ? null : payload.calendar === null ? (
        <Card>
          <p className="text-sm text-ink-muted">{payload.reason}</p>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <h3 className="font-medium text-ink">
                {payload.calendar.teacherName}
              </h3>
              <p className="text-xs text-ink-muted">
                {rangeLabel}
                {payload.academicYearName === undefined
                  ? ''
                  : ` · ${payload.academicYearName}`}
              </p>
            </div>

            <p className="text-xs text-ink-muted">
              {payload.calendar.lessons.length} period
              {payload.calendar.lessons.length === 1 ? '' : 's'}
              {payload.calendar.structureNames.length > 1
                ? ` · across ${payload.calendar.structureNames.join(' and ')}`
                : ''}
            </p>
          </div>

          {view === 'month' ? (
            <MonthGrid
              days={days}
              anchorMonth={payload.date.slice(0, 7)}
              lessonsByDate={lessonsByDate}
              leaveByDate={leaveByDate}
              onPickDay={(picked) => {
                setDate(picked);
                setView('day');
              }}
            />
          ) : (
            <DayList
              days={view === 'day' ? [payload.date] : days}
              lessonsByDate={lessonsByDate}
              leaveByDate={leaveByDate}
              teacherName={teacherName}
            />
          )}

          <p className="border-t border-line px-4 py-2.5 text-xs text-ink-muted">
            Built from the timetable, so it shows every teaching day of the week.
            School holidays are not held anywhere in the system yet and are not
            subtracted here.
          </p>
        </Card>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------

function LeaveNote({ leave }: { leave: Leave }) {
  return (
    <Badge variant={leave.status === 'approved' ? 'warning' : 'neutral'}>
      {leave.leaveTypeName}
      {leave.status === 'approved' ? '' : ` (${leave.status})`}
    </Badge>
  );
}

function DayList({
  days,
  lessonsByDate,
  leaveByDate,
  teacherName,
}: {
  days: readonly string[];
  lessonsByDate: Map<string, Lesson[]>;
  leaveByDate: Map<string, Leave>;
  teacherName: string;
}) {
  const today = todayIso();

  return (
    <ul className="divide-y divide-line">
      {days.map((day) => {
        const lessons = lessonsByDate.get(day) ?? [];
        const leave = leaveByDate.get(day);

        return (
          <li key={day} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <h4
                className={
                  day === today
                    ? 'text-sm font-semibold text-brand-primary'
                    : 'text-sm font-semibold text-ink'
                }
              >
                {formatDate(day, { weekday: 'long', day: 'numeric', month: 'short' })}
              </h4>
              {day === today ? <Badge variant="info">Today</Badge> : null}
              {leave === undefined ? null : <LeaveNote leave={leave} />}
            </div>

            {lessons.length === 0 ? (
              <p className="mt-1 text-xs text-ink-muted">
                Nothing scheduled — {teacherName} is free all day.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {lessons.map((lesson) => (
                  <li
                    key={`${lesson.entryId}-${lesson.date}`}
                    className="flex flex-wrap items-center gap-3"
                  >
                    <span className="w-36 shrink-0 font-mono text-xs text-ink-muted">
                      {formatTimeOfDay(lesson.startTime)} –{' '}
                      {formatTimeOfDay(lesson.endTime)}
                    </span>

                    <span
                      className="rounded px-2 py-0.5 text-xs font-semibold"
                      style={{
                        backgroundColor: lesson.subjectColor ?? SUBJECT_FALLBACK,
                        // Computed, never assumed white — a school may colour a
                        // subject pale, and this is the same fix TimetableGrid
                        // carries.
                        color: readableForeground(
                          lesson.subjectColor ?? SUBJECT_FALLBACK,
                        ),
                      }}
                    >
                      {subjectShortLabel({
                        name: lesson.subjectName,
                        code: lesson.subjectCode,
                      })}
                    </span>

                    <span className="text-sm text-ink">{lesson.sectionLabel}</span>

                    <span className="text-xs text-ink-muted">
                      {lesson.slotName}
                      {lesson.room === null || lesson.room === ''
                        ? ''
                        : ` · ${lesson.room}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MonthGrid({
  days,
  anchorMonth,
  lessonsByDate,
  leaveByDate,
  onPickDay,
}: {
  days: readonly string[];
  anchorMonth: string;
  lessonsByDate: Map<string, Lesson[]>;
  leaveByDate: Map<string, Leave>;
  onPickDay: (date: string) => void;
}) {
  const today = todayIso();

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[44rem] p-4">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_HEADS.map((head) => (
            <div
              key={head}
              className="pb-1 text-center text-xs font-medium uppercase tracking-wide text-ink-muted"
            >
              {head}
            </div>
          ))}

          {days.map((day) => {
            const lessons = lessonsByDate.get(day) ?? [];
            const leave = leaveByDate.get(day);
            // The leading and trailing days of adjacent months are drawn but
            // muted, so the grid has no ragged first and last row.
            const inMonth = day.slice(0, 7) === anchorMonth;

            return (
              <button
                key={day}
                type="button"
                onClick={() => {
                  onPickDay(day);
                }}
                className={[
                  'flex h-24 flex-col items-start gap-1 rounded-lg border p-1.5 text-left transition',
                  day === today
                    ? 'border-brand-primary'
                    : 'border-line hover:border-line-strong',
                  inMonth ? 'bg-surface' : 'bg-surface-sunken',
                ].join(' ')}
              >
                <span
                  className={
                    inMonth
                      ? 'text-xs font-semibold text-ink'
                      : 'text-xs font-semibold text-ink-muted'
                  }
                >
                  {Number(day.slice(8, 10))}
                </span>

                {leave === undefined ? null : (
                  <span className="w-full truncate rounded bg-status-warning-subtle px-1 text-[10px] text-status-warning-onSubtle">
                    {leave.leaveTypeName}
                  </span>
                )}

                {lessons.length === 0 ? null : (
                  <>
                    <span className="text-[11px] text-ink-muted">
                      {lessons.length} period{lessons.length === 1 ? '' : 's'}
                    </span>

                    {/*
                      One stripe per lesson, in the subject's colour. A month
                      cell has no room for names, and the stripes still answer
                      the question a month view is opened for — how full is this
                      day, and is it the same shape as the one beside it.
                    */}
                    <span className="flex w-full flex-wrap gap-0.5">
                      {lessons.slice(0, 8).map((lesson) => (
                        <span
                          key={`${lesson.entryId}-${lesson.date}`}
                          title={`${lesson.subjectName} · ${lesson.sectionLabel}`}
                          className="h-1.5 w-4 rounded-full"
                          style={{
                            backgroundColor: lesson.subjectColor ?? SUBJECT_FALLBACK,
                          }}
                        />
                      ))}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
