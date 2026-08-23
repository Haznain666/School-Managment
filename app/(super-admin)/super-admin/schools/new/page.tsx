import type { Metadata } from 'next';

import { SchoolWizard } from '@/components/super-admin/SchoolWizard';
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
        description="Five steps. The first creates the school and the rest run against it, so a setup left half-finished still leaves a school that works — the remaining steps are its own tabs."
      />

      <SchoolWizard appDomain={publicEnv.appDomain} />
    </div>
  );
}
