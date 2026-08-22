import type { Metadata } from 'next';
import Link from 'next/link';

import { ResultHistory } from '@/components/exams/ResultHistory';
import { ReportCardSummary } from '@/components/parent/ReportCardSummary';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getActiveAcademicYear, getStudentBySchoolUserId } from '@/lib/admissions-queries';
import { getExamSettings } from '@/lib/exam-queries';
import {
  getStudentReportCard,
  listPublishedTermsForStudent,
  listStudentResultHistory,
} from '@/lib/portal-results';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'My results',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A student's own results history.
 *
 * ── There is no student id in the URL ────────────────────────────────────
 * The profile is resolved from the uid in the verified session — school user,
 * then student profile — exactly as the dashboard and the timetable do. Only
 * the *term* travels in the query string, and an unrecognised term falls back
 * to the newest published one rather than erroring.
 *
 * ── The same summary the parent portal renders ───────────────────────────
 * `ReportCardSummary` is shared with `/parent/results`. A student and their
 * parent looking at the same term must see the same numbers, and the surest way
 * to guarantee that is for there to be one component and one query behind both.
 */
export default async function StudentResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ term?: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(['student']);

  const [profile, activeYear] = await Promise.all([
    getSchoolUserByUid(locationId, claims.uid),
    getActiveAcademicYear(locationId),
  ]);

  const student =
    profile === null ? null : await getStudentBySchoolUserId(locationId, profile.id);

  if (student === null) {
    return (
      <div className="space-y-6">
        <Heading />
        <Card>
          <p className="text-sm text-ink-muted">
            {activeYear === null
              ? 'Your school has not opened an academic year yet.'
              : 'Your student record is still being set up.'}
          </p>
        </Card>
      </div>
    );
  }

  const [terms, history, settings] = await Promise.all([
    listPublishedTermsForStudent(locationId, student.studentProfileId),
    listStudentResultHistory(locationId, student.studentProfileId),
    getExamSettings(locationId),
  ]);

  const { term: requestedTerm } = await searchParams;
  const term = terms.find((row) => row.termId === requestedTerm) ?? terms[0] ?? null;

  const card =
    term === null
      ? null
      : await getStudentReportCard(locationId, term.termId, student.studentProfileId);

  return (
    <div className="space-y-6">
      <Heading />

      {terms.length === 0 ? (
        <EmptyState
          title="No results have been published yet"
          description="When your school publishes a term’s results, your report card appears here."
        />
      ) : (
        <>
          <Card header={<CardTitle title="Term" />}>
            <nav aria-label="Terms" className="flex flex-wrap gap-2">
              {terms.map((row) => {
                const current = row.termId === term?.termId;
                return (
                  <Link
                    key={row.termId}
                    href={`/student/results?term=${row.termId}`}
                    aria-current={current ? 'page' : undefined}
                    className={
                      current
                        ? 'rounded-full bg-brand-primary px-3 py-1.5 text-sm font-medium text-brand-onPrimary'
                        : 'rounded-full bg-surface-sunken px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-line'
                    }
                  >
                    {row.termName}
                    <span className="ml-1.5 opacity-70">{row.academicYearName}</span>
                  </Link>
                );
              })}
            </nav>
          </Card>

          {card === null ? (
            <Card>
              <p className="text-sm text-ink-muted">
                No report card is available for that term.
              </p>
            </Card>
          ) : (
            <ReportCardSummary card={card} />
          )}

          <ResultHistory
            history={history}
            colorCodingEnabled={settings.colorCodingEnabled}
            studentName="you"
          />
        </>
      )}
    </div>
  );
}

function Heading() {
  return (
    <PageHeader
      title="My results"
      description="Every term your school has published, newest first."
    />
  );
}
