import type { Metadata } from 'next';

import { CashCounters } from '@/components/accounting/CashCounters';
import { PageHeader } from '@/components/ui/PageHeader';
import { listStaffForCashAccounts } from '@/lib/accounting-queries';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Cash counters',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Cash counters.
 *
 * Gated on `accounting.settle` rather than `accounting.read`, and that is the
 * control: this is the screen where somebody accepts a clerk's takings, and a
 * clerk who could accept their own count is a control with nobody in it. The
 * accountant role holds `write` and not `settle` by default for the same
 * reason — see `lib/permissions.ts`.
 */
export default async function CashCountersPage() {
  const { locationId } = await requireSchoolPermission('accounting.settle');
  const staff = await listStaffForCashAccounts(locationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash counters"
        description="Who is holding the school's money right now, and settling it in when they hand it over."
        breadcrumbs={[
          { label: 'Accounting', href: '/dashboard/accounting' },
          { label: 'Cash counters' },
        ]}
      />
      <CashCounters staff={staff} />
    </div>
  );
}
