import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { getStudentDetail } from '@/lib/admissions-queries';
import { effectiveBranchIds, resolveBranchScope } from '@/lib/branch-scope';
import { formatDateOnly } from '@/lib/dates';
import { listStudentExamHistory } from '@/lib/exam-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Academic history',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One child's academic history — Sprint 19b, item 17.
 *
 * ── Every row is an exam the school has actually published ──────────────
 * `listStudentExamHistory` reads published papers only. An unpublished mark is
 * not a fact about the child yet: it is a teacher part-way through a sheet, and
 * a history that showed one would change after a parent had read it.
 *
 * ── The percentage and the comment both open the report card ────────────
 * In a **new tab**, `target="_blank" rel="noopener"`. This screen is read
 * *against* the card — an administrator answering a parent on the phone is
 * comparing one to the other — and opening in place would mean losing the
 * history and coming back through the browser's back button every time.
 *
 * The link carries `termId`, `sectionId` and `studentProfileId`, which is what
 * `/dashboard/exams/report-cards/print` already takes. The section is the one
 * the child was in **for that exam**, read off the exam rather than off their
 * current enrollment — a child who has since moved class must still be able to
 * print the card the school issued, and that card belongs to the section they
 * sat it in.
 *
 * ── Gated on `exams.read` and on the campus boundary ────────────────────
 * `students.read` would have been the natural gate, but this screen is marks:
 * `exams.read` is the permission whose label is "See exam terms, datesheets and
 * published results", and the roles a school deliberately withholds it from —
 * see `lib/permissions.ts` — are the ones that must not see a child's results
 * here either.
 */
export default async function StudentHistoryPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { claims, locationId } = await requireSchoolPermission('exams.read');

  const { studentId } = await params;
  if (!isUuid(studentId)) notFound();

  const student = await getStudentDetail(locationId, studentId);
  if (student === null) notFound();

  // The campus boundary, resolved rather than read off the claim — a person
  // granted two campuses may read a child at either. 404 and not 403: telling
  // somebody they may not see this student confirms the student exists.
  const scope = await resolveBranchScope(locationId, claims);
  const reachable = effectiveBranchIds(scope);
  if (
    reachable !== null &&
    student.branchId !== null &&
    !reachable.includes(student.branchId)
  ) {
    notFound();
  }

  const history = await listStudentExamHistory(locationId, studentId);

  return (
    <div className="space-y-6">
      <Link
        href={`/dashboard/admissions/students/${studentId}`}
        className="text-sm font-medium text-brand-primary hover:underline"
      >
        ← {student.name}
      </Link>

      <PageHeader
        title="Academic history"
        description="Every exam this student has a published result for. Marks a teacher has not finished entering are not here — they are not a fact about the child yet."
      />

      <Card header={<CardTitle title={student.name} description={student.studentId} />} className="p-0">
        {history.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">
            No published results yet. Results appear here paper by paper as the
            school publishes them.
          </p>
        ) : (
          <Table caption="Published exam results">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Year</TableHeaderCell>
                <TableHeaderCell>Term</TableHeaderCell>
                <TableHeaderCell>Exam</TableHeaderCell>
                <TableHeaderCell>Class</TableHeaderCell>
                <TableHeaderCell>Percentage</TableHeaderCell>
                <TableHeaderCell>Result</TableHeaderCell>
                <TableHeaderCell>Comment</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((row) => {
                const href =
                  `/dashboard/exams/report-cards/print?termId=${row.termId}` +
                  `&sectionId=${row.sectionId}&studentProfileId=${studentId}`;

                return (
                  <TableRow key={row.examId}>
                    <TableCell rowHeader>{row.academicYearName}</TableCell>
                    <TableCell muted>
                      {row.termName}
                      {row.termIsPublished ? null : (
                        <span className="ml-2">
                          {/*
                            The papers are published; the term is not. The marks
                            below are real, and the report card is not yet
                            issuable to a parent — which is a different fact and
                            one an administrator on the phone needs.
                          */}
                          <Badge variant="warning">Card not issued</Badge>
                        </span>
                      )}
                    </TableCell>
                    <TableCell muted>
                      {row.examTitle}
                      <span className="block text-xs text-ink-muted">
                        {formatDateOnly(row.examDate)} · {row.papers}{' '}
                        {row.papers === 1 ? 'paper' : 'papers'}
                      </span>
                    </TableCell>
                    <TableCell muted>
                      {row.gradeName} {row.sectionName}
                    </TableCell>
                    <TableCell>
                      {row.percentage === null ? (
                        <span className="text-ink-muted">—</span>
                      ) : (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener"
                          className="font-medium text-brand-primary hover:underline"
                        >
                          {row.percentage}%
                        </a>
                      )}
                    </TableCell>
                    <TableCell>
                      <ResultVerdict row={row} />
                    </TableCell>
                    <TableCell muted className="text-xs">
                      {row.comment === null ? (
                        <span className="text-ink-muted">—</span>
                      ) : (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener"
                          className="text-brand-primary hover:underline"
                        >
                          {row.comment}
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/**
 * Passed, not passed, a descriptor, or nothing — and the four are different.
 *
 * ── A dash is an answer here, not a gap ─────────────────────────────────
 * A descriptor-mode exam has no pass marks to be under, so it has no verdict —
 * the descriptor beside it *is* the judgement. An exam the child was absent
 * from every paper of has no verdict either, and printing "Not passed" over an
 * absence would record a failure the school never awarded. Both come out as the
 * descriptor chips or a dash rather than as a red badge.
 */
function ResultVerdict({
  row,
}: {
  row: {
    percentage: number | null;
    failedPapers: number;
    absentPapers: number;
    papers: number;
    descriptors: readonly { id: string; label: string; colorHex: string | null }[];
  };
}) {
  if (row.descriptors.length > 0) {
    return (
      <span className="flex flex-wrap gap-1">
        {row.descriptors.map((descriptor) => (
          <Badge key={descriptor.id} variant="neutral">
            {descriptor.label}
          </Badge>
        ))}
      </span>
    );
  }

  if (row.percentage === null) return <span className="text-ink-muted">—</span>;

  if (row.failedPapers > 0) {
    return (
      <Badge variant="danger">
        Not passed · {row.failedPapers} of {row.papers}
      </Badge>
    );
  }

  return (
    <>
      <Badge variant="success">Passed</Badge>
      {row.absentPapers > 0 ? (
        <span className="ml-2 text-xs text-status-warning-onSubtle">
          {row.absentPapers} absent
        </span>
      ) : null}
    </>
  );
}
