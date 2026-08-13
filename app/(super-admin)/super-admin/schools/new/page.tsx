import type { Metadata } from 'next';

import { SchoolForm } from '@/components/super-admin/SchoolForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { publicEnv } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Add school',
};

export const dynamic = 'force-dynamic';

export default function NewSchoolPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Add school"
        description="Provisions a new tenant. The GHL Location ID cannot be changed afterwards — every record this school creates is filed under it."
      />

      <SchoolForm appDomain={publicEnv.appDomain} />
    </div>
  );
}
