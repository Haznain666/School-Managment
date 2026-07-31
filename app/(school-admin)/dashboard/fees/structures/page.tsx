import type { Metadata } from 'next';
import Link from 'next/link';

import { FeeStructureMatrix } from '@/components/fees/FeeStructureMatrix';
import { Card } from '@/components/ui/Card';
import { listAcademicYears, listAdmissionsBranches } from '@/lib/admissions-queries';
import { canManageFees } from '@/lib/fee-roles';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Fee structure',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FeeStructuresPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);

  const [branches, academicYears] = await Promise.all([
    listAdmissionsBranches(locationId),
    listAcademicYears(locationId),
  ]);

  // A branch-scoped admin only prices their own campus.
  const visibleBranches =
    claims.branchId === null
      ? branches
      : branches.filter((branch) => branch.id === claims.branchId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Fee structure</h2>
        <p className="mt-1 text-sm text-slate-500">
          How much each grade pays under each head, for one academic year.
          Challans copy these amounts at the moment they are raised, so changing
          a figure here never rewrites a bill that has already gone out.
        </p>
      </div>

      {academicYears.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No academic years exist yet. Fees are priced per year, so one has to
            exist first.
          </p>
          <Link
            href="/dashboard/admissions/academic-years/new"
            className="mt-3 inline-block text-sm font-medium text-brand-primary hover:underline"
          >
            Set up an academic year
          </Link>
        </Card>
      ) : visibleBranches.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            This school has no active branches, and grades belong to a branch.
          </p>
        </Card>
      ) : (
        <FeeStructureMatrix
          branches={visibleBranches}
          academicYears={academicYears}
          canEdit={canManageFees(claims.role)}
        />
      )}
    </div>
  );
}
