import type { Metadata } from 'next';

import { HandoffClient } from '@/app/(public)/handoff/[token]/HandoffClient';
import { BrandedLoginLayout } from '@/components/school/BrandedLoginLayout';
import { getSchoolHeaders } from '@/lib/school-tenant';

export const metadata: Metadata = {
  title: 'Signing in',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Where the apex sign-in lands on a school's own address — Sprint 35, §7.4.
 *
 * A server component for the same reason the operator's `/platform-login` is:
 * the school's name, logo and colours come from the tenant this host resolves
 * to, so the person sees which school they are entering before the portal
 * opens. The redemption itself is the client child's job.
 */
export default async function HandoffPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { slug } = await getSchoolHeaders();

  return (
    <BrandedLoginLayout subtitle="Signing you in">
      <HandoffClient token={token} schoolSlug={slug} />
    </BrandedLoginLayout>
  );
}
