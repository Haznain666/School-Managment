'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Select } from '@/components/ui/Select';
import { SCHEDULE_NAME_MAX } from '@/db/schema/exam-schedules';
import type { ExamScheduleRow } from '@/lib/exam-queries';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * A term's datesheets: who sits which papers, on which days, out of what.
 *
 * ── Why the whole schedule is one save ───────────────────────────────────
 * The classes, the window and the subject rows are mutually dependent — a paper
 * dated outside the window is refused, and whether a paper needs a maximum
 * depends on which classes are on the sheet. Saving them a field at a time
 * would mean a schedule that is briefly invalid on the server between two of a
 * clerk's keystrokes, and half of the validation would have to be relaxed to
 * allow it. So the editor holds a draft and posts it whole.
 *
 * ── Generate is a separate, deliberate press ─────────────────────────────
 * Saving the datesheet changes what the school intends. Generating writes an
 * exam and a set of papers for every section of every class on it, which is the
 * thing teachers then enter marks against. Doing the second automatically would
 * mean a mistyped date silently rewriting forty papers; the endpoint is
 * idempotent precisely so pressing it again after the correction is safe.
 */

export interface ScheduleManagerProps {
  termId: string;
  termName: string;
  schedules: readonly ExamScheduleRow[];
  grades: readonly { id: string; label: string }[];
  subjects: readonly { id: string; name: string }[];
  /** Descriptor classes have no marks, so the two marks columns disappear. */
  mechanismByGrade: Readonly<Record<string, string>>;
  canWrite: boolean;
}

interface PaperDraft {
  subjectId: string;
  examDate: string;
  startTime: string;
  durationMinutes: string;
  maxMarks: string;
  passingMarks: string;
}

interface Draft {
  name: string;
  startDate: string;
  endDate: string;
  gradeIds: string[];
  papers: PaperDraft[];
}

const EMPTY_DRAFT: Draft = {
  name: '',
  startDate: '',
  endDate: '',
  gradeIds: [],
  papers: [],
};

function toDraft(schedule: ExamScheduleRow): Draft {
  return {
    name: schedule.name,
    startDate: schedule.startDate,
    endDate: schedule.endDate ?? '',
    gradeIds: [...schedule.gradeIds],
    papers: schedule.subjects.map((paper) => ({
      subjectId: paper.subjectId,
      examDate: paper.examDate,
      startTime: paper.startTime ?? '',
      durationMinutes: paper.durationMinutes === null ? '' : String(paper.durationMinutes),
      maxMarks: paper.maxMarks === null ? '' : String(paper.maxMarks),
      passingMarks: paper.passingMarks === null ? '' : String(paper.passingMarks),
    })),
  };
}

function toBody(draft: Draft): Record<string, unknown> {
  return {
    name: draft.name,
    startDate: draft.startDate,
    endDate: draft.endDate === '' ? null : draft.endDate,
    gradeIds: draft.gradeIds,
    subjects: draft.papers.map((paper, index) => ({
      subjectId: paper.subjectId,
      examDate: paper.examDate,
      startTime: paper.startTime === '' ? null : paper.startTime,
      durationMinutes: paper.durationMinutes === '' ? null : Number(paper.durationMinutes),
      maxMarks: paper.maxMarks === '' ? null : Number(paper.maxMarks),
      passingMarks: paper.passingMarks === '' ? null : Number(paper.passingMarks),
      orderIndex: index,
    })),
  };
}

