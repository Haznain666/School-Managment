import type { Metadata } from 'next';

import { SchoolForm } from '@/components/super-admin/SchoolForm';
import { publicEnv } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Add school',
};

export const dynamic = 'force-dynamic';

export default function NewSchoolPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Add school</h2>
        <p className="mt-1 text-sm text-slate-500">
          Provisions a new tenant. The GHL Location ID cannot be changed
          afterwards — every record this school creates is filed under it.
        </p>
      </div>

      <SchoolForm appDomain={publicEnv.appDomain} />
    </div>
  );
}
