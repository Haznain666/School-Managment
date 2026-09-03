import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { InviteForm } from '@/components/school/InviteForm';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { visibleScopeFor } from '@/lib/principal-visibility';
import { requireSchoolPermission } from '@/lib/school-guard';
import { listBranchOptions } from '@/lib/school-queries';

export const metadata: Metadata = {
  title: 'Invite staff',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Invite one member of staff.
 *
 * ── Why this page can send you somewhere else first ──────────────────────
 * Every role worth inviting from here — teacher, accountant, HR, branch
 * administrator — must be assigned to a branch, and a school that has never
 * created one had no way to make that true. The form rendered, the Branch
 * select was empty, and the only feedback was the validation message "this role
 * must be assigned to a branch" against a dropdown holding nothing to choose.
 * The screen asked for something it had not let you create.
 *
 * So a school with no branches is sent to create one, and brought straight back
 * here afterwards. Nobody is invited on that detour: the branch form has no
 * invite field inside the portal (see `app/api/school/branches/route.ts`),
 * because the invitation is what this page is for and doing it twice is how one
 * person becomes two.
 *
 * Somebody who cannot create a branch is not redirected into a screen that
 * would bounce them — they are told what is missing and who can supply it.
 */
export default async function InviteStaffPage() {
  const { claims, locationId, permissions } = await requireSchoolPermission('users.write');

  /*
   * BR4 — Sprint 23, item 3. The campus picker offers a head their own.
   *
   * The *campus* half of the scope, because a `school_users` row carries a
   * branch and no grade — the same reasoning `ListStaffFilters.scopeBranchIds`
   * spells out for the staff directory. A head assigned a division but no
   * campus is offered every campus, which is what they had before.
   *
   * Visibility, not authorisation: `POST /api/school/invitations` still obeys a
   * branch id posted from outside the list. That is the recorded decision.
   */
  const [allBranches, visible] = await Promise.all([
    listBranchOptions(locationId),
    visibleScopeFor({ locationId, role: claims.role, uid: claims.uid }),
  ]);

  const branches =
    visible.branchIds === null
      ? allBranches
      : allBranches.filter((branch) => visible.branchIds?.includes(branch.id) ?? false);

  if (branches.length === 0 && permissions.includes('settings.write')) {
    redirect('/dashboard/branches/new?next=/dashboard/users/invite');
  }

  if (branches.length === 0) {
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader title="Invite staff" />

        <Card>
          <EmptyState
            title="This school has no branches yet"
            description="Staff are assigned to a campus, so a branch has to exist before anyone can be invited. Ask a school administrator to add one."
            action={
              <Link href="/dashboard/users">
                <Button variant="secondary">Back to users</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  /*
   * The description has to match what actually happens, and now there is only
   * one thing that can happen. It once read "goes out over WhatsApp, with
   * email as a fallback", then became a per-school conditional; the channel it
   * was conditional on no longer exists, so neither does the conditional.
   */
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Invite staff"
        description="The invitation goes out by email. The link is valid for 72 hours."
      />

      {/*
        One screen, two permission keys. Somebody holding only `users.write`
        sees no employment section at all rather than a disabled one, and the
        route refuses the field for them in any case.
      */}
      <InviteForm branches={branches} canAddEmployment={permissions.includes('hr.write')} />
    </div>
  );
}
