import type { Metadata } from 'next';
import Link from 'next/link';

import { ChallanTable } from '@/components/fees/ChallanTable';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { listAcademicYears, listAdmissionsBranches } from '@/lib/admissions-queries';
import { canManageFees } from '@/lib/fee-roles';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Challans',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ChallansPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);

  const [branches, academicYears] = await Promise.all([
    listAdmissionsBranches(locationId),
    listAcademicYears(locationId),
  ]);

  const canManage = canManageFees(claims.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Challans</h2>
          <p className="mt-1 text-sm text-slate-500">
            Every bill raised, with what has been paid against it.
          </p>
        </div>

        {canManage ? (
          <Link href="/dashboard/fees/challans/generate">
            <Button>Generate challans</Button>
          </Link>
        ) : null}
      </div>

      {academicYears.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No academic years exist yet, so nothing can have been billed.
          </p>
        </Card>
      ) : (
        <ChallanTable
          academicYears={academicYears}
          branches={branches}
          canManage={canManage}
        />
      )}
    </div>
  );
}
