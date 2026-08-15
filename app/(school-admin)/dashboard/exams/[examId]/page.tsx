import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BarChart } from '@/components/charts/BarChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { ExamPapers } from '@/components/exams/ExamPapers';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { listSubjects } from '@/lib/academics-queries';
import { getExamPerformance, type ExamPerformance } from '@/lib/dashboard-queries';
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

  const [subjects, roster, performance] = await Promise.all([
    listSubjects(locationId, { activeOnly: true }),
    listSectionRoster(locationId, exam.sectionId, exam.academicYearId),
    getExamPerformance(locationId, examId),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageHeader
            breadcrumbs={[
              { label: 'Exams', href: '/dashboard/exams' },
              { label: exam.title },
            ]}
            title={exam.title}
            description={`${exam.gradeName} — ${exam.sectionName} · ${exam.termName} · starts ${exam.examDate}`}
          />
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

      {performance === null ? null : <ExamResults performance={performance} />}

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

const asPercentage = (value: number): string => `${value}%`;
const asCount = (value: number): string => String(Math.round(value));

/** One sentence naming everybody the charts above it leave out, or nothing. */
function ExcludedNote({ performance }: { performance: ExamPerformance }) {
  const parts: string[] = [];
  if (performance.absent > 0) {
    parts.push(
      `${performance.absent} absent from at least one paper`,
    );
  }
  if (performance.unmarked > 0) {
    parts.push(`${performance.unmarked} without a mark on every paper`);
  }
  if (performance.ungraded > 0) {
    parts.push(
      `${performance.ungraded} below every band ${performance.termName} grades against`,
    );
  }

  if (parts.length === 0) return null;

  return (
    <p className="text-xs text-ink-muted">
      Not counted: {parts.join('; ')}. An absent student sat nothing to be graded
      on, so they are in no band and in no pass rate — the tabulation sheet shows
      them paper by paper.
    </p>
  );
}

/**
 * What the marks say, once they are published.
 *
 * ── Why these grades are the school's own ────────────────────────────────
 * The distribution is bucketed by the bands the term is graded against, not by
 * fixed percentages, so two schools with identical marks draw different charts
 * — which is correct, because they award different letters for the same score.
 * It is also the only way this chart can agree with the report card printed
 * from the same marks, and a chart that contradicted the document beside it
 * would be worse than no chart.
 *
 * Only published papers are read, for the same reason the report card reads
 * only those, and the card says how many that leaves out. The tabulation sheet
 * is where unpublished marks are reviewed; it flags them cell by cell, which a
 * bar cannot.
 */
function ExamResults({ performance }: { performance: ExamPerformance }) {
  if (performance.publishedPapers === 0) {
    return (
      <Card header={<CardTitle title="Results" />}>
        <p className="text-sm text-ink-muted">
          No paper&rsquo;s marks are published yet, so there is nothing to chart.
          Marks under review are on the tabulation sheet, flagged as unpublished.
        </p>
      </Card>
    );
  }

  const scope =
    performance.publishedPapers === performance.totalPapers
      ? `All ${performance.totalPapers} papers, graded against ${performance.termName}'s scheme`
      : `${performance.publishedPapers} of ${performance.totalPapers} papers — the published ones — graded against ${performance.termName}'s scheme`;

  if (performance.graded === 0) {
    return (
      <Card header={<CardTitle title="Results" description={scope} />}>
        <p className="text-sm text-ink-muted">
          No student has a mark on every published paper yet, so nothing can be
          graded or counted towards a pass rate.
        </p>
        <div className="mt-3">
          <ExcludedNote performance={performance} />
        </div>
      </Card>
    );
  }

  const failed = performance.graded - performance.passed;
  const hasBands = performance.distribution.length > 0;

  return (
    <Card header={<CardTitle title="Results" description={scope} />}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-3 text-sm font-medium text-ink">Pass rate</h4>
          <DonutChart
            title="Pass rate"
            summary={`${performance.passed} of ${performance.graded} students passed every published paper; ${failed} did not.`}
            centerValue={`${performance.passRate ?? 0}%`}
            centerLabel="passed"
            slices={[
              { label: 'Passed', value: performance.passed, fillClass: 'fill-status-success' },
              { label: 'Did not pass', value: failed, fillClass: 'fill-status-danger' },
            ]}
            format={asCount}
          />
          <p className="mt-3 text-xs text-ink-muted">
            Passing means reaching the pass mark on every published paper, which
            is what the tabulation sheet&rsquo;s failed-paper count already says.
          </p>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-medium text-ink">Grade distribution</h4>
          {hasBands ? (
            <BarChart
              title="Students per grade"
              summary={`How ${performance.graded} students fell across the bands ${performance.termName} is graded against, highest first.`}
              categories={performance.distribution.map((band) => band.label)}
              series={[
                { label: 'Students', values: performance.distribution.map((band) => band.value) },
              ]}
              format={asCount}
            />
          ) : (
            <p className="text-sm text-ink-muted">
              This term is graded against no scheme, so there are no bands to
              count into.{' '}
              <Link
                href="/dashboard/exams/grading"
                className="font-medium text-brand-primary hover:underline"
              >
                Set up a grading scheme
              </Link>
              , then choose it on the term.
            </p>
          )}
        </div>
      </div>

      <div className="mt-6">
        <h4 className="mb-3 text-sm font-medium text-ink">Subject averages</h4>
        <BarChart
          title="Average percentage per subject"
          summary={`Mean percentage in each of the ${performance.subjects.length} published papers, over the students who sat each one.`}
          categories={performance.subjects.map((subject) => subject.label)}
          series={[
            { label: 'Average', values: performance.subjects.map((subject) => subject.value) },
          ]}
          format={asPercentage}
        />
        <p className="mt-3 text-xs text-ink-muted">
          Each paper&rsquo;s average is over the students who sat{' '}
          <em>that</em> paper, so a child who missed one subject still counts in
          the others.
        </p>
      </div>

      <div className="mt-6">
        <ExcludedNote performance={performance} />
      </div>
    </Card>
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
      <div className="rounded-card border border-line bg-surface-sunken p-4">
        <p className="font-medium text-ink-muted">{title}</p>
        <p className="mt-1 text-sm text-ink-muted">{description}</p>
      </div>
    );
  }

  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener"
      className="block rounded-card border border-line bg-surface-raised p-4 shadow-card transition hover:border-brand-primary"
    >
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>
    </Link>
  );
}
