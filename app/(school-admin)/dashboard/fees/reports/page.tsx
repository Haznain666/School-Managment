import type { Metadata } from 'next';

import { FeeReports } from '@/components/fees/FeeReports';
import { PrincipalScopeNote } from '@/components/school/PrincipalScopeNote';
import { PageHeader } from '@/components/ui/PageHeader';
import { listGrades } from '@/lib/admissions-queries';
import { narrowGrades, visibleScopeFor } from '@/lib/principal-visibility';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Fee reports',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FeeReportsPage() {
  const { claims, locationId, permissions } = await requireSchoolPermission('fees.read');

  // A branch-scoped admin only ever sees their own branch's grades.
  const [allGrades, visible] = await Promise.all([
    listGrades(locationId, claims.branchId ?? undefined),
    // BR4 — Sprint 23, item 3. Outstanding, collection and defaulters are all
    // filtered by class on this screen, so narrowing the class list narrows
    // all three.
    visibleScopeFor({ locationId, role: claims.role, uid: claims.uid }),
  ]);

  const grades = narrowGrades(visible, allGrades);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fee reports"
        description="What is owed, what came in, and who needs chasing."
      />

      <PrincipalScopeNote note={visible.note} />

      <FeeReports
        grades={grades.map((grade) => ({ id: grade.id, label: grade.label }))}
        canSendReminders={permissions.includes('fees.write')}
      />
    </div>
  );
}
