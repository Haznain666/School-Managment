import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { BrandedLoginLayout } from '@/components/school/BrandedLoginLayout';
import { getSchoolBranding, getSchoolHeaders } from '@/lib/school-tenant';

import { ForgotPasswordClient } from './ForgotPasswordClient';

export const metadata: Metadata = {
  title: 'Reset your password',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Password reset.
 *
 * Public by necessity — anyone reaching it has lost the credential that would
 * otherwise let them in. The school still comes from the hostname rather than
 * from anything typed here, so a reset always acts on the school whose branding
 * is on the page.
 *
 * No session check: somebody with a live session who has forgotten their
 * password is exactly who this page is for.
 */
export default async function ForgotPasswordPage() {
  const { locationId, slug } = await getSchoolHeaders();

  if (locationId === null || locationId === '') {
    redirect('/school-not-found');
  }

  const school = await getSchoolBranding(locationId);

  return (
    <BrandedLoginLayout subtitle="Reset your password">
      <ForgotPasswordClient
        schoolName={school?.name ?? 'your school'}
        locationId={locationId}
        schoolSlug={slug}
      />
    </BrandedLoginLayout>
  );
}
