import type { Metadata } from 'next';

import { ConcessionManager } from '@/components/fees/ConcessionManager';
import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
import { PageHeader } from '@/components/ui/PageHeader';
import { listFeeTypes } from '@/lib/fee-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Concessions',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ConcessionsPage() {
  const { locationId, permissions } = await requireSchoolPermission('fees.read');
  const feeTypes = await listFeeTypes(locationId, { activeOnly: true });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Concessions"
        description="Sibling, staff and hardship discounts, granted per student. A concession is applied when a challan is generated, so it affects future bills rather than ones already issued."
      />

      <FeeSetupNav />

      <ConcessionManager
        feeTypes={feeTypes.map((feeType) => ({ id: feeType.id, name: feeType.name }))}
        canEdit={permissions.includes('fees.write')}
      />
    </div>
  );
}
