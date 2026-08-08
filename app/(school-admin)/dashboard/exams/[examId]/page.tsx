import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ExamPapers } from '@/components/exams/ExamPapers';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { listSubjects } from '@/lib/academics-queries';
import { admitCardHref, tabulationHref } from '@/lib/exam-print';
import { getExamDetail, listSectionRoster } from '@/lib/exam-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Exam',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One exam: its datesheet, the state of every paper's marks, and the three
 * documents it produces.
 *
 * The tabulation sheet and the admit cards are linked from here rather than
 * from a reports menu, because both are things somebody wants *while looking
 * at this exam* — one before it, one after.
 */
export default async function ExamDetailPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { locationId, permissions } = await requireSchoolPermission('exams.read');
  const { examId } = await params;

  if (!isUuid(examId)) notFound();

  const exam = await getExamDetail(locationId, examId);
  if (exam === null) notFound();

  const [subjects, roster] = await Promise.all([
    listSubjects(locationId, { activeOnly: true }),
    listSectionRoster(locationId, exam.sectionId, exam.academicYearId),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/dashboard/exams"
            className="text-sm font-medium text-brand-primary hover:underline"
          >
            ← All exams
          </Link>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">{exam.title}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {exam.gradeName} — {exam.sectionName} · {exam.termName} · starts{' '}
            {exam.examDate}
          </p>
        </div>

        <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
          {exam.isPublished ? (
            <Badge variant="success">Datesheet announced</Badge>
          ) : (
            <Badge variant="neutral">Datesheet not announced</Badge>
          )}
          {exam.termIsPublished ? <Badge variant="success">Term published</Badge> : null}
        </div>
      </div>

      <ExamPapers
        examId={exam.id}
        isPublished={exam.isPublished}
        papers={exam.papers}
        subjects={subjects}
        rosterSize={roster.length}
        canWrite={permissions.includes('exams.write')}
        canPublishExam={permissions.includes('exams.publish')}
        canPublishResults={permissions.includes('results.publish')}
        canEnterMarks={permissions.includes('results.enter')}
      />

      <Card header={<CardTitle title="Documents" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <DocumentTile
            href={tabulationHref(exam.id)}
            title="Tabulation sheet"
            description="The whole class against every paper, with totals, grades and position holders. Includes unpublished marks, flagged — reviewing them is the point."
          />
          <DocumentTile
            href={admitCardHref(exam.id)}
            title="Admit cards"
            description={
              exam.isPublished
                ? 'One card per student, carrying the full datesheet.'
                : 'Announce the datesheet first — an admit card for an unannounced exam tells a student nothing they can rely on.'
            }
            disabled={!exam.isPublished}
          />
        </div>
      </Card>
    </div>
  );
}

function DocumentTile({
  href,
  title,
  description,
  disabled = false,
}: {
  href: string;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <div className="rounded-card border border-slate-200 bg-slate-50 p-4">
        <p className="font-medium text-slate-500">{title}</p>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
    );
  }

  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener"
      className="block rounded-card border border-slate-200 bg-white p-4 shadow-card transition hover:border-brand-primary"
    >
      <p className="font-medium text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </Link>
  );
}
