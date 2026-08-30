import type { Metadata } from 'next';

import { BankAccountsTable } from '@/components/school/BankAccountsTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Bank accounts',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The school's bank accounts — Sprint 20, item 10.
 *
 * ── Why this lives under Settings and not under Fees (decision D2) ───────
 * It is school-wide reference data read by **two** modules and owned by
 * neither: Fees prints the student-facing accounts on every voucher, Payroll
 * pays salaries out of the staff-facing ones. Filing it under Fees would put
 * the payroll bank under Fees, which is where nobody would look for it. Settings
 * is already where the school profile and branding live and is gated on the
 * same permission pair, so this needs **no new permission key** — and therefore
 * no widening of the `role_permissions` CHECK, which is the trap STATE.md §5o
 * records.
 */
export default async function BankAccountsPage() {
  const { permissions } = await requireSchoolPermission('settings.read');

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Settings', href: '/dashboard/settings' },
          { label: 'Bank accounts' },
        ]}
        title="Bank accounts"
        description="Where fees are paid in and salaries are paid out. Every active student-facing account prints on your fee vouchers, in the print order you set here."
      />

      <BankAccountsTable canEdit={permissions.includes('settings.write')} />
    </div>
  );
}
