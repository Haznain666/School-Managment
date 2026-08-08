import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { BrandedLoginLayout } from '@/components/school/BrandedLoginLayout';
import { SetupPasswordForm } from '@/components/school/SetupPasswordForm';
import { getSchoolBranding, getSchoolHeaders } from '@/lib/school-tenant';

export const metadata: Metadata = {
  title: 'Choose your password',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * First-time password setup, reached from the link in the welcome email.
 *
 * ── Nothing is validated here, on purpose ────────────────────────────────
 * This page does not check the token, and does not tell the visitor whether it
 * is any good. Two reasons, and the second is the important one:
 *
 *   1. Mail clients and security scanners follow links in messages. A page
 *      that redeemed on load would have the token spent before the recipient
 *      ever clicked, and they would meet "expired" for a link just sent.
 *   2. A page that said "this link is valid" to anyone holding it would
 *      confirm that a given token — and by extension a given member — exists.
 *
 * The token travels with the password to `/api/school/auth/setup`, which is
 * the only place it means anything. An unusable link produces one message,
 * after a submission, and the same message for every kind of unusable.
 *
 * The session is deliberately *not* checked either: someone already signed in
 * on this browser may still be setting a password for a different person from
 * a forwarded link, and bouncing them to a portal would be wrong.
 */
export default async function SetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { locationId } = await getSchoolHeaders();

  if (locationId === null || locationId === '') {
    redirect('/school-not-found');
  }

  const school = await getSchoolBranding(locationId);

  return (
    <BrandedLoginLayout subtitle="Choose a password to finish setting up your account">
      <SetupPasswordForm token={token} schoolName={school?.name ?? 'your school'} />
    </BrandedLoginLayout>
  );
}
