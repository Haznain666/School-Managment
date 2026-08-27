import type { Metadata } from 'next';

import { LateFeeSettingsForm } from '@/components/fees/LateFeeSettingsForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { DEFAULT_DUE_DAY, getLateFeeRule } from '@/lib/fee-queries';
import { DEFAULT_AUTO_SEND_DAY } from '@/lib/voucher-auto-send';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Fee settings',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FeeSettingsPage() {
  const { claims, locationId } = await requireSchoolPermission('fees.read');
  const rule = await getLateFeeRule(locationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fee settings"
        description="When challans fall due, and how your school treats the ones that pass that date. No late fee is charged until you switch it on."
      />

      <LateFeeSettingsForm
        initial={
          rule ?? {
            dueDay: DEFAULT_DUE_DAY,
            autoSendVouchers: false,
            autoSendDay: DEFAULT_AUTO_SEND_DAY,
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
