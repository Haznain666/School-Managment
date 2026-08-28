import type { Metadata } from 'next';

import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
import { FeeTypeManager } from '@/components/fees/FeeTypeManager';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSchoolPermission } from '@/lib/school-guard';

export const metadata: Metadata = {
  title: 'Fee types',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FeeTypesPage() {
  const { permissions } = await requireSchoolPermission('fees.read');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fee types"
        description="The heads your school bills under. A head&rsquo;s category decides when it is charged — only monthly heads appear on a monthly voucher."
      />

      <FeeSetupNav />

      <FeeTypeManager canEdit={permissions.includes('fees.write')} />
    </div>
  );
}
