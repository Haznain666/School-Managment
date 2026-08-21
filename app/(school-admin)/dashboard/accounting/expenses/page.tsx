import type { Metadata } from 'next';

import { ExpenseRegister } from '@/components/accounting/ExpenseRegister';
import { PageHeader } from '@/components/ui/PageHeader';
import { isExpenseStatus } from '@/lib/accounting';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Expenses',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The expense register.
 *
 * `searchParams` is read here rather than in the client component, which makes
 * this route dynamic — but the page is already dynamic because it is behind a
 * permission guard that reads a session, so there is no prerender to lose.
 * That is the test `CLAUDE.md` asks for: the rule is not "never read
 * searchParams", it is "do not make a *static* page dynamic by accident".
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { permissions } = await requireSchoolPermission('accounting.read');
  const search = await searchParams;
  const status = typeof search.status === 'string' ? search.status : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="What the school has spent, and what it has been asked to spend. Approving is what moves the money."
        breadcrumbs={[
          { label: 'Accounting', href: '/dashboard/accounting' },
          { label: 'Expenses' },
        ]}
      />
      <ExpenseRegister
        canWrite={permissions.includes('accounting.write')}
        initialStatus={isExpenseStatus(status) ? status : null}
      />
    </div>
  );
}
