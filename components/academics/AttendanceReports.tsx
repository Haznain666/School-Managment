'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Card, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { MONTH_NAMES } from '@/db/schema/academic-years';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Monthly attendance, one row per student.
 *
 * The percentage bar is the point of the screen: a column of numbers does not
 * tell a head teacher who to worry about, and the three bands — 90 and above,
 * 75 and above, below 75 — are the thresholds Pakistani schools actually act
 * on, so the colour answers "who is at risk" without anyone reading a figure.
 *
 * Holidays are reported but excluded from the percentage: a school closure is
 * not an absence and must not drag a child's record down.
 */

export interface ReportYearOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ReportGradeOption {
  id: string;
  label: string;
}

export interface ReportSectionOption {
  id: string;
  gradeId: string;
  academicYearId: string;
  name: string;
}

export interface AttendanceReportsProps {
  academicYears: readonly ReportYearOption[];
  grades: readonly ReportGradeOption[];
  sections: readonly ReportSectionOption[];
}

interface ReportRow {
  studentProfileId: string;
  studentName: string;
  studentId: string;
  rollNumber: string | null;
  present: number;
  absent: number;
  late: number;
  excused: number;
  holiday: number;
  total: number;
  percentage: number;
}

interface ReportPayload {
  students: ReportRow[];
  classAverage: number;
}

const MONTH_OPTIONS = MONTH_NAMES.map((label, index) => ({
  value: String(index + 1),
  label,
}));

/** Above 90 is healthy, 75–90 needs watching, below 75 needs acting on. */
function barColor(percentage: number): string {
  if (percentage >= 90) return 'bg-emerald-500';
  if (percentage >= 75) return 'bg-amber-500';
  return 'bg-red-500';
}

function textColor(percentage: number): string {
  if (percentage >= 90) return 'text-status-success-ink';
  if (percentage >= 75) return 'text-status-warning-ink';
  return 'text-status-danger-ink';
}

