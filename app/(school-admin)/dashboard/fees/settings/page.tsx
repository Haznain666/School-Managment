import type { Metadata } from 'next';

import { FeeSettingsForm } from '@/components/fees/FeeSettingsForm';
import { DEFAULT_DUE_DAY } from '@/db/schema/late-fee-rules';
import { getLateFeeRule } from '@/lib/fee-queries';
import { canManageFees } from '@/lib/fee-roles';
import { requireSchoolRole } from '@/lib/school-guard';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Fee settings',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FeeSettingsPage() {
  const { claims, locationId } = await requireSchoolRole(ADMIN_PORTAL_ROLES);
  const rule = await getLateFeeRule(locationId);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Fee settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          The due day, the late fee policy, and the bank details printed on every
          challan.
        </p>
      </div>

      <FeeSettingsForm
        canEdit={canManageFees(claims.role)}
        initial={{
          isEnabled: rule?.isEnabled ?? false,
          graceDays: rule?.graceDays ?? 0,
          lateFeeType: rule?.lateFeeType ?? 'fixed',
          lateFeeAmount: rule?.lateFeeAmount ?? '0.00',
          maxLateFee: rule?.maxLateFee ?? null,
          dueDayOfMonth: rule?.dueDayOfMonth ?? DEFAULT_DUE_DAY,
          financialYearStartMonth: rule?.financialYearStartMonth ?? 7,
          bankAccountDetails: rule?.bankAccountDetails ?? null,
        }}
      />
    </div>
  );
}
