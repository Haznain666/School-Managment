import type { Metadata } from 'next';
import Link from 'next/link';

import { BarChart } from '@/components/charts/BarChart';
import { ExamScheduler } from '@/components/exams/ExamScheduler';
import { TermManager } from '@/components/exams/TermManager';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { listAdmissionsBranches, listGrades, listSections } from '@/lib/admissions-queries';
import { gradeLabels, sectionLabel } from '@/lib/class-labels';
import { listAcademicYearOptions } from '@/lib/academics-queries';
import { getRecentExamOutcomes, type ExamOutcome } from '@/lib/dashboard-queries';
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

  const [terms, exams, years, schemes, sections, grades, branches, outcomes] =
    await Promise.all([
      listExamTerms(locationId),
      listExams(locationId),
      listAcademicYearOptions(locationId),
      listGradingSchemes(locationId),
      listSections(locationId, {}),
      listGrades(locationId),
      listAdmissionsBranches(locationId),
      getRecentExamOutcomes(locationId),
    ]);

  // Qualified by campus only where two grades share a name — see
  // `lib/class-labels.ts`.
  const gradeById = gradeLabels(grades, branches);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exams &amp; results"
        description="Terms, datesheets, marks, and the documents a school hands out afterwards."
        actions={
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
        }
      />

      {years.length === 0 ? (
        <Card>
          <h3 className="text-base font-semibold text-ink">
            No academic year
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
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
          label: sectionLabel(
            gradeById.get(section.gradeId) ?? 'Class',
            section.name,
          ),
        }))}
        exams={exams}
        canWrite={permissions.includes('exams.write')}
      />

      <RecentResults outcomes={outcomes} />
    </div>
  );
}

/** `Class 5 — A` for a chart axis, disambiguated when a class sat two exams. */
function outcomeLabels(outcomes: readonly ExamOutcome[]): string[] {
  const seen = new Map<string, number>();
  for (const outcome of outcomes) {
    seen.set(outcome.className, (seen.get(outcome.className) ?? 0) + 1);
  }

  return outcomes.map((outcome) => {
    const base = outcome.className.replace(' — ', ' ');
    // Two exams for the same class in the same window would otherwise draw two
    // bars under one label, which reads as one exam measured twice.
    if ((seen.get(outcome.className) ?? 0) < 2) return base;
    return `${base} · ${outcome.examDate.slice(5, 7)}/${outcome.examDate.slice(2, 4)}`;
  });
}

/**
 * The most recent exams with published marks, as pass rate against average.
 *
 * Percentages rather than grades on purpose: each exam is graded against its own
 * term's scheme, so an "A" column here could stack two different meanings of A
 * if a school changed schemes between terms. The per-exam page draws the
 * distribution, where there is exactly one scheme in play.
 */
function RecentResults({ outcomes }: { outcomes: readonly ExamOutcome[] }) {
  const charted = outcomes.filter(
    (outcome) => outcome.passRate !== null && outcome.average !== null,
  );

  if (charted.length === 0) return null;

  const labels = outcomeLabels(charted);

  return (
    <Card
      header={
        <CardTitle
          title="Recent results"
          description={`The last ${charted.length} ${charted.length === 1 ? 'exam' : 'exams'} with published marks`}
        />
      }
    >
      <BarChart
        title="Pass rate and average by exam"
        summary={`Pass rate against mean percentage for the last ${charted.length} exams with published marks, oldest first.`}
        categories={labels}
        series={[
          {
            label: 'Pass rate',
            values: charted.map((outcome) => outcome.passRate ?? 0),
          },
          {
            label: 'Average',
            values: charted.map((outcome) => outcome.average ?? 0),
          },
        ]}
        format={(value) => `${value}%`}
      />
      <p className="mt-3 text-xs text-ink-muted">
        Over students with a mark on every published paper. Students absent from
        a paper are in neither figure — {charted.reduce((sum, o) => sum + o.absent, 0)}{' '}
        across these exams. Open an exam for its grade distribution, which is
        bucketed by the bands its own term is graded against.
      </p>
    </Card>
  );
}
