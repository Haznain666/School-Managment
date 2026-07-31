import type { Metadata } from 'next';

import { ConcessionManager } from '@/components/fees/ConcessionManager';
import { listFeeTypes } from '@/lib/fee-queries';
import { canManageFees } from '@/lib/fee-roles';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Concessions',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ConcessionsPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const feeTypes = await listFeeTypes(locationId, { activeOnly: true });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Concessions</h2>
        <p className="mt-1 text-sm text-slate-500">
          Sibling discounts, scholarships and waivers, granted per student. A
          concession applies to tuition unless you name another head, and is
          applied against the billing month rather than today — so raising July’s
          challans in August still uses July’s discounts.
        </p>
      </div>

      <ConcessionManager
        feeTypes={feeTypes.map((feeType) => ({ id: feeType.id, name: feeType.name }))}
        canEdit={canManageFees(claims.role)}
      />
    </div>
  );
}
