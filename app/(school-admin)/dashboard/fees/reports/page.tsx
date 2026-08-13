import type { Metadata } from 'next';

import { FeeReports } from '@/components/fees/FeeReports';
import { PageHeader } from '@/components/ui/PageHeader';
import { listGrades } from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Fee reports',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FeeReportsPage() {
  const { claims, locationId, permissions } = await requireSchoolPermission('fees.read');

  // A branch-scoped admin only ever sees their own branch's grades.
  const grades = await listGrades(locationId, claims.branchId ?? undefined);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fee reports"
        description="What is owed, what came in, and who needs chasing."
      />

      <FeeReports
        grades={grades.map((grade) => ({ id: grade.id, label: grade.label }))}
        canSendReminders={permissions.includes('fees.write')}
      />
    </div>
  );
}
