import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Suspense } from 'react';

import { EmailLoginForm } from '@/components/school/EmailLoginForm';
import { BrandedLoginLayout } from '@/components/school/BrandedLoginLayout';
import { QueryNotice } from '@/components/school/QueryNotice';
import { readSchoolSession } from '@/lib/school-auth';
import { getSchoolBranding, getSchoolHeaders } from '@/lib/school-tenant';
import { ROLE_HOME_ROUTES } from '@/types/school-auth';

/* WHATSAPP_DISABLED_START */
// WhatsApp auth temporarily disabled - re-enable when Meta template approved
//
// import { LoginOTPForm } from '@/components/school/LoginOTPForm';
/* WHATSAPP_DISABLED_END */

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
      {/* `useSearchParams` opts its subtree into client rendering; the Suspense
          boundary keeps that from deopting the whole page. */}
      <Suspense fallback={null}>
        <QueryNotice
          param="reset"
          message="Your password has been updated. Sign in with your new password."
        />
      </Suspense>

      <EmailLoginForm
        schoolName={school?.name ?? 'your school'}
        locationId={locationId}
        schoolSlug={slug}
      />

      <p className="mt-6 text-center text-xs text-slate-400">
        Use the email address your school invited you on. Trouble signing in?
        Contact your school administrator.
      </p>

      {/* WHATSAPP_DISABLED_START */}
      {/*
        WhatsApp auth temporarily disabled - re-enable when Meta template approved

        <LoginOTPForm schoolName={school?.name ?? 'your school'} schoolSlug={slug} />
        <p className="mt-6 text-center text-xs text-slate-400">
          A one-time code is sent to your registered WhatsApp number. No password
          needed. Trouble signing in? Contact your school administrator.
        </p>
      */}
      {/* WHATSAPP_DISABLED_END */}
    </BrandedLoginLayout>
  );
}
