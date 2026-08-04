import type { Metadata } from 'next';
import Link from 'next/link';

import { EmailInvitePanel } from '@/components/school/EmailInvitePanel';
import { UserTable } from '@/components/school/UserTable';
import { Button } from '@/components/ui/Button';
import { requireSchoolPermission } from '@/lib/school-guard';
import { listBranchOptions } from '@/lib/school-queries';

/* WHATSAPP_DISABLED_START */
// WhatsApp auth temporarily disabled - re-enable when Meta template approved
//
// import { PendingInvitesTable } from '@/components/school/PendingInvitesTable';
/* WHATSAPP_DISABLED_END */

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

        {/* One way to invite someone. The full-page form and the modal below
            render the same component and post to the same endpoint. */}
        {canInvite ? (
          <Link href="/dashboard/users/invite">
            <Button>Invite User</Button>
          </Link>
        ) : null}
      </div>

      {canInvite ? <EmailInvitePanel branches={branches} /> : null}

      <UserTable branches={branches} lockedBranchId={claims.branchId} />

      {/* WHATSAPP_DISABLED_START */}
      {/*
        WhatsApp auth temporarily disabled - re-enable when Meta template approved

        The pending-WhatsApp-invitation list, with its resend and cancel
        controls. Hidden because resending would send a WhatsApp message, and
        POST /api/school/invitations is disabled. Invitations sent before the
        switch can still be accepted — /invite/[token] is untouched — they just
        cannot be created or resent from here.

        {canInvite ? <PendingInvitesTable /> : null}
      */}
      {/* WHATSAPP_DISABLED_END */}
    </div>
  );
}
