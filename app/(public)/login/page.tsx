import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { EmailLoginForm } from '@/components/school/EmailLoginForm';
import { BrandedLoginLayout } from '@/components/school/BrandedLoginLayout';
import { readSchoolSession } from '@/lib/school-auth';
import { getSchoolBranding, getSchoolHeaders } from '@/lib/school-tenant';
import { ROLE_HOME_ROUTES } from '@/types/school-auth';

export const metadata: Metadata = {
  title: 'Sign in',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * School sign-in.
 *
 * The school is decided by the subdomain (or `?school=` in development), never
 * by anything typed here — so the branding shown and the tenant the
 * credentials are checked against are always the same school.
 */
export default async function LoginPage() {
  const { locationId, slug } = await getSchoolHeaders();

  // Middleware rewrites to /school-not-found when the host resolves to nothing,
  // so reaching here without a tenant means something upstream changed.
  if (locationId === null || locationId === '') {
    redirect('/school-not-found');
  }

  // Already signed in — go straight to the right portal.
  const existing = await readSchoolSession();
  if (existing !== null && existing.locationId === locationId) {
    redirect(ROLE_HOME_ROUTES[existing.role]);
  }

  const school = await getSchoolBranding(locationId);

  return (
    <BrandedLoginLayout subtitle="Sign in with your email address">
      <EmailLoginForm schoolName={school?.name ?? 'your school'} schoolSlug={slug} />
      <p className="mt-6 text-center text-xs text-ink-muted">
        Not been invited yet? Your school administrator sends the invitation.
      </p>
    </BrandedLoginLayout>
  );
}
