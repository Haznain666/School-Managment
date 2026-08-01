'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  ATTENDANCE_STATUS_LABELS,
  type AttendanceStatus,
} from '@/db/schema/attendance-records';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Taking the register.
 *
 * The whole class is marked and saved in one go, which is how a register is
 * actually taken — a teacher reads down the list once. Nothing is preselected:
 * a screen that opened with everyone marked present would be signed off without
 * being read, so the default is unmarked and "Mark all present" is an explicit
 * choice.
 *
 * Saving is idempotent. A day already marked is loaded back into the toggles
 * and saving again corrects the same rows, so a mistake is fixed by re-marking
 * rather than by anything the teacher has to undo.
 */

export interface AttendanceYearOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface AttendanceGradeOption {
  id: string;
  label: string;
}

export interface AttendanceSectionOption {
  id: string;
  gradeId: string;
  academicYearId: string;
  name: string;
}

export interface AttendanceMarkerProps {
  academicYears: readonly AttendanceYearOption[];
  grades: readonly AttendanceGradeOption[];
  sections: readonly AttendanceSectionOption[];
  /** Shown when the caller can only reach their own classes. */
  scopeNote?: string;
}

interface RegisterStudent {
  enrollmentId: string;
  studentProfileId: string;
  rollNumber: string | null;
  studentName: string;
  studentId: string;
  record: { status: AttendanceStatus; notes: string | null } | null;
}

interface RegisterPayload {
  students: RegisterStudent[];
  alreadyMarked: boolean;
}

/** The four a teacher chooses between. `holiday` is a school-wide closure. */
const TOGGLE_STATUSES: readonly AttendanceStatus[] = [
  'present',
  'absent',
  'late',
  'excused',
];

const STATUS_INITIALS: Record<AttendanceStatus, string> = {
  present: 'P',
  absent: 'A',
  late: 'L',
  excused: 'E',
  holiday: 'H',
};

const SELECTED_CLASSES: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-600 text-white',
  absent: 'bg-red-600 text-white',
  late: 'bg-amber-500 text-white',
  excused: 'bg-slate-600 text-white',
  holiday: 'bg-slate-400 text-white',
};

function today(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function AttendanceMarker({
  academicYears,
  grades,
  sections,
  scopeNote,
}: AttendanceMarkerProps) {
  const activeYear = academicYears.find((year) => year.isActive) ?? academicYears[0];

  const [yearId, setYearId] = useState(activeYear?.id ?? '');
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(today());
  const [payload, setPayload] = useState<RegisterPayload | null>(null);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

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

  const load = useCallback(async () => {
    if (yearId === '' || sectionId === '' || date === '') {
      setPayload(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    setSavedAt(null);

    try {
      const data = await schoolFetch<RegisterPayload>(
        `/api/school/attendance?sectionId=${sectionId}&academicYearId=${yearId}&date=${date}`,
      );

      setPayload(data);
      // A day already marked opens on what was recorded, so a correction is a
      // change to what is there rather than a blank slate.
      setMarks(
        Object.fromEntries(
          data.students
            .filter((student) => student.record !== null)
            .map((student) => [
              student.studentProfileId,
              student.record?.status ?? 'present',
            ]),
        ),
      );
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not load the register.'));
      setPayload(null);
    } finally {
      setIsLoading(false);
    }
  }, [yearId, sectionId, date]);

  useEffect(() => {
    void load();
  }, [load]);

  const students = useMemo(() => payload?.students ?? [], [payload]);

  const counts = useMemo(() => {
    const tally = { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 };

    for (const student of students) {
      const status = marks[student.studentProfileId];
      if (status === undefined) {
        tally.unmarked += 1;
      } else if (status !== 'holiday') {
        tally[status] += 1;
      }
    }

    return tally;
  }, [students, marks]);

  const markAllPresent = (): void => {
    setMarks(
      Object.fromEntries(
        students.map((student) => [student.studentProfileId, 'present' as const]),
      ),
    );
    setSavedAt(null);
  };

  const save = async (): Promise<void> => {
    const records = students
      .filter((student) => marks[student.studentProfileId] !== undefined)
      .map((student) => ({
        studentProfileId: student.studentProfileId,
        enrollmentId: student.enrollmentId,
        status: marks[student.studentProfileId],
      }));

    if (records.length === 0) {
      setError('Mark at least one student before saving.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await schoolFetch('/api/school/attendance', {
        method: 'POST',
        body: JSON.stringify({
          academicYearId: yearId,
          sectionId,
          date,
          records,
        }),
      });

      setSavedAt(new Date().toLocaleTimeString());
      await load();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'Could not save the register.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card header={<CardTitle title="Choose a class and a day" description={scopeNote} />}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Input
            label="Date"
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
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
        </div>
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {sectionId === '' ? (
        <Card>
          <p className="text-sm text-slate-600">
            Choose a class to take its register.
          </p>
        </Card>
      ) : isLoading ? (
        <Card>
          <p className="text-sm text-slate-500">Loading the register…</p>
        </Card>
      ) : students.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No students are actively enrolled in this section for this year.
          </p>
        </Card>
      ) : (
        <Card
          header={
            <CardTitle
              title={`${students.length} student${students.length === 1 ? '' : 's'}`}
              description={`${counts.present} present · ${counts.absent} absent · ${counts.late} late · ${counts.excused} excused · ${counts.unmarked} unmarked`}
              action={
                <div className="flex items-center gap-3">
                  {payload?.alreadyMarked === true ? (
                    <Badge variant="warning">Already marked</Badge>
                  ) : null}
                  {savedAt === null ? null : (
                    <Badge variant="success">✓ Saved at {savedAt}</Badge>
                  )}
                  <Button size="sm" variant="secondary" onClick={markAllPresent}>
                    Mark all present
                  </Button>
                </div>
              }
            />
          }
          className="p-0"
        >
          <ul className="divide-y divide-slate-100">
            {students.map((student) => {
              const status = marks[student.studentProfileId];

              return (
                <li
                  key={student.studentProfileId}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{student.studentName}</p>
                    <p className="text-xs text-slate-500">
                      {student.rollNumber === null || student.rollNumber === ''
                        ? 'No roll number'
                        : `Roll ${student.rollNumber}`}{' '}
                      · <span className="font-mono">{student.studentId}</span>
                    </p>
                  </div>

                  <div
                    role="group"
                    aria-label={`Attendance for ${student.studentName}`}
                    className="flex gap-1.5"
                  >
                    {TOGGLE_STATUSES.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={status === option}
                        title={ATTENDANCE_STATUS_LABELS[option]}
                        onClick={() => {
                          setMarks((current) => ({
                            ...current,
                            [student.studentProfileId]: option,
                          }));
                          setSavedAt(null);
                        }}
                        className={
                          status === option
                            ? `h-9 w-9 rounded-lg text-sm font-semibold ${SELECTED_CLASSES[option]}`
                            : 'h-9 w-9 rounded-lg border border-slate-300 text-sm font-semibold text-slate-500 transition hover:border-slate-400 hover:text-slate-700'
                        }
                      >
                        {STATUS_INITIALS[option]}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <Button
              isLoading={isSaving}
              onClick={() => {
                void save();
              }}
            >
              Save attendance
            </Button>
            <p className="text-xs text-slate-500">
              {counts.unmarked === 0
                ? 'Every student has been marked.'
                : `${counts.unmarked} student${counts.unmarked === 1 ? '' : 's'} still unmarked — they will be left as they are.`}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
