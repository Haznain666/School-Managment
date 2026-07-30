import type { Metadata } from 'next';

import { EmergencyLoginClient } from '@/app/(public)/emergency-login/[token]/EmergencyLoginClient';
import { BrandedLoginLayout } from '@/components/school/BrandedLoginLayout';
import { getSchoolHeaders } from '@/lib/school-tenant';

export const metadata: Metadata = {
  title: 'Emergency access',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Emergency sign-in.
 *
 * A server component so the school's logo and palette come from the resolved
 * tenant directly. Branding cannot be fetched client-side here: the only
 * endpoint that exposes it, `/api/school/settings`, requires a session, and
 * whoever opens this link does not yet have one.
 *
 * The redemption itself needs browser APIs (Firebase sign-in), so it lives in
 * the client child.
 */
export default async function EmergencyLoginPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { slug } = await getSchoolHeaders();

  return (
    <BrandedLoginLayout subtitle="Emergency access">
      <EmergencyLoginClient token={token} schoolSlug={slug} />
      <p className="mt-6 text-center text-xs text-slate-400">
        This link works once and expires 15 minutes after it was issued.
      </p>
    </BrandedLoginLayout>
  );
}
