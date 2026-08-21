import type { Metadata } from 'next';

import { ExpenseCategories } from '@/components/accounting/ExpenseCategories';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Expense categories',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ExpenseCategoriesPage() {
  const { permissions } = await requireSchoolPermission('accounting.write');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expense categories"
        description="What a bill can be filed under. Each one posts to a head on the chart of accounts."
        breadcrumbs={[
          { label: 'Accounting', href: '/dashboard/accounting' },
          { label: 'Expense categories' },
        ]}
      />
      <ExpenseCategories canEdit={permissions.includes('accounting.write')} />
    </div>
  );
}
