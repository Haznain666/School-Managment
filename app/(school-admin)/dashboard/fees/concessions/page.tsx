import type { Metadata } from 'next';

import { ConcessionManager } from '@/components/fees/ConcessionManager';
import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
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
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Concessions</h2>
        <p className="mt-1 text-sm text-slate-500">
          Sibling, staff and hardship discounts, granted per student. A concession
          is applied when a challan is generated, so it affects future bills
          rather than ones already issued.
        </p>
      </div>

      <FeeSetupNav />

      <ConcessionManager
        feeTypes={feeTypes.map((feeType) => ({ id: feeType.id, name: feeType.name }))}
        canEdit={permissions.includes('fees.write')}
      />
    </div>
  );
}
