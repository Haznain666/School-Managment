import type { Metadata } from 'next';

import { ChartOfAccounts } from '@/components/accounting/ChartOfAccounts';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Chart of accounts',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The chart of accounts.
 *
 * The page is a shell: it resolves the caller's permission and hands one
 * boolean to a client component that does the reading and writing over the
 * API. The alternative — server-rendering the list and posting back — would
 * mean a full round trip and a ~1s blank for every rename, which is what this
 * screen is mostly used for.
 */
export default async function ChartOfAccountsPage() {
  const { permissions } = await requireSchoolPermission('accounting.read');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chart of accounts"
        description="The heads this school posts to. Every entry in the books lands in one of them."
        breadcrumbs={[
          { label: 'Accounting', href: '/dashboard/accounting' },
          { label: 'Chart of accounts' },
        ]}
      />
      <ChartOfAccounts canEdit={permissions.includes('accounting.write')} />
    </div>
  );
}
