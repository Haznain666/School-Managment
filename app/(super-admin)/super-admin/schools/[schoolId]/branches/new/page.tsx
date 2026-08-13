import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BranchForm } from '@/components/super-admin/BranchForm';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Add branch',
};

export const dynamic = 'force-dynamic';

export default async function NewBranchPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  if (!isUuid(schoolId)) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <h3 className="text-lg font-semibold text-ink">Add branch</h3>
      <BranchForm schoolId={schoolId} />
    </div>
  );
}
