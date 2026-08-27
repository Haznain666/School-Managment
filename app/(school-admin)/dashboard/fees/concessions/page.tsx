import type { Metadata } from 'next';

import { ConcessionsTabs } from '@/components/fees/ConcessionsTabs';
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
        description="Sibling, staff and hardship discounts. Define a scheme once and grant it by name, or record a one-off concession against a single student. Granting one re-prices everything that student still owes."
      />

      <FeeSetupNav />

      <ConcessionsTabs
        feeTypes={feeTypes.map((feeType) => ({ id: feeType.id, name: feeType.name }))}
        canEdit={permissions.includes('fees.write')}
      />
    </div>
  );
}
