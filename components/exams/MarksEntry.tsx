'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import {
  RESIT_STATUS_LABELS,
  RESULT_STATUS_LABELS,
  type ResitStatus,
  type ResultStatus,
} from '@/db/schema/exam-subjects';
import { formatMark, formatPercentage, percentageOf } from '@/lib/grading';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * One paper, one section, one screen.
 *
 * ── Nothing is prefilled and nothing is inferred ─────────────────────────
 * A blank box means "not marked yet", not zero. Zero is a real score here — a
 * child who sat the paper and answered nothing — so the two cannot share a
 * representation, and the save skips blanks rather than storing them.
 * "Absent" is its own control for the same reason.
 *
 * ── Saving is a draft; publishing is somebody else's step ────────────────
 * The teacher can save as often as they like and submit when finished. They
 * cannot publish, and — the part that matters — they cannot *unpublish*. A
 * grade a parent has already seen does not change without the school knowing.
 *
 * ── Out-of-range marks are refused here and again on the server ──────────
 * The client is not a gate; it is a courtesy. Typing 105 out of 100 is a slip
 * of the hand and is worth catching before a save of forty rows fails.
 */

export interface MarksEntryStudent {
  studentProfileId: string;
  rollNumber: string | null;
  studentName: string;
  studentId: string;
  marksObtained: number | null;
  isAbsent: boolean;
  remarks: string | null;
  originalMarks: number | null;
  originalAbsent: boolean;
}

export interface MarksEntryPaper {
  id: string;
  subjectName: string;
  examTitle: string;
  sectionLabel: string;
  termName: string;
  maxMarks: number;
  passingMarks: number;
  resultsStatus: ResultStatus;
  resitStatus: ResitStatus;
}

export interface MarksEntryProps {
  paper: MarksEntryPaper;
  students: readonly MarksEntryStudent[];
  /** 1 or 2. The screen loads its own data when this changes. */
  initialAttempt: number;
  canEnter: boolean;
}

interface Draft {
  value: string;
  isAbsent: boolean;
}

function toDraft(student: MarksEntryStudent): Draft {
  return {
    value: student.marksObtained === null ? '' : String(student.marksObtained),
    isAbsent: student.isAbsent,
  };
}

