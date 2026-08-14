import { and, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { branches, schools } from '@/db/schema';
import { BranchForm } from '@/components/super-admin/BranchForm';
import { db } from '@/lib/drizzle';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Edit branch',
};

export const dynamic = 'force-dynamic';

export default async function EditBranchPage({
  params,
}: {
  params: Promise<{ schoolId: string; branchId: string }>;
}) {
  const { schoolId, branchId } = await params;
  if (!isUuid(schoolId) || !isUuid(branchId)) notFound();

  // Join through `schools` so a branch belonging to a different tenant cannot
  // be opened through this school's URL.
  const rows = await db
    .select({ branch: branches })
    .from(branches)
    .innerJoin(schools, eq(schools.locationId, branches.locationId))
    .where(and(eq(branches.id, branchId), eq(schools.id, schoolId)))
    .limit(1);

  const branch = rows[0]?.branch;
  if (branch === undefined) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <h3 className="text-lg font-semibold text-ink">Edit branch</h3>

      <BranchForm
        schoolId={schoolId}
        initial={{
          id: branch.id,
          name: branch.name,
          code: branch.code,
          city: branch.city,
          address: branch.address ?? '',
          phone: branch.phone ?? '',
          email: branch.email ?? '',
          curriculumLevel: branch.curriculumLevel,
          maxGrade: branch.maxGrade ?? '',
          isMainBranch: branch.isMainBranch,
          isActive: branch.isActive,
        }}
      />
    </div>
  );
}
