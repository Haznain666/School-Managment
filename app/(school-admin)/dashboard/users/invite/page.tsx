import type { Metadata } from 'next';

import { EmailInvitePageClient } from '@/components/school/EmailInvitePageClient';
import { requireSchoolPermission } from '@/lib/school-guard';
import { listBranchOptions } from '@/lib/school-queries';

/* WHATSAPP_DISABLED_START */
// WhatsApp auth temporarily disabled - re-enable when Meta template approved
//
// import { InviteForm } from '@/components/school/InviteForm';
/* WHATSAPP_DISABLED_END */

export const metadata: Metadata = {
  title: 'Invite a user',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Invite a colleague by email address.
 *
 * This route used to render `InviteForm`, which asked for a phone number and
 * posted to `/api/school/invitations` to send the offer over WhatsApp. That
 * component is intact and simply no longer rendered; this page posts to
 * `/api/school/users/invite`, which sends the invitation through the school's
 * own GHL sub-account and therefore its own LC Email domain.
 */
export default async function InviteUserPage() {
  const { locationId } = await requireSchoolPermission('users.write');
  const branches = await listBranchOptions(locationId);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Invite a user</h2>
        <p className="mt-1 text-sm text-slate-500">
          They receive an email from your school with a verification link and a
          six-digit code, then choose their own password. The invitation is valid for
          72 hours.
        </p>
      </div>

      <EmailInvitePageClient branches={branches} />

      {/* WHATSAPP_DISABLED_START */}
      {/*
        WhatsApp auth temporarily disabled - re-enable when Meta template approved

        <div>
          <h2 className="text-xl font-semibold text-slate-900">Invite staff</h2>
          <p className="mt-1 text-sm text-slate-500">
            The invitation goes out over WhatsApp, with email as a fallback. The
            link is valid for 72 hours.
          </p>
        </div>

        <InviteForm branches={branches} />
      */}
      {/* WHATSAPP_DISABLED_END */}
    </div>
  );
}
