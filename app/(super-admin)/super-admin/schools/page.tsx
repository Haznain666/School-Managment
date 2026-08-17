import type { Metadata } from 'next';
import Link from 'next/link';

import { SchoolTable } from '@/components/super-admin/SchoolTable';
import { SubdomainProvisioningNotice } from '@/components/super-admin/SubdomainProvisioningNotice';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = {
  title: 'Schools',
};

export const dynamic = 'force-dynamic';

export default function SchoolsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Schools"
        description="Every tenant on the platform. GoHighLevel is optional and is connected per school on its Integrations tab."
        actions={
          <Link href="/super-admin/schools/new">
            <Button>Add School</Button>
          </Link>
        }
      />

      {/*
        Above the table on purpose. Whether a new school will be reachable is
        the thing to know *before* pressing "Add School", not after discovering
        that the URL it hands you does not resolve.
      */}
      <SubdomainProvisioningNotice />

      <SchoolTable />
    </div>
  );
}
