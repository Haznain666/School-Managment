import type { Metadata } from 'next';
import Link from 'next/link';

import { EmailInvitePanel } from '@/components/school/EmailInvitePanel';
import { PendingInvitesTable } from '@/components/school/PendingInvitesTable';
import { UserTable } from '@/components/school/UserTable';
import { Button } from '@/components/ui/Button';
import { requireSchoolPermission } from '@/lib/school-guard';
import { listBranchOptions } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Users & Staff',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function UsersPage() {
  const { claims, locationId, permissions } =
    await requireSchoolPermission('users.read');

  const branches = await listBranchOptions(locationId);
  const canInvite = permissions.includes('users.write');

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
            <Button variant="secondary">Invite by WhatsApp</Button>
          </Link>
        ) : null}
      </div>

      {canInvite ? <EmailInvitePanel branches={branches} /> : null}

      <UserTable branches={branches} lockedBranchId={claims.branchId} />

      {/*
        The WhatsApp invitation list. Kept alongside the email one rather than
        replaced: invitations sent before the switch are still outstanding, and
        their accept flow is untouched.
      */}
      {canInvite ? <PendingInvitesTable /> : null}
    </div>
  );
}
