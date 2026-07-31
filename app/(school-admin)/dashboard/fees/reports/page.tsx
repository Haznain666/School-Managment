import type { Metadata } from 'next';

import { FeeReports } from '@/components/fees/FeeReports';
import { listAcademicYears } from '@/lib/admissions-queries';
import { canManageFees } from '@/lib/fee-roles';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Fee reports',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FeeReportsPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const academicYears = await listAcademicYears(locationId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Fee reports</h2>
        <p className="mt-1 text-sm text-slate-500">
          Who owes, how a month collected, and who to chase.
        </p>
      </div>

      <FeeReports academicYears={academicYears} canManage={canManageFees(claims.role)} />
    </div>
  );
}