export function ScheduleManager({
  termId,
  termName,
  schedules,
  grades,
  subjects,
  mechanismByGrade,
  canWrite,
}: ScheduleManagerProps) {
  const router = useRouter();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // The draft's own classes decide the columns, not the saved schedule's: a
  // clerk swapping the classes has to see the marks columns go before they
  // save, or the refusal that follows will read as arbitrary.
  const isDescriptorDraft =
    draft.gradeIds.length > 0 &&
    draft.gradeIds.every((gradeId) => mechanismByGrade[gradeId] === 'descriptors');

  const run = async (key: string, work: () => Promise<void>): Promise<void> => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await work();
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'That did not work.'));
    } finally {
      setBusy(null);
    }
  };

  const startCreate = (): void => {
    setIsCreating(true);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  };

  const startEdit = (schedule: ExamScheduleRow): void => {
    setIsCreating(false);
    setEditingId(schedule.id);
    setDraft(toDraft(schedule));
    setError(null);
  };

  const save = (): Promise<void> =>
    run('save', async () => {
      const body = JSON.stringify(toBody(draft));

      if (editingId === null) {
        await schoolFetch(`/api/school/exam-terms/${termId}/schedules`, {
          method: 'POST',
          body,
        });
      } else {
        await schoolFetch(`/api/school/exam-schedules/${editingId}`, {
          method: 'PATCH',
          body,
        });
      }

      setIsCreating(false);
      setEditingId(null);
    });

  const archive = (schedule: ExamScheduleRow): Promise<void> | void => {
    const confirmed = window.confirm(
      `Archive "${schedule.name}"? Its generated exams are archived with it. ` +
        'Nothing is deleted — marks already entered stay where they are.',
    );
    if (!confirmed) return;

    return run(`archive:${schedule.id}`, async () => {
      await schoolFetch(`/api/school/exam-schedules/${schedule.id}`, {
        method: 'DELETE',
      });
    });
  };

  const generate = (schedule: ExamScheduleRow): Promise<void> =>
    run(`generate:${schedule.id}`, async () => {
      const result = await schoolFetch<{
        sections: number;
        examsCreated: number;
        papersCreated: number;
        papersUpdated: number;
        papersArchived: number;
        archivedWithMarks: number;
      }>(`/api/school/exam-schedules/${schedule.id}/generate`, { method: 'POST' });

      const parts = [
        `${result.sections} section${result.sections === 1 ? '' : 's'}`,
        `${result.examsCreated} new exam${result.examsCreated === 1 ? '' : 's'}`,
        `${result.papersCreated} paper${result.papersCreated === 1 ? '' : 's'} created`,
        `${result.papersUpdated} updated`,
      ];
      if (result.papersArchived > 0) {
        parts.push(
          `${result.papersArchived} archived (${result.archivedWithMarks} of them carrying marks)`,
        );
      }

      setNotice(parts.join(', ') + '.');
    });

  const isEditing = isCreating || editingId !== null;

  return (
    <Card
      header={
        <CardTitle
          title="Datesheets"
          description={`Which classes sit which papers in ${termName}, and when.`}
          action={
            canWrite && !isEditing ? (
              <Button size="sm" onClick={startCreate}>
                New datesheet
              </Button>
            ) : undefined
          }
        />
      }
    >
      {error !== null ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink"
        >
          {error}
        </p>
      ) : null}

      {notice !== null ? (
        <p
          role="status"
          className="mb-4 rounded-lg bg-status-success-subtle px-3 py-2 text-sm text-status-success-ink"
        >
          {notice}
        </p>
      ) : null}

      {isEditing ? (
        <div className="mb-6 space-y-4 rounded-lg border border-line bg-surface-sunken p-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Input
              label="Datesheet name"
              value={draft.name}
              maxLength={SCHEDULE_NAME_MAX}
              placeholder="Junior schedule"
              onChange={(event) => {
                setDraft((current) => ({ ...current, name: event.target.value }));
              }}
            />
            <Input
              label="Starts"
              type="date"
              value={draft.startDate}
              onChange={(event) => {
                setDraft((current) => ({ ...current, startDate: event.target.value }));
              }}
            />
            <Input
              label="Ends (optional)"
              type="date"
              value={draft.endDate}
              hint="Leave blank for a one-day sitting."
              onChange={(event) => {
                setDraft((current) => ({ ...current, endDate: event.target.value }));
              }}
            />
          </div>

          <MultiSelect
            label="Classes sitting this datesheet"
            options={grades.map((grade) => ({ value: grade.id, label: grade.label }))}
            value={draft.gradeIds}
            emptyMessage="This school has no classes yet."
            hint="A class sits one datesheet per term. Classes judged differently need separate datesheets."
            onChange={(next) => {
              setDraft((current) => ({ ...current, gradeIds: next }));
            }}
          />

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-ink">Papers</h4>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setDraft((current) => ({
                    ...current,
                    papers: [
                      ...current.papers,
                      {
                        subjectId: '',
                        examDate: current.startDate,
                        startTime: '',
                        durationMinutes: '',
                        maxMarks: '',
                        passingMarks: '',
                      },
                    ],
                  }));
                }}
              >
                Add a paper
              </Button>
            </div>

            {isDescriptorDraft ? (
              <p className="text-xs text-ink-muted">
                These classes are judged on performance descriptors, so their
                papers carry no marks.
              </p>
            ) : null}

            {draft.papers.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No papers yet. A datesheet with no papers generates nothing.
              </p>
            ) : (
              <ul className="space-y-3">
                {draft.papers.map((paper, index) => (
                  <li
                    key={index}
                    className="grid gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 xl:grid-cols-6"
                  >
                    <Select
                      label="Subject"
                      options={subjects.map((subject) => ({
                        value: subject.id,
                        label: subject.name,
                      }))}
                      value={paper.subjectId}
                      placeholder="Choose a subject"
                      onChange={(event) => {
                        const value = event.target.value;
                        setDraft((current) => ({
                          ...current,
                          papers: current.papers.map((row, position) =>
                            position === index ? { ...row, subjectId: value } : row,
                          ),
                        }));
                      }}
                    />
                    <Input
                      label="Date"
                      type="date"
                      value={paper.examDate}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDraft((current) => ({
                          ...current,
                          papers: current.papers.map((row, position) =>
                            position === index ? { ...row, examDate: value } : row,
                          ),
                        }));
                      }}
                    />
                    <Input
                      label="Starts at"
                      value={paper.startTime}
                      placeholder="09:00"
                      onChange={(event) => {
                        const value = event.target.value;
                        setDraft((current) => ({
                          ...current,
                          papers: current.papers.map((row, position) =>
                            position === index ? { ...row, startTime: value } : row,
                          ),
                        }));
                      }}
                    />
                    <Input
                      label="Minutes"
                      type="number"
                      inputMode="numeric"
                      value={paper.durationMinutes}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDraft((current) => ({
                          ...current,
                          papers: current.papers.map((row, position) =>
                            position === index
                              ? { ...row, durationMinutes: value }
                              : row,
                          ),
                        }));
                      }}
                    />

                    {isDescriptorDraft ? null : (
                      <>
                        <Input
                          label="Out of"
                          type="number"
                          inputMode="decimal"
                          value={paper.maxMarks}
                          onChange={(event) => {
                            const value = event.target.value;
                            setDraft((current) => ({
                              ...current,
                              papers: current.papers.map((row, position) =>
                                position === index ? { ...row, maxMarks: value } : row,
                              ),
                            }));
                          }}
                        />
                        <Input
                          label="Pass mark"
                          type="number"
                          inputMode="decimal"
                          value={paper.passingMarks}
                          onChange={(event) => {
                            const value = event.target.value;
                            setDraft((current) => ({
                              ...current,
                              papers: current.papers.map((row, position) =>
                                position === index
                                  ? { ...row, passingMarks: value }
                                  : row,
                              ),
                            }));
                          }}
                        />
                      </>
                    )}

                    <div className="xl:col-span-6">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setDraft((current) => ({
                            ...current,
                            papers: current.papers.filter(
                              (_row, position) => position !== index,
                            ),
                          }));
                        }}
                      >
                        Remove this paper
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              isLoading={busy === 'save'}
              disabled={
                draft.name.trim() === '' ||
                draft.startDate === '' ||
                draft.gradeIds.length === 0
              }
              onClick={() => {
                void save();
              }}
            >
              {editingId === null ? 'Create datesheet' : 'Save datesheet'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setIsCreating(false);
                setEditingId(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {schedules.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No datesheets in this term yet. A datesheet is what the classes on it
          actually sit, and what their papers are generated from.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {schedules.map((schedule) => (
            <li key={schedule.id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{schedule.name}</p>
                  <p className="text-xs text-ink-muted">
                    {schedule.startDate}
                    {schedule.endDate === null ? '' : ` to ${schedule.endDate}`} ·{' '}
                    {schedule.subjects.length} paper
                    {schedule.subjects.length === 1 ? '' : 's'} ·{' '}
                    {schedule.generatedPaperCount} generated
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {schedule.gradeNames.map((name) => (
                      <Badge key={name} variant="neutral">
                        {name}
                      </Badge>
                    ))}
                  </p>
                </div>

                {canWrite ? (
                  <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        startEdit(schedule);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      isLoading={busy === `generate:${schedule.id}`}
                      disabled={schedule.subjects.length === 0}
                      onClick={() => {
                        void generate(schedule);
                      }}
                    >
                      Generate exams
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      isLoading={busy === `archive:${schedule.id}`}
                      onClick={() => {
                        void archive(schedule);
                      }}
                    >
                      Archive
                    </Button>
                  </div>
                ) : null}
              </div>

              {schedule.subjects.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm text-ink-muted">
                  {schedule.subjects.map((paper) => (
                    <li key={paper.id}>
                      {paper.subjectName} · {paper.examDate}
                      {paper.startTime === null ? '' : ` · ${paper.startTime}`}
                      {paper.durationMinutes === null
                        ? ''
                        : ` · ${paper.durationMinutes} min`}
                      {paper.maxMarks === null ? '' : ` · out of ${paper.maxMarks}`}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
