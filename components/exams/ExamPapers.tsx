'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  RESIT_STATUS_LABELS,
  RESULT_STATUS_LABELS,
  type ResitStatus,
  type ResultStatus,
} from '@/db/schema/exam-subjects';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * The datesheet, and every control that moves one paper's marks along.
 *
 * The three gates of this module all surface here, and each says what it does
 * rather than being a bare toggle: announcing the datesheet, publishing one
 * paper's marks, and opening a re-sit are different acts with different
 * audiences. Report cards are published on the term, one screen up, because
 * that is the level they are issued at.
 */

export interface PaperRow {
  id: string;
  subjectId: string;
  subjectName: string;
  maxMarks: number;
  passingMarks: number;
  examDate: string | null;
  slot: string | null;
  resultsStatus: ResultStatus;
  resitStatus: ResitStatus;
  enteredCount: number;
}

export interface ExamPapersProps {
  examId: string;
  isPublished: boolean;
  papers: readonly PaperRow[];
  subjects: readonly { id: string; name: string }[];
  rosterSize: number;
  canWrite: boolean;
  canPublishExam: boolean;
  canPublishResults: boolean;
  canEnterMarks: boolean;
}

const STATUS_VARIANT: Record<ResultStatus, 'neutral' | 'warning' | 'success'> = {
  draft: 'neutral',
  submitted: 'warning',
  published: 'success',
};

