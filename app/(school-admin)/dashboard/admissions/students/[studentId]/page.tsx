import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { GuardianPanel } from '@/components/admissions/GuardianPanel';
import { StudentProfileCard } from '@/components/admissions/StudentProfileCard';
import { Badge } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
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
  const { claims, locationId } = await requireSchoolPermission('admissions.read');

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

        {student.isActive ? null : (
          <Badge variant="danger">Portal account deactivated</Badge>
        )}
      </div>

      <StudentProfileCard student={student} canEdit={canEdit} />

      <Card header={<CardTitle title="Current enrolment" />}>
        {current === null ? (
          <p className="text-sm text-slate-600">
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
          <p className="px-5 py-4 text-sm text-slate-600">
            No earlier academic years on record.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Year</th>
                  <th scope="col" className="px-5 py-3 font-medium">Grade</th>
                  <th scope="col" className="px-5 py-3 font-medium">Section</th>
                  <th scope="col" className="px-5 py-3 font-medium">Roll no.</th>
                  <th scope="col" className="px-5 py-3 font-medium">Enrolled</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((enrollment) => (
                  <tr key={enrollment.id}>
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {enrollment.academicYearName}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{enrollment.gradeName}</td>
                    <td className="px-5 py-3 text-slate-600">{enrollment.sectionName}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {enrollment.rollNumber ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {enrollment.enrollmentDate}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{enrollment.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
    </div>
  );
}
