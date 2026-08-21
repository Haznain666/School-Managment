import type { Metadata } from 'next';

import { DayBook } from '@/components/accounting/DayBook';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Day book',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function DayBookPage() {
  const { permissions } = await requireSchoolPermission('accounting.read');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Day book"
        description="Every entry in the books, both sides of each, and the reversal where there was one."
        breadcrumbs={[
          { label: 'Accounting', href: '/dashboard/accounting' },
          { label: 'Day book' },
        ]}
      />
      <DayBook canWrite={permissions.includes('accounting.write')} />
    </div>
  );
}
