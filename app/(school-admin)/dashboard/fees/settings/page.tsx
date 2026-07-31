import type { Metadata } from 'next';

import { LateFeeSettingsForm } from '@/components/fees/LateFeeSettingsForm';
import { DEFAULT_DUE_DAY, getLateFeeRule } from '@/lib/fee-queries';
import { requireSchoolRole } from '@/lib/school-guard';
import { FEE_READ_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Fee settings',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FeeSettingsPage() {
  const { claims, locationId } = await requireSchoolRole(FEE_READ_ROLES);
  const rule = await getLateFeeRule(locationId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Fee settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          When challans fall due, and how your school treats the ones that pass
          that date. No late fee is charged until you switch it on.
        </p>
      </div>

      <LateFeeSettingsForm
        initial={
          rule ?? {
            dueDay: DEFAULT_DUE_DAY,
            isEnabled: false,
            graceDays: 0,
            lateFeeType: 'fixed',
            lateFeeAmount: '0',
            maxLateFee: null,
          }
        }
        canEdit={claims.role === 'school_admin'}
      />
    </div>
  );
}
