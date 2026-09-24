import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { InvoiceDetailPanel } from '@/components/super-admin/InvoiceDetailPanel';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  getPlatformInvoiceDetail,
  listPlatformBankAccounts,
} from '@/lib/platform-billing-queries';
import { requireSuperAdminPage } from '@/lib/super-admin-guard';
import { superAdminCan } from '@/lib/super-admin-permissions';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Invoice',
};

export const dynamic = 'force-dynamic';

/** `/super-admin/billing/invoices/[invoiceId]` — one invoice. Sprint 35, §5. */
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const actor = await requireSuperAdminPage('billing');

  const { invoiceId } = await params;
  if (!isUuid(invoiceId)) notFound();

  const [invoice, bankAccounts] = await Promise.all([
    getPlatformInvoiceDetail(invoiceId),
    listPlatformBankAccounts(),
  ]);
  if (invoice === null) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={invoice.invoiceNumber}
        description={invoice.school.name}
        breadcrumbs={[
          { label: 'Billing', href: '/super-admin/billing' },
          { label: invoice.invoiceNumber },
        ]}
      />

      <InvoiceDetailPanel
        initial={invoice}
        bankAccounts={bankAccounts}
        canEdit={superAdminCan(actor, 'billing', 'u')}
        canRecord={superAdminCan(actor, 'billing', 'c')}
      />
    </div>
  );
}