export function ExamPapers({
  examId,
  isPublished,
  papers,
  subjects,
  rosterSize,
  canWrite,
  canPublishExam,
  canPublishResults,
  canEnterMarks,
}: ExamPapersProps) {
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [subjectId, setSubjectId] = useState('');
  const [maxMarks, setMaxMarks] = useState('100');
  const [passingMarks, setPassingMarks] = useState('33');
  const [paperDate, setPaperDate] = useState('');
  const [slot, setSlot] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const taken = new Set(papers.map((paper) => paper.subjectId));
  const available = subjects.filter((subject) => !taken.has(subject.id));

  const run = async (key: string, work: () => Promise<void>): Promise<void> => {
    setBusy(key);
    setError(null);
    try {
      await work();
      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'That did not work.'));
    } finally {
      setBusy(null);
    }
  };

  const addPaper = (): Promise<void> =>
    run('add', async () => {
      await schoolFetch(`/api/school/exams/${examId}/subjects`, {
        method: 'POST',
        body: JSON.stringify({
          subjectId,
          maxMarks,
          passingMarks,
          examDate: paperDate === '' ? null : paperDate,
          slot,
        }),
      });
      setSubjectId('');
      setSlot('');
      setPaperDate('');
      setIsOpen(false);
    });

  const removePaper = (paperId: string): Promise<void> =>
    run(`delete-${paperId}`, async () => {
      await schoolFetch(`/api/school/exam-subjects/${paperId}`, { method: 'DELETE' });
    });

  const transition = (
    paperId: string,
    action: string,
    attempt: number,
  ): Promise<void> =>
    run(`${action}-${attempt}-${paperId}`, async () => {
      await schoolFetch(`/api/school/exam-subjects/${paperId}/results`, {
        method: 'PATCH',
        body: JSON.stringify({ action, attempt }),
      });
    });

  const setDatesheetPublished = (next: boolean): Promise<void> =>
    run('datesheet', async () => {
      await schoolFetch(`/api/school/exams/${examId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPublished: next }),
      });
    });

  return (
    <Card
      header={
        <CardTitle
          title="Datesheet"
          description={`${papers.length} paper${papers.length === 1 ? '' : 's'} · ${rosterSize} student${rosterSize === 1 ? '' : 's'} on the roll`}
          action={
            <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
              {canPublishExam ? (
                <Button
                  size="sm"
                  variant={isPublished ? 'secondary' : 'primary'}
                  isLoading={busy === 'datesheet'}
                  onClick={() => {
                    void setDatesheetPublished(!isPublished);
                  }}
                >
                  {isPublished ? 'Withdraw datesheet' : 'Announce datesheet'}
                </Button>
              ) : null}

              {canWrite ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={available.length === 0}
                  onClick={() => {
                    setIsOpen((open) => !open);
                  }}
                >
                  {isOpen ? 'Cancel' : 'Add a paper'}
                </Button>
              ) : null}
            </div>
          }
        />
      }
    >
      {error !== null ? (
        <p role="alert" className="mb-4 rounded-lg bg-status-danger-subtle px-3 py-2 text-sm text-status-danger-ink">
          {error}
        </p>
      ) : null}

      {isOpen ? (
        <div className="mb-5 space-y-4 rounded-lg border border-line bg-surface-sunken p-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Select
              label="Subject"
              options={available.map((subject) => ({
                value: subject.id,
                label: subject.name,
              }))}
              value={subjectId}
              placeholder="Select a subject"
              onChange={(event) => {
                setSubjectId(event.target.value);
              }}
            />
            <Input
              label="Out of"
              type="number"
              min={1}
              value={maxMarks}
              onChange={(event) => {
                setMaxMarks(event.target.value);
              }}
            />
            <Input
              label="Pass mark"
              type="number"
              min={0}
              value={passingMarks}
              onChange={(event) => {
                setPassingMarks(event.target.value);
              }}
            />
            <Input
              label="Date"
              type="date"
              value={paperDate}
              hint="Blank uses the exam's own date."
              onChange={(event) => {
                setPaperDate(event.target.value);
              }}
            />
            <Input
              label="Sitting"
              value={slot}
              placeholder="Morning"
              onChange={(event) => {
                setSlot(event.target.value);
              }}
            />
          </div>

          <Button
            isLoading={busy === 'add'}
            onClick={() => {
              void addPaper();
            }}
          >
            Add paper
          </Button>
        </div>
      ) : null}

      {papers.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No papers yet. The datesheet cannot be announced until there is at
          least one — an admit card with nothing on it is worse than none.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {papers.map((paper) => (
            <li key={paper.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{paper.subjectName}</p>
                  <p className="text-xs text-ink-muted">
                    Out of {paper.maxMarks} · pass {paper.passingMarks}
                    {paper.examDate === null ? '' : ` · ${paper.examDate}`}
                    {paper.slot === null || paper.slot === '' ? '' : ` · ${paper.slot}`}
                    {' · '}
                    {paper.enteredCount} of {rosterSize} marked
                  </p>
                </div>

                <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                  <Badge variant={STATUS_VARIANT[paper.resultsStatus]}>
                    {RESULT_STATUS_LABELS[paper.resultsStatus]}
                  </Badge>

                  {paper.resitStatus === 'none' ? null : (
                    <Badge variant="warning">
                      {RESIT_STATUS_LABELS[paper.resitStatus]}
                    </Badge>
                  )}

                  {canEnterMarks ? (
                    <Link
                      href={`/dashboard/exams/${examId}/marks/${paper.id}`}
                      className="text-sm font-medium text-brand-primary hover:underline"
                    >
                      Marks
                    </Link>
                  ) : null}
                </div>
              </div>

              {canPublishResults || canWrite ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {canPublishResults && paper.resultsStatus !== 'published' ? (
                    <Button
                      size="sm"
                      isLoading={busy === `publish-1-${paper.id}`}
                      onClick={() => {
                        void transition(paper.id, 'publish', 1);
                      }}
                    >
                      Publish marks
                    </Button>
                  ) : null}

                  {canPublishResults && paper.resultsStatus === 'published' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      isLoading={busy === `unpublish-1-${paper.id}`}
                      onClick={() => {
                        void transition(paper.id, 'unpublish', 1);
                      }}
                    >
                      Unpublish
                    </Button>
                  ) : null}

                  {canPublishResults &&
                  paper.resultsStatus === 'published' &&
                  paper.resitStatus === 'none' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      isLoading={busy === `open-resit-2-${paper.id}`}
                      onClick={() => {
                        void transition(paper.id, 'open-resit', 2);
                      }}
                    >
                      Open a re-sit
                    </Button>
                  ) : null}

                  {canPublishResults && paper.resitStatus === 'submitted' ? (
                    <Button
                      size="sm"
                      isLoading={busy === `publish-2-${paper.id}`}
                      onClick={() => {
                        void transition(paper.id, 'publish', 2);
                      }}
                    >
                      Publish re-sit marks
                    </Button>
                  ) : null}

                  {canPublishResults && paper.resitStatus !== 'none' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      isLoading={busy === `close-resit-2-${paper.id}`}
                      onClick={() => {
                        void transition(paper.id, 'close-resit', 2);
                      }}
                    >
                      Close the re-sit
                    </Button>
                  ) : null}

                  {canWrite && paper.enteredCount === 0 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      isLoading={busy === `delete-${paper.id}`}
                      onClick={() => {
                        void removePaper(paper.id);
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
