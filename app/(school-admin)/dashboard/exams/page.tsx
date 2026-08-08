import type { Metadata } from 'next';
import Link from 'next/link';

import { ExamScheduler } from '@/components/exams/ExamScheduler';
import { TermManager } from '@/components/exams/TermManager';
import { Card } from '@/components/ui/Card';
import { listGrades, listSections } from '@/lib/admissions-queries';
import { listAcademicYearOptions } from '@/lib/academics-queries';
import { listExamTerms, listExams, listGradingSchemes } from '@/lib/exam-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Exams',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The Exams overview: terms above, scheduled exams below.
 *
 * Terms come first because nothing else can exist without one, and the order
 * of the two cards is the order a school sets this up in.
 *
 * Every read is scoped to the caller's own school — the location id comes from
 * their verified session, so there is no request parameter that could widen it.
 */
export default async function ExamsOverviewPage() {
  const { locationId, permissions } = await requireSchoolPermission('exams.read');

  const [terms, exams, years, schemes, sections, grades] = await Promise.all([
    listExamTerms(locationId),
    listExams(locationId),
    listAcademicYearOptions(locationId),
    listGradingSchemes(locationId),
    listSections(locationId, {}),
    listGrades(locationId),
  ]);

  const gradeById = new Map(grades.map((grade) => [grade.id, grade.label]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Exams &amp; results</h2>
          <p className="mt-1 text-sm text-slate-500">
            Terms, datesheets, marks, and the documents a school hands out
            afterwards.
          </p>
        </div>

        <div className="flex flex-nowrap gap-4 whitespace-nowrap text-sm font-medium">
          <Link
            href="/dashboard/exams/report-cards"
            className="text-brand-primary hover:underline"
          >
            Report cards
          </Link>
          <Link
            href="/dashboard/exams/grading"
            className="text-brand-primary hover:underline"
          >
            Grading schemes
          </Link>
        </div>
      </div>

      {years.length === 0 ? (
        <Card>
          <h3 className="text-base font-semibold text-slate-900">
            No academic year
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            An exam term is filed against a year, so nothing here can be set up
            until one exists.
          </p>
          <Link
            href="/dashboard/admissions/academic-years"
            className="mt-4 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up an academic year
          </Link>
        </Card>
      ) : null}

      <TermManager
        terms={terms}
        academicYears={years}
        gradingSchemes={schemes.filter((scheme) => scheme.isActive)}
        canWrite={permissions.includes('exams.write')}
        canPublish={permissions.includes('exams.publish')}
      />

      <ExamScheduler
        terms={terms}
        sections={sections.map((section) => ({
          id: section.id,
          gradeId: section.gradeId,
          academicYearId: section.academicYearId,
          label: `${gradeById.get(section.gradeId) ?? 'Class'} — ${section.name}`,
        }))}
        exams={exams}
        canWrite={permissions.includes('exams.write')}
      />
    </div>
  );
}
