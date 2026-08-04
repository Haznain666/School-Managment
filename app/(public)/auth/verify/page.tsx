import type { Metadata } from 'next';

import { BrandedLoginLayout } from '@/components/school/BrandedLoginLayout';
import { getSchoolBranding, getSchoolHeaders } from '@/lib/school-tenant';
import { normalizeEmail } from '@/lib/password-strength';

import { VerifyInvitationClient } from './VerifyInvitationClient';

export const metadata: Metadata = {
  title: 'Set up your account',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface VerifyPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const value = params[key];
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return (value[0] ?? '').trim();
  return '';
}

/**
 * Invitation acceptance, reached from the link in the email.
 *
 * The token and the address come from the query string and are passed straight
 * through to the client — nothing is checked here. That is deliberate: this
 * page has no session and no business confirming whether an invitation is
 * valid, because a page that renders differently for a real token than a
 * guessed one is a way to test tokens without ever submitting a code.
 * `/api/auth/verify-invitation` is where the answer lives, and it needs the
 * code as well.
 *
 * The tenant comes from the hostname where there is one, and falls back to the
 * `loc` parameter the link carries for deployments without a wildcard domain.
 */
export default async function VerifyInvitationPage({ searchParams }: VerifyPageProps) {
  const params = await searchParams;

  const token = readParam(params, 'token');
  const email = normalizeEmail(readParam(params, 'email'));
  const linkLocationId = readParam(params, 'loc');

  const { locationId, slug } = await getSchoolHeaders();
  const resolvedLocationId =
    locationId !== null && locationId !== '' ? locationId : linkLocationId;

  if (token === '' || email === '' || resolvedLocationId === '') {
    return (
      <BrandedLoginLayout subtitle="Invitation link">
        <div className="rounded-card border border-slate-200 bg-white p-6 shadow-card">
          <h2 className="text-base font-semibold text-slate-900">
            This link is incomplete
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Open the invitation from your email exactly as it was sent, or ask your
            school administrator to send a new one.
          </p>
        </div>
      </BrandedLoginLayout>
    );
  }

  const school = await getSchoolBranding(resolvedLocationId);

  return (
    <BrandedLoginLayout subtitle="Set up your account">
      <VerifyInvitationClient
        schoolName={school?.name ?? 'your school'}
        locationId={resolvedLocationId}
        schoolSlug={slug}
        token={token}
        email={email}
      />
    </BrandedLoginLayout>
  );
}
