import type { Metadata } from 'next';

import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { getActiveAcademicYear, getStudentBySchoolUserId } from '@/lib/admissions-queries';
import { listStudentExams } from '@/lib/portal-results';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'My exams',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A student's datesheet.
 *
 * ── Only announced exams ─────────────────────────────────────────────────
 * `listStudentExams` filters on the exam's own publication flag — Sprint 9's
 * datesheet announcement. A school scheduling an exam and a school telling
 * students about it are two acts, and a portal that showed the first would
 * spread a date the school had not committed to and then have to explain why it
 * moved.
 *
 * ── Split at today, because that is the question ─────────────────────────
 * "What is coming" and "what have I sat" are different questions asked at
 * different times, and one merged list answers whichever the reader scrolls to
 * first. The split is on the date alone; the results themselves live on
 * `/student/results`, and this page links there rather than duplicating them.
 */
export default async function StudentExamsPage() {
  const { claims, locationId } = await requireSchoolRole(['student']);

  const [profile, activeYear] = await Promise.all([
    getSchoolUserByUid(locationId, claims.uid),
    getActiveAcademicYear(locationId),
  ]);

  const student =
    profile === null ? null : await getStudentBySchoolUserId(locationId, profile.id);

  if (student === null || activeYear === null) {
    return (
      <div className="space-y-6">
        <Heading />
        <Card>
          <p className="text-sm text-ink-muted">
            {activeYear === null
              ? 'Your school has not opened an academic year yet, so there is no datesheet.'
              : 'Your student record is still being set up.'}
          </p>
        </Card>
      </div>
    );
  }

  const exams = await listStudentExams(
    locationId,
    student.studentProfileId,
    activeYear.id,
  );

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = exams.filter((exam) => exam.examDate >= today);
  const past = exams.filter((exam) => exam.examDate < today).reverse();

  return (
    <div className="space-y-6">
      <Heading />

      {exams.length === 0 ? (
        <EmptyState
          title="No exams have been announced"
          description="Your datesheet appears here as soon as your school announces one for your class."
        />
      ) : (
        <>
          <Card
            header={
              <CardTitle
                title="Coming up"
                description={
                  upcoming.length === 0
                    ? 'Nothing scheduled from today onwards.'
                    : `${upcoming.length} exam${upcoming.length === 1 ? '' : 's'} ahead.`
                }
              />
            }
            className="p-0"
          >
            {upcoming.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">
                Nothing is scheduled from today onwards.
              </p>
            ) : (
              <ExamList exams={upcoming} highlightNext />
            )}
          </Card>

          {past.length === 0 ? null : (
            <Card
              header={
                <CardTitle
                  title="Already sat"
                  description="Marks appear under My Results once your school publishes the term."
                />
              }
              className="p-0"
            >
              <ExamList exams={past} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function ExamList({
  exams,
  highlightNext = false,
}: {
  exams: readonly { examId: string; title: string; examDate: string; termName: string }[];
  highlightNext?: boolean;
}) {
  return (
    <ul className="divide-y divide-line">
      {exams.map((exam, index) => (
        <li
          key={exam.examId}
          className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
        >
          <div className="min-w-0">
            <p className="font-medium text-ink">{exam.title}</p>
            <p className="text-xs text-ink-muted">{exam.termName}</p>
          </div>
          <div className="flex items-center gap-2">
            {highlightNext && index === 0 ? <Badge variant="warning">Next</Badge> : null}
            <span className="text-sm text-ink">{exam.examDate}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Heading() {
  return (
    <PageHeader
      title="My exams"
      description="Your class’s datesheet, as announced by your school."
    />
  );
}
