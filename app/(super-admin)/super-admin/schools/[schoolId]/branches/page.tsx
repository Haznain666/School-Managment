import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BranchList } from '@/components/super-admin/BranchList';
import { Button } from '@/components/ui/Button';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Branches',
};

export const dynamic = 'force-dynamic';

export default async function SchoolBranchesPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  if (!isUuid(schoolId)) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Branches</h3>
          <p className="mt-1 text-sm text-slate-500">
            Campuses belonging to this school. Each carries its own curriculum
            level.
          </p>
        </div>

        <Link href={`/super-admin/schools/${schoolId}/branches/new`}>
          <Button>Add Branch</Button>
        </Link>
      </div>

      <BranchList schoolId={schoolId} />
    </div>
  );
}
