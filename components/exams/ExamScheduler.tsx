'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { schoolErrorMessage, schoolFetch } from '@/lib/school-client';

/**
 * Scheduling an exam, and the list of what is scheduled.
 *
 * The section picker is filtered by the chosen term's academic year, because
 * the API refuses the mismatch anyway — offering a section that will be
 * rejected on submit is how a form teaches someone to distrust it.
 */

export interface SchedulerTerm {
  id: string;
  name: string;
  academicYearId: string;
  academicYearName: string;
}

export interface SchedulerSection {
  id: string;
  gradeId: string;
  academicYearId: string;
  label: string;
}

export interface SchedulerExam {
  id: string;
  title: string;
  termName: string;
  gradeName: string;
  sectionName: string;
  examDate: string;
  isPublished: boolean;
  paperCount: number;
}

export interface ExamSchedulerProps {
  terms: readonly SchedulerTerm[];
  sections: readonly SchedulerSection[];
  exams: readonly SchedulerExam[];
  canWrite: boolean;
}

export function ExamScheduler({
  terms,
  sections,
  exams,
  canWrite,
}: ExamSchedulerProps) {
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [termId, setTermId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [title, setTitle] = useState('');
  const [examDate, setExamDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const sectionOptions = useMemo(() => {
    const term = terms.find((candidate) => candidate.id === termId);
    if (term === undefined) return [];

    return sections
      .filter((section) => section.academicYearId === term.academicYearId)
      .map((section) => ({ value: section.id, label: section.label }));
  }, [terms, sections, termId]);

  const create = async (): Promise<void> => {
    setIsSaving(true);
    setError(null);

    try {
      const data = await schoolFetch<{ examId: string | null }>('/api/school/exams', {
        method: 'POST',
        body: JSON.stringify({ termId, sectionId, title, examDate }),
      });

      if (data.examId !== null) {
        // Straight to the datesheet: an exam with no papers is not usable yet,
        // and the next thing anyone does is add them.
        router.push(`/dashboard/exams/${data.examId}`);
        return;
      }

      router.refresh();
    } catch (caught) {
      setError(schoolErrorMessage(caught, 'The exam could not be scheduled.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card
      header={
        <CardTitle
          title="Exams"
          description="One exam is one section's papers for one term."
          action={
            canWrite ? (
              <Button
                size="sm"
                variant={isOpen ? 'secondary' : 'primary'}
                disabled={terms.length === 0}
                onClick={() => {
                  setIsOpen((open) => !open);
                }}
              >
                {isOpen ? 'Cancel' : 'Schedule an exam'}
              </Button>
            ) : undefined
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Select
              label="Term"
              options={terms.map((term) => ({
                value: term.id,
                label: `${term.name} · ${term.academicYearName}`,
              }))}
              value={termId}
              placeholder="Select a term"
              onChange={(event) => {
                setTermId(event.target.value);
                setSectionId('');
              }}
            />
            <Select
              label="Section"
              options={sectionOptions}
              value={sectionId}
              placeholder={termId === '' ? 'Choose a term first' : 'Select a section'}
              disabled={sectionOptions.length === 0}
              onChange={(event) => {
                setSectionId(event.target.value);
              }}
            />
            <Input
              label="Title"
              value={title}
              placeholder="First Term Examination"
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
            <Input
              label="Starts"
              type="date"
              value={examDate}
              onChange={(event) => {
                setExamDate(event.target.value);
              }}
            />
          </div>

          <Button
            isLoading={isSaving}
            onClick={() => {
              void create();
            }}
          >
            Schedule
          </Button>
        </div>
      ) : null}

      {exams.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Nothing scheduled yet.
          {terms.length === 0 ? ' Open a term first — every exam belongs to one.' : ''}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="py-2 pr-3 font-medium">Exam</th>
                <th className="py-2 pr-3 font-medium">Class</th>
                <th className="py-2 pr-3 font-medium">Starts</th>
                <th className="py-2 pr-3 font-medium">Papers</th>
                <th className="py-2 pr-3 font-medium">Datesheet</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {exams.map((exam) => (
                <tr key={exam.id}>
                  <td className="py-2.5 pr-3">
                    <p className="font-medium text-ink">{exam.title}</p>
                    <p className="text-xs text-ink-muted">{exam.termName}</p>
                  </td>
                  <td className="py-2.5 pr-3 text-ink">
                    {exam.gradeName} — {exam.sectionName}
                  </td>
                  <td className="py-2.5 pr-3 text-ink">{exam.examDate}</td>
                  <td className="py-2.5 pr-3 text-ink">{exam.paperCount}</td>
                  <td className="py-2.5 pr-3">
                    {exam.isPublished ? (
                      <Badge variant="success">Announced</Badge>
                    ) : (
                      <Badge variant="neutral">Draft</Badge>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    <Link
                      href={`/dashboard/exams/${exam.id}`}
                      className="text-sm font-medium text-brand-primary hover:underline"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
