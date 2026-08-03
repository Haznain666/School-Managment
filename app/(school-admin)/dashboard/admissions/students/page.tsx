import type { Metadata } from 'next';
import Link from 'next/link';

import { StudentTable } from '@/components/admissions/StudentTable';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { listAcademicYears, listAdmissionsBranches } from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Students',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function StudentsPage() {
  const { claims, locationId } = await requireSchoolPermission('admissions.read');

  const [branches, academicYears] = await Promise.all([
    listAdmissionsBranches(locationId),
    listAcademicYears(locationId),
  ]);

  const canEnroll = claims.role === 'school_admin' || claims.role === 'branch_admin';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Students</h2>
          <p className="mt-1 text-sm text-slate-500">
            Everyone enrolled, by academic year. A student with no placement in
            the selected year does not appear under it.
          </p>
        </div>

        <div className="flex gap-3">
          {/* Export lands in a later sprint; shown disabled so the absence is
              deliberate rather than looking like a missing feature. */}
          <Button variant="secondary" disabled title="Coming in a later sprint">
            Export
          </Button>

          {canEnroll ? (
            <Link href="/dashboard/admissions/enroll">
              <Button>Enrol student</Button>
            </Link>
          ) : null}
        </div>
      </div>

      {academicYears.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No academic years exist yet, so there is nothing to list.
          </p>
          <Link
            href="/dashboard/admissions/academic-years/new"
            className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up an academic year
          </Link>
        </Card>
      ) : (
        <StudentTable
          branches={branches}
          academicYears={academicYears}
          lockedBranchId={claims.branchId}
        />
      )}
    </div>
  );
}
