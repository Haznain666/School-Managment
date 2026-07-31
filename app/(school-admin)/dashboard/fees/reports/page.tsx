import type { Metadata } from 'next';

import { FeeReports } from '@/components/fees/FeeReports';
import { listGrades } from '@/lib/admissions-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { FEE_READ_ROLES, FEE_WRITE_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Fee reports',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FeeReportsPage() {
  const { claims, locationId } = await requireSchoolRole(FEE_READ_ROLES);

  // A branch-scoped admin only ever sees their own branch's grades.
  const grades = await listGrades(locationId, claims.branchId ?? undefined);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Fee reports</h2>
        <p className="mt-1 text-sm text-slate-500">
          What is owed, what came in, and who needs chasing.
        </p>
      </div>

      <FeeReports
        grades={grades.map((grade) => ({ id: grade.id, label: grade.label }))}
        canSendReminders={FEE_WRITE_ROLES.includes(claims.role)}
      />
    </div>
  );
}
