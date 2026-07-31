import type { Metadata } from 'next';

import { FeeTypeManager } from '@/components/fees/FeeTypeManager';
import { listFeeTypes } from '@/lib/fee-queries';
import { canManageFees } from '@/lib/fee-roles';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Fee heads',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FeeTypesPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const feeTypes = await listFeeTypes(locationId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Fee heads</h2>
        <p className="mt-1 text-sm text-slate-500">
          What this school bills for. Whether a head is charged monthly, once, or
          annually is fixed when it is created — past challans depend on it — so
          a head that needs a different basis is switched off and replaced.
        </p>
      </div>

      <FeeTypeManager initialFeeTypes={feeTypes} canEdit={canManageFees(claims.role)} />
    </div>
  );
}
