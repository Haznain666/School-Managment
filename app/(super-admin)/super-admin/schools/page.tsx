import type { Metadata } from 'next';
import Link from 'next/link';

import { SchoolTable } from '@/components/super-admin/SchoolTable';
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

      <SchoolTable />
    </div>
  );
}
