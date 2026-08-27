import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { FeeClearancePanel } from '@/components/admissions/FeeClearancePanel';
import { GuardianPanel } from '@/components/admissions/GuardianPanel';
import { SiblingCard } from '@/components/admissions/SiblingCard';
import { StudentProfileCard } from '@/components/admissions/StudentProfileCard';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { resolveAdmissionFee } from '@/lib/admission-fee';
import {
  getStudentDetail,
  listEnrollmentHistory,
  listGuardians,
} from '@/lib/admissions-queries';
import { formatDateOnly } from '@/lib/dates';
import { MAX_GUARDIANS } from '@/lib/enrollment';
import { getStudentCreditHistory } from '@/lib/fee-queries';
import { listSiblings } from '@/lib/siblings';
import { requireSchoolPermission } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Student profile',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One student's full record.
 *
 * `studentId` in the URL is `student_profiles.id`, not the printed admission
 * number: the number belongs to the school and could in principle be reissued,
 * while the UUID is this row and only ever this row.
 */
export default async function StudentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  /**
   * `?photo=failed&reason=…` from the enrolment wizard.
   *
   * Reading `searchParams` normally opts a page out of prerendering — see
   * CLAUDE.md — but this page has been `force-dynamic` since it was written,
   * because it is one student's record. There is nothing to lose here.
   */
  searchParams: Promise<{ photo?: string; reason?: string }>;
}) {
  const { claims, locationId, permissions } =
    await requireSchoolPermission('students.read');

  const { studentId } = await params;
  if (!isUuid(studentId)) notFound();

  const student = await getStudentDetail(locationId, studentId);
  if (student === null) notFound();

  // A branch-scoped admin may only look inside their own branch.
  if (claims.branchId !== null && student.branchId !== claims.branchId) notFound();

  const [guardians, enrollments, siblings, admissionFee, credits] = await Promise.all([
    listGuardians(locationId, studentId),
    listEnrollmentHistory(locationId, studentId),
    // Derived, never stored: everyone who shares a guardian identity with this
    // child. See `lib/siblings.ts` for what "the same guardian" means and what
    // that rule costs.
    listSiblings(locationId, studentId),
    // The admission fee as the *fee structure* has it, not as a flag on the
    // enrolment. Sprint 17: the panel below used to know only whether somebody
    // had ticked this admission as paid, which meant it offered that tick on a
    // grade whose admission fee had never been priced.
    resolveAdmissionFee(locationId, studentId),
    // Credit carried forward. `SUM(amount)` over an append-only table — see
    // `db/schema/student-credits.ts`, which is emphatically not the ledger.
    getStudentCreditHistory(locationId, studentId),
  ]);

  const { photo: photoFlag, reason: photoReason } = await searchParams;
  const photoUploadProblem =
    photoFlag === 'failed'
      ? (photoReason ?? 'The upload did not complete.')
      : null;

  // The row that granted the credit, so the card can link to the voucher that
  // explains it rather than to a balance with no history behind it.
  const creditSource =
    credits.entries.find((entry) => entry.sourceChallanId !== null) ?? null;

  /*
   * Whether this admission is still waiting on its fee.
   *
   * Read off the *active* enrolment specifically. A student with none — one
   * who has left, or whose placement has not been made — has no admission to
   * confirm, and treating that as "awaiting fee" would hold their guardians'
   * portal accounts behind a payment nobody is going to make.
   */
  const activeEnrolment = enrollments.find(
    (enrollment) => enrollment.status === 'active',
  );
  const awaitingFee = activeEnrolment?.feeStatus === 'outstanding';

  /*
   * Sprint 18: the card's controls follow the permission, not the role.
   *
   * `canEdit` was `role === 'school_admin' || role === 'branch_admin'`, which
   * had drifted from the route it guards — `PATCH` accepted `admissions.write`,
   * so a principal could already change a record through the API while the
   * screen hid the Edit button from them. A control that is hidden but not
   * enforced is the wrong half of the pair to keep.
   */
  const canEdit = permissions.includes('students.update');
  const canDelete = permissions.includes('students.delete');
  const current = enrollments.find((enrollment) => enrollment.isActiveYear) ?? null;
  const history = enrollments.filter((enrollment) => !enrollment.isActiveYear);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard/admissions/students"
          className="text-sm font-medium text-brand-primary hover:underline"
        >
          ← All students
        </Link>

        <div className="flex flex-nowrap items-center gap-3 whitespace-nowrap">
          {student.isActive ? null : (
            <Badge variant="danger">Portal account deactivated</Badge>
          )}

          {/*
            A transfer always starts from looking at one named child, which is
            why it is reached from here and not from a list. Gated on its own
            permission rather than on `canEdit`: moving a student reassigns
            their fees between two campuses.
          */}
          {permissions.includes('students.transfer') ? (
            <Link
              href={`/dashboard/admissions/students/${studentId}/transfer`}
              className="text-sm font-medium text-brand-primary hover:underline"
            >
              Transfer campus
            </Link>
          ) : null}
        </div>
      </div>

      <StudentProfileCard
        student={student}
        canEdit={canEdit}
        canDelete={canDelete}
        photoUploadProblem={photoUploadProblem}
        credit={{
          balance: credits.balance,
          sourceChallanId: creditSource?.sourceChallanId ?? null,
          sourceChallanNumber: creditSource?.sourceChallanNumber ?? null,
        }}
      />

      <Card header={<CardTitle title="Current enrolment" />}>
        {current === null ? (
          <p className="text-sm text-ink-muted">
            This student has no placement in the active academic year.
          </p>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <Detail label="Academic year" value={current.academicYearName} />
            <Detail label="Grade" value={current.gradeName} />
            <Detail label="Section" value={current.sectionName} />
            <Detail label="Branch" value={current.branchName ?? '—'} />
            <Detail label="Roll number" value={current.rollNumber ?? '—'} />
            <Detail label="Status" value={current.status} />
          </dl>
        )}
      </Card>

      <Card header={<CardTitle title="Enrolment history" />} className="p-0">
        {history.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">
            No earlier academic years on record.
          </p>
        ) : (
          <Table caption="Enrolment history">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Year</TableHeaderCell>
                  <TableHeaderCell>Grade</TableHeaderCell>
                  <TableHeaderCell>Section</TableHeaderCell>
                  <TableHeaderCell>Roll no.</TableHeaderCell>
                  <TableHeaderCell>Enrolled</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {history.map((enrollment) => (
                  <TableRow key={enrollment.id}>
                    <TableCell rowHeader>
                      {enrollment.academicYearName}
                    </TableCell>
                    <TableCell muted>{enrollment.gradeName}</TableCell>
                    <TableCell muted>{enrollment.sectionName}</TableCell>
                    <TableCell muted>
                      {enrollment.rollNumber ?? '—'}
                    </TableCell>
                    <TableCell muted>
                      {formatDateOnly(enrollment.enrollmentDate)}
                    </TableCell>
                    <TableCell muted>
                      {enrollment.status}
                      {enrollment.status === 'active' &&
                      enrollment.feeStatus === 'outstanding' ? (
                        <span className="ml-2">
                          <Badge variant="warning">Fee outstanding</Badge>
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
          </Table>
        )}
      </Card>

      {activeEnrolment === undefined ? null : (
        <FeeClearancePanel
          studentProfileId={student.studentProfileId}
          state={admissionFee}
          feeClearedAt={activeEnrolment.feeClearedAt?.toISOString() ?? null}
          canClear={permissions.includes('fees.write')}
          hasContactableGuardian={guardians.some(
            (guardian) => guardian.email !== null && guardian.email !== '',
          )}
        />
      )}

      {/*
        Above the guardians rather than below them, because the guardians are
        the *reason* for this list and an admin reading downwards meets the
        family before the mechanism that produced it.
      */}
      <SiblingCard
        siblings={siblings}
        hrefFor={(sibling) =>
          `/dashboard/admissions/students/${sibling.studentProfileId}`
        }
      />

      <GuardianPanel
        studentProfileId={student.studentProfileId}
        guardians={guardians.map((guardian) => ({
          ...guardian,
          // Serialised here rather than passed as a Date: the panel is a client
          // component and only ever compares this against null.
          welcomeEmailSentAt: guardian.welcomeEmailSentAt?.toISOString() ?? null,
        }))}
        maxGuardians={MAX_GUARDIANS}
        canEdit={canEdit}
        studentGhlContactId={student.ghlContactId}
        awaitingFee={awaitingFee}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}
