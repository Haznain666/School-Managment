import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ModuleToggleGrid } from '@/components/super-admin/ModuleToggleGrid';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Modules',
};

export const dynamic = 'force-dynamic';

export default async function SchoolModulesPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  if (!isUuid(schoolId)) notFound();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Modules</h3>
        <p className="mt-1 text-sm text-slate-500">
          Switch functionality on per school. A disabled module is hidden from
          the portal navigation and refused at the API.
        </p>
      </div>

      <ModuleToggleGrid schoolId={schoolId} />
    </div>
  );
}
