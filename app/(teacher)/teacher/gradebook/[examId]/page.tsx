import type { Metadata } from 'next';
import Link from 'next/link';

import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { listTeacherSections } from '@/lib/academics-queries';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { getTabulation } from '@/lib/exam-queries';
import { formatMark, formatPercentage } from '@/lib/grading';
import { requireSchoolRole } from '@/lib/school-guard';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Gradebook',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One exam, every student, every subject.
 *
 * ── The authorisation check is repeated here ─────────────────────────────
 * The list page only linked here; this page decides. The exam's section must be
 * one `listTeacherSections` returns for this teacher, checked after the
 * tenant-scoped fetch — an exam id from another school comes back null, and one
 * from a colleague's class is refused by name.
 *
 * ── Unpublished marks are shown, and said to be unpublished ──────────────
 * A teacher is entitled to see what has been entered for their own class before
 * a term is published — that is what checking is. Every unpublished cell is
 * marked, because the number a teacher quotes to a parent from an unpublished
 * column is a number the school has not stood behind yet.
 */
export default async function TeacherGradebookExamPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { claims, locationId } = await requireSchoolRole(['teacher']);
  const { examId } = await params;

  if (!isUuid(examId)) return <Message>That is not an exam.</Message>;

  const [profile, activeYear] = await Promise.all([
    getSchoolUserByUid(locationId, claims.uid),
    getActiveAcademicYear(locationId),
  ]);

  if (profile === null || activeYear === null) {
    return <Message>Your staff record or academic year is not set up yet.</Message>;
  }

  const tabulation = await getTabulation(locationId, examId);
  if (tabulation === null) return <Message>No such exam.</Message>;

  const mySections = await listTeacherSections(locationId, profile.id, activeYear.id);
  if (!mySections.some((section) => section.sectionId === tabulation.exam.sectionId)) {
    return <Message>That exam is for a class you do not teach.</Message>;
  }

  const { exam, papers, rows, hasUnpublished } = tabulation;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Gradebook', href: '/teacher/gradebook' }, { label: exam.title }]}
        title={exam.title}
        description={`${exam.gradeName} ${exam.sectionName} · ${exam.termName} · ${exam.examDate}`}
      />

      {hasUnpublished ? (
        <p className="rounded-lg bg-status-warning-subtle px-3 py-2 text-sm text-status-warning-onSubtle">
          Some papers here are not published. Those marks are visible to you and
          your school, and <strong>not</strong> to parents or students — they may
          still change.
        </p>
      ) : null}

      <Card className="p-0">
        {/* Scrolls inside its own box: a class of forty against eight subjects
            is wider than a phone, and a page that scrolls sideways as a whole
            takes the navigation with it. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">
              {exam.title} marks for {exam.gradeName} {exam.sectionName}
            </caption>
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="px-4 py-2 font-medium text-ink-muted">
                  Student
                </th>
                {papers.map((paper) => (
                  <th
                    key={paper.id}
                    scope="col"
                    className="px-3 py-2 text-right font-medium text-ink-muted"
                  >
                    {paper.subjectName}
                    <span className="block text-xs font-normal">
                      / {paper.maxMarks}
                    </span>
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 text-right font-medium text-ink-muted">
                  Total
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-ink-muted">
                  %
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium text-ink-muted">
                  Position
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.student.studentProfileId}>
                  <th scope="row" className="px-4 py-2 text-left font-normal text-ink">
                    {row.student.studentName}
                    <span className="block text-xs text-ink-muted">
                      {row.student.rollNumber === null
                        ? row.student.studentId
                        : `Roll ${row.student.rollNumber}`}
                    </span>
                  </th>

                  {row.cells.map((cell) => (
                    <td
                      key={cell.examSubjectId}
                      className={
                        cell.isFail
                          ? 'px-3 py-2 text-right font-medium text-status-danger-ink'
                          : 'px-3 py-2 text-right text-ink'
                      }
                    >
                      {cell.isAbsent ? 'ABS' : formatMark(cell.marks)}
                      {cell.isPublished ? null : (
                        <span
                          title="Not published"
                          aria-label="Not published"
                          className="ml-1 text-ink-muted"
                        >
                          *
                        </span>
                      )}
                    </td>
                  ))}

                  <td className="px-3 py-2 text-right text-ink">
                    {formatMark(row.obtained)}
                  </td>
                  <td className="px-3 py-2 text-right text-ink">
                    {formatPercentage(row.percentage)}
                  </td>
                  <td className="px-4 py-2 text-right text-ink-muted">
                    {row.position === null ? (
                      <span title="Missed a paper">—</span>
                    ) : (
                      row.position
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="border-t border-line px-4 py-3 text-xs text-ink-muted">
          <span aria-hidden="true">*</span> not published yet. A dash under
          Position means the student missed a paper — ranking them against
          classmates who sat everything would not be a fair comparison.
        </p>
      </Card>

      <div className="flex flex-wrap gap-3">
        {papers.map((paper) => (
          <Link
            key={paper.id}
            href={`/teacher/marks/${paper.id}`}
            className="text-sm font-medium text-brand-primary hover:underline"
          >
            Enter {paper.subjectName} marks
          </Link>
        ))}
      </div>
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <PageHeader title="Gradebook" />
      <Card>
        <p className="text-sm text-ink-muted">{children}</p>
        <Link
          href="/teacher/gradebook"
          className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
        >
          Back to the gradebook
        </Link>
      </Card>
    </div>
  );
}