export function AttendanceReports({
  academicYears,
  grades,
  sections,
}: AttendanceReportsProps) {
  const activeYear = academicYears.find((year) => year.isActive) ?? academicYears[0];
  const now = new Date();

  const [yearId, setYearId] = useState(activeYear?.id ?? '');
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [calendarYear, setCalendarYear] = useState(String(now.getFullYear()));
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const sectionOptions = useMemo(
    () =>
      sections
        .filter(
          (section) => section.academicYearId === yearId && section.gradeId === gradeId,
        )
        .map((section) => ({ value: section.id, label: section.name })),
    [sections, yearId, gradeId],
  );

  useEffect(() => {
    if (sectionId !== '' && !sectionOptions.some((option) => option.value === sectionId)) {
      setSectionId('');
      setPayload(null);
    }
  }, [sectionOptions, sectionId]);

  // A four-year window either side of today. Cheap enough to rebuild each
  // render, and it depends on nothing the user changes.
  const currentCalendarYear = now.getFullYear();
  const calendarYearOptions = [
    currentCalendarYear - 2,
    currentCalendarYear - 1,
    currentCalendarYear,
    currentCalendarYear + 1,
  ].map((value) => ({ value: String(value), label: String(value) }));

  const load = useCallback(async () => {
    if (yearId === '' || sectionId === '') {
      setPayload(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await schoolFetch<ReportPayload>(
        `/api/school/attendance/reports?sectionId=${sectionId}&academicYearId=${yearId}&month=${month}&year=${calendarYear}`,
      );
      setPayload(data);
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the attendance report.'));
      setPayload(null);
    } finally {
      setIsLoading(false);
    }
  }, [yearId, sectionId, month, calendarYear]);

  useEffect(() => {
    void load();
  }, [load]);

  const students = payload?.students ?? [];
  const monthLabel = MONTH_NAMES[Number(month) - 1] ?? '';

  return (
    <div className="space-y-4">
      <Card header={<CardTitle title="Choose a class and a month" />}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Select
            label="Academic year"
            options={academicYears.map((year) => ({ value: year.id, label: year.name }))}
            value={yearId}
            placeholder="Select a year"
            onChange={(event) => {
              setYearId(event.target.value);
              setSectionId('');
              setPayload(null);
            }}
          />
          <Select
            label="Grade"
            options={grades.map((grade) => ({ value: grade.id, label: grade.label }))}
            value={gradeId}
            placeholder="Select a grade"
            onChange={(event) => {
              setGradeId(event.target.value);
              setSectionId('');
              setPayload(null);
            }}
          />
          <Select
            label="Section"
            options={sectionOptions}
            value={sectionId}
            placeholder={gradeId === '' ? 'Choose a grade first' : 'Select a section'}
            disabled={sectionOptions.length === 0}
            onChange={(event) => {
              setSectionId(event.target.value);
            }}
          />
          <Select
            label="Month"
            options={MONTH_OPTIONS}
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
            }}
          />
          <Select
            label="Year"
            options={calendarYearOptions}
            value={calendarYear}
            onChange={(event) => {
              setCalendarYear(event.target.value);
            }}
          />
        </div>
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {sectionId === '' ? (
        <Card>
          <p className="text-sm text-ink-muted">
            Choose a class to see its month.
          </p>
        </Card>
      ) : isLoading ? (
        <Card>
          <p className="text-sm text-ink-muted">Loading the report…</p>
        </Card>
      ) : students.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            No students are actively enrolled in this section for this year.
          </p>
        </Card>
      ) : (
        <Card
          header={
            <CardTitle
              title={`${monthLabel} ${calendarYear}`}
              description={`${students.length} student${students.length === 1 ? '' : 's'}. Late counts as present; holidays are excluded from the percentage.`}
              action={
                <div className="text-right">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Class average
                  </p>
                  <p
                    className={`text-2xl font-bold ${textColor(payload?.classAverage ?? 0)}`}
                  >
                    {(payload?.classAverage ?? 0).toFixed(1)}%
                  </p>
                </div>
              }
            />
          }
          className="p-0"
        >
          <div className="overflow-x-auto">
            <Table caption="Attendance by student" className="rounded-none border-0">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Student</TableHeaderCell>
                  <TableHeaderCell align="numeric">P</TableHeaderCell>
                  <TableHeaderCell align="numeric">A</TableHeaderCell>
                  <TableHeaderCell align="numeric">L</TableHeaderCell>
                  <TableHeaderCell align="numeric">E</TableHeaderCell>
                  <TableHeaderCell align="numeric">H</TableHeaderCell>
                  <TableHeaderCell align="numeric">Days</TableHeaderCell>
                  <TableHeaderCell className="w-48">Attendance</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {students.map((row) => (
                  <TableRow key={row.studentProfileId}>
                    <TableCell>
                      <p className="font-medium text-ink">{row.studentName}</p>
                      <p className="text-xs text-ink-muted">
                        {row.rollNumber === null || row.rollNumber === ''
                          ? 'No roll number'
                          : `Roll ${row.rollNumber}`}{' '}
                        · <span className="font-mono">{row.studentId}</span>
                      </p>
                    </TableCell>
                    <TableCell align="numeric" muted>{row.present}</TableCell>
                    <TableCell align="numeric" muted>{row.absent}</TableCell>
                    <TableCell align="numeric" muted>{row.late}</TableCell>
                    <TableCell align="numeric" muted>{row.excused}</TableCell>
                    <TableCell align="numeric" muted>{row.holiday}</TableCell>
                    <TableCell align="numeric" muted>{row.total}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
                          role="img"
                          aria-label={`${row.percentage}% attendance`}
                        >
                          <div
                            className={`h-full rounded-full ${barColor(row.percentage)}`}
                            style={{ width: `${Math.min(row.percentage, 100)}%` }}
                          />
                        </div>
                        <span
                          className={`w-14 shrink-0 text-right text-xs font-semibold ${textColor(row.percentage)}`}
                        >
                          {row.percentage.toFixed(1)}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