export function MarksEntry({
  paper,
  students: initialStudents,
  initialAttempt,
  canEnter,
}: MarksEntryProps) {
  const [attempt, setAttempt] = useState(initialAttempt);
  const [students, setStudents] = useState<readonly MarksEntryStudent[]>(initialStudents);
  const [status, setStatus] = useState<{
    resultsStatus: ResultStatus;
    resitStatus: ResitStatus;
  }>({ resultsStatus: paper.resultsStatus, resitStatus: paper.resitStatus });
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      initialStudents.map((student) => [student.studentProfileId, toDraft(student)]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const attemptStatus: ResultStatus | ResitStatus =
    attempt === 2 ? status.resitStatus : status.resultsStatus;
  const isLocked = attemptStatus === 'published' || attemptStatus === 'none' || !canEnter;

  const load = useCallback(
    async (next: number): Promise<void> => {
      setIsLoading(true);
      setError(null);
      setSavedAt(null);

      try {
        const data = await schoolFetch<{
          students: MarksEntryStudent[];
          paper: { resultsStatus: ResultStatus; resitStatus: ResitStatus };
        }>(`/api/school/exam-subjects/${paper.id}/results?attempt=${next}`);

        setStudents(data.students);
        setStatus({
          resultsStatus: data.paper.resultsStatus,
          resitStatus: data.paper.resitStatus,
        });
        setDrafts(
          Object.fromEntries(
            data.students.map((student) => [student.studentProfileId, toDraft(student)]),
          ),
        );
      } catch (caught) {
        setError(schoolErrorMessage(caught, 'Could not load the marks sheet.'));
      } finally {
        setIsLoading(false);
      }
    },
    [paper.id],
  );

  // The first render already has the server's data, so only a change of
  // attempt goes back for more.
  const [loadedAttempt, setLoadedAttempt] = useState(initialAttempt);
  useEffect(() => {
    if (attempt === loadedAttempt) return;
    setLoadedAttempt(attempt);
    void load(attempt);
  }, [attempt, loadedAttempt, load]);

  const counts = useMemo(() => {
    let marked = 0;
    let absent = 0;
    let failed = 0;

    for (const student of students) {
      const draft = drafts[student.studentProfileId];
      if (draft === undefined) continue;

      if (draft.isAbsent) {
        absent += 1;
        continue;
      }

      const value = Number.parseFloat(draft.value);
      if (Number.isFinite(value)) {
        marked += 1;
        if (value < paper.passingMarks) failed += 1;
      }
    }

    return { marked, absent, failed, unmarked: students.length - marked - absent };
  }, [students, drafts, paper.passingMarks]);

  const outOfRange = useMemo(
    () =>
      students.some((student) => {
        const draft = drafts[student.studentProfileId];
        if (draft === undefined || draft.isAbsent || draft.value === '') return false;
        const value = Number.parseFloat(draft.value);
        return !Number.isFinite(value) || value < 0 || value > paper.maxMarks;
      }),
    [students, drafts, paper.maxMarks],
  );

  const save = async (): Promise<void> => {
    setIsSaving(true);
    setError(null);

    try {
      await schoolFetch(`/api/school/exam-subjects/${paper.id}/results`, {
        method: 'POST',
        body: JSON.stringify({
          attempt,
          records: students.map((student) => {
            const draft = drafts[student.studentProfileId] ?? { value: '', isAbsent: false };
            return {
              studentProfileId: student.studentProfileId,
              marksObtained: draft.isAbsent || draft.value === '' ? null : draft.value,
              isAbsent: draft.isAbsent,
            };
          }),
        }),
      });

      setSavedAt(new Date().toLocaleTimeString());
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The marks could not be saved.'));
    } finally {
      setIsSaving(false);
    }
  };

  const submit = async (): Promise<void> => {
    setIsSaving(true);
    setError(null);

    try {
      await save();
      const data = await schoolFetch<{
        paper: { resultsStatus: ResultStatus; resitStatus: ResitStatus };
      }>(`/api/school/exam-subjects/${paper.id}/results`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'submit', attempt }),
      });

      setStatus({
        resultsStatus: data.paper.resultsStatus,
        resitStatus: data.paper.resitStatus,
      });
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The marks could not be submitted.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card
        header={
          <CardTitle
            title={`${paper.subjectName} — ${paper.sectionLabel}`}
            description={`${paper.examTitle} · ${paper.termName} · out of ${paper.maxMarks}, pass ${paper.passingMarks}`}
            action={
              <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                <Badge
                  variant={attemptStatus === 'published' ? 'success' : 'neutral'}
                >
                  {attempt === 2
                    ? RESIT_STATUS_LABELS[status.resitStatus]
                    : RESULT_STATUS_LABELS[status.resultsStatus]}
                </Badge>

                {status.resitStatus === 'none' ? null : (
                  <div className="flex overflow-hidden rounded-lg border border-slate-300">
                    {[1, 2].map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={attempt === option}
                        onClick={() => {
                          setAttempt(option);
                        }}
                        className={
                          attempt === option
                            ? 'bg-brand-primary px-3 py-1.5 text-sm font-medium text-white'
                            : 'bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50'
                        }
                      >
                        {option === 1 ? 'Original' : 'Re-sit'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            }
          />
        }
      >
        <p className="text-sm text-slate-600">
          {counts.marked} marked · {counts.absent} absent · {counts.unmarked} still
          blank · {counts.failed} below the pass mark
        </p>

        {isLocked ? (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {attemptStatus === 'published'
              ? 'These marks are published and cannot be changed here. Somebody with permission to publish has to unpublish them first — a grade a parent has already seen should not change quietly.'
              : attemptStatus === 'none'
                ? 'No re-sit has been opened for this paper.'
                : 'Your role can see these marks but not enter them.'}
          </p>
        ) : null}
      </Card>

      {error !== null ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Card className="p-0">
        {isLoading ? (
          <p className="px-5 py-4 text-sm text-slate-500">Loading the marks sheet…</p>
        ) : students.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-600">
            No students are actively enrolled in this section for this year.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-2 font-medium">Student</th>
                    {attempt === 2 ? (
                      <th className="px-3 py-2 font-medium">Original</th>
                    ) : null}
                    <th className="px-3 py-2 font-medium">Marks</th>
                    <th className="px-3 py-2 font-medium">%</th>
                    <th className="px-3 py-2 font-medium">Absent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map((student) => {
                    const draft = drafts[student.studentProfileId] ?? {
                      value: '',
                      isAbsent: false,
                    };
                    const value = Number.parseFloat(draft.value);
                    const valid = Number.isFinite(value);
                    const bad = valid && (value < 0 || value > paper.maxMarks);

                    return (
                      <tr key={student.studentProfileId}>
                        <td className="px-5 py-2">
                          <p className="font-medium text-slate-900">
                            {student.studentName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {student.rollNumber === null || student.rollNumber === ''
                              ? 'No roll number'
                              : `Roll ${student.rollNumber}`}{' '}
                            · <span className="font-mono">{student.studentId}</span>
                          </p>
                        </td>

                        {attempt === 2 ? (
                          <td className="px-3 py-2 text-slate-600">
                            {student.originalAbsent
                              ? 'Absent'
                              : formatMark(student.originalMarks)}
                          </td>
                        ) : null}

                        <td className="px-3 py-2">
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={paper.maxMarks}
                            step="0.5"
                            disabled={isLocked || draft.isAbsent}
                            value={draft.isAbsent ? '' : draft.value}
                            aria-label={`Marks for ${student.studentName}`}
                            aria-invalid={bad}
                            onChange={(event) => {
                              const next = event.target.value;
                              setDrafts((current) => ({
                                ...current,
                                [student.studentProfileId]: {
                                  value: next,
                                  isAbsent: false,
                                },
                              }));
                              setSavedAt(null);
                            }}
                            className={
                              bad
                                ? 'w-24 rounded-lg border border-red-400 px-2 py-1.5 text-sm outline-red-500'
                                : 'w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50'
                            }
                          />
                        </td>

                        <td className="px-3 py-2 text-slate-600">
                          {draft.isAbsent || !valid
                            ? '—'
                            : formatPercentage(percentageOf(value, paper.maxMarks))}
                        </td>

                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            disabled={isLocked}
                            checked={draft.isAbsent}
                            aria-label={`${student.studentName} was absent`}
                            onChange={(event) => {
                              const isAbsent = event.target.checked;
                              setDrafts((current) => ({
                                ...current,
                                [student.studentProfileId]: {
                                  value: isAbsent ? '' : (current[student.studentProfileId]?.value ?? ''),
                                  isAbsent,
                                },
                              }));
                              setSavedAt(null);
                            }}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {isLocked ? null : (
              <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
                <Button
                  variant="secondary"
                  isLoading={isSaving}
                  disabled={outOfRange}
                  onClick={() => {
                    void save();
                  }}
                >
                  Save draft
                </Button>

                <Button
                  isLoading={isSaving}
                  disabled={outOfRange}
                  onClick={() => {
                    void submit();
                  }}
                >
                  Save and submit
                </Button>

                {savedAt === null ? null : (
                  <Badge variant="success">✓ Saved at {savedAt}</Badge>
                )}

                <p className="text-xs text-slate-500">
                  {outOfRange
                    ? `Some marks are outside 0–${paper.maxMarks}.`
                    : counts.unmarked === 0
                      ? 'Every student has a mark.'
                      : `${counts.unmarked} still blank — blanks are left as they are, not saved as zero.`}
                </p>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
