import { asc } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';

import { InvoiceListing } from '@/components/super-admin/InvoiceListing';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { schools } from '@/db/schema';
import { db } from '@/lib/drizzle';
import { requireSuperAdminPage } from '@/lib/super-admin-guard';

export const metadata: Metadata = {
  title: 'Billing',
};

export const dynamic = 'force-dynamic';

/**
 * `/super-admin/billing` — every platform invoice. Sprint 35, §5.
 *
 * The school filter's options are read here, once; the invoices themselves are
 * fetched by the listing as the filters change, with its own pending state.
 */
export default async function BillingPage() {
  await requireSuperAdminPage('billing');

  const schoolOptions = await db
    .select({ id: schools.id, name: schools.name })
    .from(schools)
    .orderBy(asc(schools.name));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="Invoices raised on the 1st for the month before. A school is blocked when a finalized invoice is still unpaid after its grace period."
        actions={
          <Link href="/super-admin/billing/bank-accounts">
            <Button variant="secondary">Bank accounts</Button>
          </Link>
        }
      />

      <InvoiceListing schools={schoolOptions} />
    </div>
  );
}
