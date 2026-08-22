import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ScheduleManager } from '@/components/exams/ScheduleManager';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { listSubjects } from '@/lib/academics-queries';
import { listAdmissionsBranches, listGrades } from '@/lib/admissions-queries';
import { gradeLabels } from '@/lib/class-labels';
import { getExamTerm, listExamSchedules, listGradeCriteria } from '@/lib/exam-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Term datesheets',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PageProps {
  params: Promise<{ termId: string }>;
}

/**
 * One term's datesheets.
 *
 * The mechanism each class is judged by is fetched here rather than inside the
 * editor, because it decides whether the marks columns exist at all — and a
 * client that had to ask for it after mounting would draw the columns once and
 * then take them away, which reads as the form losing what was typed.
 */
export default async function TermSchedulesPage({ params }: PageProps) {
  const { termId } = await params;
  const { locationId, permissions } = await requireSchoolPermission('exams.read');

  const term = await getExamTerm(locationId, termId);
  if (term === null) notFound();

  const [schedules, grades, branches, subjects, criteria] = await Promise.all([
    listExamSchedules(locationId, termId),
    listGrades(locationId),
    listAdmissionsBranches(locationId),
    listSubjects(locationId, { activeOnly: true }),
    listGradeCriteria(locationId, term.academicYearId),
  ]);

  // Qualified by campus only where two grades share a name — see
  // `lib/class-labels.ts`.
  const gradeById = gradeLabels(grades, branches);

  const mechanismByGrade: Record<string, string> = {};
  for (const row of criteria) mechanismByGrade[row.gradeId] = row.mechanism;

  return (
    <div className="space-y-6">
      <PageHeader
        title={term.name}
        description={`${term.academicYearName} · ${term.windowStart} to ${term.windowEnd}`}
        actions={
          <div className="flex flex-nowrap gap-4 whitespace-nowrap text-sm font-medium">
            <Link
              href="/dashboard/exams/criteria"
              className="text-brand-primary hover:underline"
            >
              Promotion criteria
            </Link>
            <Link
              href="/dashboard/exams/terms"
              className="text-brand-primary hover:underline"
            >
              All terms
            </Link>
          </div>
        }
      />

      {term.isArchived ? (
        <Card>
          <h3 className="text-base font-semibold text-ink">This term is archived</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Its datesheets and exams are archived with it. Report cards already
            issued keep rendering exactly as they were.
          </p>
        </Card>
      ) : null}

      <ScheduleManager
        termId={term.id}
        termName={term.name}
        schedules={schedules}
        grades={grades.map((grade) => ({
          id: grade.id,
          label: gradeById.get(grade.id) ?? grade.name,
        }))}
        subjects={subjects.map((subject) => ({ id: subject.id, name: subject.name }))}
        mechanismByGrade={mechanismByGrade}
        canWrite={permissions.includes('exams.write') && !term.isArchived}
      />
    </div>
  );
}
