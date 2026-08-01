import type { Metadata } from 'next';

import { PlatformLoginClient } from '@/app/(public)/platform-login/[token]/PlatformLoginClient';
import { BrandedLoginLayout } from '@/components/school/BrandedLoginLayout';
import { getSchoolHeaders } from '@/lib/school-tenant';

export const metadata: Metadata = {
  title: 'Platform sign in',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The landing point of a Super Admin hand-off.
 *
 * A server component so the school's own logo and palette are resolved from the
 * tenant directly — the operator should be able to see at a glance which
 * customer they are about to enter. Branding cannot be fetched client-side
 * here: the only endpoint exposing it requires a session, and nobody arriving
 * on this page has one yet.
 *
 * The redemption itself needs browser APIs (Firebase sign-in), so it lives in
 * the client child.
 */
export default async function PlatformLoginPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { slug } = await getSchoolHeaders();

  return (
    <BrandedLoginLayout subtitle="Platform administrator access">
      <PlatformLoginClient token={token} schoolSlug={slug} />
      <p className="mt-6 text-center text-xs text-slate-400">
        You are entering this school as the platform Super Admin. School staff
        sign in with their mobile number instead.
      </p>
    </BrandedLoginLayout>
  );
}
