import type { Metadata } from 'next';

import { PlatformBankAccountsManager } from '@/components/super-admin/PlatformBankAccountsManager';
import { PageHeader } from '@/components/ui/PageHeader';
import { listPlatformBankAccounts } from '@/lib/platform-billing-queries';
import { requireSuperAdminPage } from '@/lib/super-admin-guard';
import { superAdminCan } from '@/lib/super-admin-permissions';

export const metadata: Metadata = {
  title: 'Bank accounts',
};

export const dynamic = 'force-dynamic';

/** `/super-admin/billing/bank-accounts` — where schools pay. Sprint 35, §5. */
export default async function PlatformBankAccountsPage() {
  const actor = await requireSuperAdminPage('billing');
  const accounts = await listPlatformBankAccounts();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank accounts"
        description="Up to three Pakistani accounts, printed on every invoice, its PDF and a blocked school's suspended page."
        breadcrumbs={[{ label: 'Billing', href: '/super-admin/billing' }, { label: 'Bank accounts' }]}
      />

      <PlatformBankAccountsManager
        initial={accounts}
        canCreate={superAdminCan(actor, 'billing', 'c')}
        canEdit={superAdminCan(actor, 'billing', 'u')}
        canDelete={superAdminCan(actor, 'billing', 'd')}
      />
    </div>
  );
}
