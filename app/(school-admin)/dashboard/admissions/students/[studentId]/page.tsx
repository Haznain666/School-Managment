import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { GuardianPanel } from '@/components/admissions/GuardianPanel';
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
import {
  getStudentDetail,
  listEnrollmentHistory,
  listGuardians,
} from '@/lib/admissions-queries';
import { MAX_GUARDIANS } from '@/lib/enrollment';
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
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { claims, locationId, permissions } =
    await requireSchoolPermission('admissions.read');

  const { studentId } = await params;
  if (!isUuid(studentId)) notFound();

  const student = await getStudentDetail(locationId, studentId);
  if (student === null) notFound();

  // A branch-scoped admin may only look inside their own branch.
  if (claims.branchId !== null && student.branchId !== claims.branchId) notFound();

  const [guardians, enrollments] = await Promise.all([
    listGuardians(locationId, studentId),
    listEnrollmentHistory(locationId, studentId),
  ]);

  const canEdit = claims.role === 'school_admin' || claims.role === 'branch_admin';
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

      <StudentProfileCard student={student} canEdit={canEdit} />

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
                      {enrollment.enrollmentDate}
                    </TableCell>
                    <TableCell muted>{enrollment.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
          </Table>
        )}
      </Card>

      <GuardianPanel
        studentProfileId={student.studentProfileId}
        guardians={guardians}
        maxGuardians={MAX_GUARDIANS}
        canEdit={canEdit}
        studentGhlContactId={student.ghlContactId}
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
