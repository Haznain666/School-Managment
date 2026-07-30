import type { Metadata } from 'next';
import Link from 'next/link';

import { SchoolTable } from '@/components/super-admin/SchoolTable';
import { Button } from '@/components/ui/Button';

export const metadata: Metadata = {
  title: 'Schools',
};

export const dynamic = 'force-dynamic';

export default function SchoolsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Schools</h2>
          <p className="mt-1 text-sm text-slate-500">
            Every tenant on the platform, keyed by GHL Location ID.
          </p>
        </div>

        <Link href="/super-admin/schools/new">
          <Button>Add School</Button>
        </Link>
      </div>

      <SchoolTable />
    </div>
  );
}
