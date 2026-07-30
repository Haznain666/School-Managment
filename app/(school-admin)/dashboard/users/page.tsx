import type { Metadata } from 'next';
import Link from 'next/link';

import { PendingInvitesTable } from '@/components/school/PendingInvitesTable';
import { UserTable } from '@/components/school/UserTable';
import { Button } from '@/components/ui/Button';
import { requireSchoolRole } from '@/lib/school-guard';
import { listBranchOptions } from '@/lib/school-queries';
import { USER_MANAGEMENT_ROLES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Users & Staff',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function UsersPage() {
  const { claims, locationId } = await requireSchoolRole([
    'school_admin',
    'branch_admin',
    'hr_manager',
  ]);

  const branches = await listBranchOptions(locationId);
  const canInvite = USER_MANAGEMENT_ROLES.includes(claims.role);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {claims.role === 'branch_admin' ? 'My Branch Staff' : 'Users & Staff'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {claims.role === 'branch_admin'
              ? 'Everyone assigned to your branch.'
              : 'Everyone with access to this school’s portals.'}
          </p>
        </div>

        {canInvite ? (
          <Link href="/dashboard/users/invite">
            <Button>Invite Staff</Button>
          </Link>
        ) : null}
      </div>

      <UserTable branches={branches} lockedBranchId={claims.branchId} />

      {canInvite ? <PendingInvitesTable /> : null}
    </div>
  );
}
