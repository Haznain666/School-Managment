import type { Metadata } from 'next';

import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
import { FeeTypeManager } from '@/components/fees/FeeTypeManager';
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
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Fee types</h2>
        <p className="mt-1 text-sm text-slate-500">
          The heads your school bills under. A head&rsquo;s category decides when
          it is charged — only monthly heads appear on a monthly challan.
        </p>
      </div>

      <FeeSetupNav />

      <FeeTypeManager canEdit={permissions.includes('fees.write')} />
    </div>
  );
}
