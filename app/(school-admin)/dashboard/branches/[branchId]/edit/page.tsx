import { and, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BranchForm } from '@/components/super-admin/BranchForm';
import { PageHeader } from '@/components/ui/PageHeader';
import { branches } from '@/db/schema';
import { db } from '@/lib/drizzle';
import { requireSchoolPermission } from '@/lib/school-guard';
import { isUuid } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Edit branch',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Editing a campus from inside the school — Sprint 19a, item 8.
 *
 * The form is the same component the Super Admin panel and the wizard render,
 * given no `schoolId`. That absence switches it to `/api/school/branches` and
 * drops the Active toggle, which stays an operator's control for the reason
 * `components/super-admin/BranchForm.tsx` gives: inside the portal an inactive
 * campus is invisible everywhere, so a school administrator who switched it off
 * would have hidden a campus with no screen left that shows it again.
 *
 * The two "who runs this campus" toggles are hidden on edit and ignored by the
 * route regardless. Editing a campus must not silently mint a member, nor
 * re-grant a scope somebody deliberately revoked; both are done from Users &
 * Staff and from the principal card on the campus page.
 */
export default async function EditSchoolBranchPage({
  params,
}: {
  params: Promise<{ branchId: string }>;
}) {
  const { branchId } = await params;
  if (!isUuid(branchId)) notFound();

  // `branches.manage`, not `settings.write`. Creating a campus and editing an
  // existing one are different decisions: the second changes the boundary every
  // other listing in the product is drawn inside.
  const { locationId } = await requireSchoolPermission('branches.manage');

  const rows = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.locationId, locationId)))
    .limit(1);

  const branch = rows[0];
  if (branch === undefined) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={`Edit ${branch.name}`}
        description="Changing a campus renames it everywhere it appears — on vouchers, on payslips and in every campus filter."
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Branches', href: '/dashboard/branches' },
          { label: branch.name, href: `/dashboard/branches/${branch.id}` },
          { label: 'Edit' },
        ]}
      />

      <BranchForm
        initial={{
          id: branch.id,
          name: branch.name,
          code: branch.code,
          city: branch.city,
          address: branch.address ?? '',
          latitude: branch.latitude,
          longitude: branch.longitude,
          landline: branch.landline ?? '',
          phone: branch.phone ?? '',
          email: branch.email ?? '',
          curriculumLevel: branch.curriculumLevel,
          boardName: branch.boardName ?? '',
          classLevels: branch.classLevels,
          isMainBranch: branch.isMainBranch,
          isActive: branch.isActive,
          // Hidden on edit by the form itself; present because the value type
          // requires them. See the docblock.
          branchAdmin: { mode: 'none', fullName: '', phone: '', email: '' },
          branchPrincipal: { mode: 'none', fullName: '', phone: '', email: '' },
        }}
        doneUrl={`/dashboard/branches/${branch.id}`}
      />
    </div>
  );
}
