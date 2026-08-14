import type { Metadata } from 'next';

import { FamilyVouchers } from '@/components/fees/FamilyVouchers';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Family vouchers',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One voucher for a parent with several children at the school.
 *
 * A payment convenience rather than a change to who is billed: each child keeps
 * their own challan underneath, and that is still what fee reports, the
 * defaulter list and a student's own ledger read.
 */
export default async function FamilyVouchersPage() {
  const { permissions } = await requireSchoolPermission('fees.read');

  const now = new Date();

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Family vouchers"
        description="One slip, one total, for a parent with more than one child here. Each child keeps their own challan underneath — a voucher is how the money is collected, not a change to who is billed."
      />

      <FamilyVouchers
        canWrite={permissions.includes('fees.write')}
        defaultMonth={now.getMonth() + 1}
        defaultYear={now.getFullYear()}
      />
    </div>
  );
}
