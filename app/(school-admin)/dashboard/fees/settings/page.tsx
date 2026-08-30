import type { Metadata } from 'next';

import { LateFeeSettingsForm } from '@/components/fees/LateFeeSettingsForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { DEFAULT_DUE_DAY, getLateFeeRule } from '@/lib/fee-queries';
import { activeSiblingSchemes } from '@/lib/sibling-discounts';
import { DEFAULT_AUTO_SEND_DAY } from '@/lib/voucher-auto-send';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Fee settings',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FeeSettingsPage() {
  const { claims, locationId } = await requireSchoolPermission('fees.read');

  const [rule, siblingSchemes] = await Promise.all([
    getLateFeeRule(locationId),
    /*
     * Sprint 20, item 6a. Whether there is anything for the auto-apply to
     * grant.
     *
     * Read here rather than in the form, because "switch this on and nothing
     * happens" is the one outcome a settings screen must never produce
     * silently — and a school that has not created a Sibling Discount scheme
     * yet is the common case on the day this ships.
     */
    activeSiblingSchemes(locationId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fee settings"
        description="When vouchers fall due, what happens to a family's sibling discount, and how your school treats a voucher that passes its due date. Nothing here is on until you switch it on."
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
            autoApplySiblingDiscount: false,
            siblingDiscountForLastChild: false,
          }
        }
        canEdit={claims.role === 'school_admin'}
        siblingSchemeCount={siblingSchemes.length}
      />
    </div>
  );
}
