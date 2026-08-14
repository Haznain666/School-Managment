import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';

import { InviteOTPForm } from '@/components/school/InviteOTPForm';
import { branches, schoolBranding, schoolInvitations, schools, selectedPaletteOf } from '@/db/schema';
import { Card } from '@/components/ui/Card';
import { paletteToCSSVars } from '@/lib/branding';
import { maskEmail } from '@/lib/email-sender';
import { db } from '@/lib/drizzle';
import { ROLE_LABELS, isUserRole } from '@/types/school-auth';
import type { CSSProperties } from 'react';

export const metadata: Metadata = {
  title: 'Accept your invitation',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Invitation acceptance.
 *
 * No session and no school subdomain are required to reach this page: the
 * token in the URL is the credential, and it carries its own tenant. That is
 * why it is 32 random bytes, single-use, and expires in 72 hours.
 */

function InviteMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-sm text-ink-muted">{body}</p>
      </Card>
    </main>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const rows = await db
    .select({
      invitation: schoolInvitations,
      schoolName: schools.name,
      schoolSlug: schools.slug,
      schoolLogo: schools.logoUrl,
      branchName: branches.name,
    })
    .from(schoolInvitations)
    .innerJoin(schools, eq(schools.locationId, schoolInvitations.locationId))
    .leftJoin(branches, eq(branches.id, schoolInvitations.branchId))
    .where(eq(schoolInvitations.token, token))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    return (
      <InviteMessage
        title="Invalid or expired invite link"
        body="This link does not match any invitation. Ask your school administrator to send a new one."
      />
    );
  }

  const { invitation } = row;

  if (invitation.acceptedAt !== null) {
    return (
      <InviteMessage
        title="This invite was already used"
        body="Your account is already set up. Try logging in instead."
      />
    );
  }

  if (invitation.expiresAt.getTime() < Date.now()) {
    return (
      <InviteMessage
        title="This invite has expired"
        body="Invitations are valid for 72 hours. Ask your admin to resend it."
      />
    );
  }

  if (!isUserRole(invitation.role)) {
    return (
      <InviteMessage
        title="This invite is no longer valid"
        body="The role on this invitation no longer exists. Ask your admin to send a new one."
      />
    );
  }

  // The code goes to the address on the invitation, and the account is created
  // against it, so a missing one has to be caught here rather than failing
  // mid-signup. Invitations created since Stage 4 always carry one; older rows
  // and rows written before that rule may not.
  if (invitation.email === null || invitation.email.trim() === '') {
    return (
      <InviteMessage
        title="This invite cannot be completed"
        body="This invitation has no email address, and your account is created against one. Ask your admin to resend it."
      />
    );
  }

  const brandingRows = await db
    .select()
    .from(schoolBranding)
    .where(eq(schoolBranding.locationId, invitation.locationId))
    .limit(1);

  const branding = brandingRows[0];
  const logoUrl = branding?.logoUrl ?? row.schoolLogo;
  const brandStyle = paletteToCSSVars(
    branding === undefined ? null : selectedPaletteOf(branding),
  ) as unknown as CSSProperties;

  return (
    <main
      style={brandStyle}
      className="flex min-h-screen items-center justify-center bg-surface-sunken px-4 py-12"
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          {logoUrl !== null && logoUrl !== '' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={`${row.schoolName} logo`}
              className="mb-4 h-16 w-16 rounded-xl object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-brand-primary text-xl font-bold text-brand-onPrimary"
            >
              {row.schoolName.slice(0, 2).toUpperCase()}
            </span>
          )}

          <h1 className="text-2xl font-bold text-ink">{row.schoolName}</h1>
        </div>

        <InviteOTPForm
          token={token}
          inviteeName={invitation.name}
          maskedEmail={maskEmail(invitation.email ?? '')}
          schoolName={row.schoolName}
          roleName={ROLE_LABELS[invitation.role]}
          branchName={row.branchName}
          schoolSlug={row.schoolSlug}
        />
      </div>
    </main>
  );
}
