import type { Metadata } from 'next';

import { FamilyVouchers } from '@/components/fees/FamilyVouchers';
import { PageHeader } from '@/components/ui/PageHeader';
import { getActiveAcademicYear } from '@/lib/admissions-queries';
import { requireSchoolPermission } from '@/lib/school-guard';
import { targetPeriod } from '@/lib/voucher-auto-generate';

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
  const { permissions, locationId } = await requireSchoolPermission('fees.read');

  const now = new Date();

  /*
   * Two different months on one screen, and that is not a mistake.
   *
   * The *clubbing* list is about vouchers that already exist, which is this
   * month's billing. The *generator* raises next month's, because fees here
   * are pre-paid — October is billed during September. `targetPeriod` is the
   * same function the automatic run uses, so the screen and the sweeper cannot
   * drift on which month "next" is, including across December.
   */
  const nextPeriod = targetPeriod(now);
  const activeYear = await getActiveAcademicYear(locationId);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Family vouchers"
        description="One slip, one total, for a parent with more than one child here. Each child keeps their own voucher underneath — a voucher is how the money is collected, not a change to who is billed."
      />

      <FamilyVouchers
        canWrite={permissions.includes('fees.write')}
        defaultMonth={now.getMonth() + 1}
        defaultYear={now.getFullYear()}
        activeAcademicYearId={activeYear?.id ?? null}
        nextBillingMonth={nextPeriod.billingMonth}
        nextBillingYear={nextPeriod.billingYear}
      />
    </div>
  );
}
