import { serverEnv } from './env';

/**
 * Builds the absolute URL an invitee clicks.
 *
 * Development has no real subdomain, so the school travels as `?school=`;
 * production puts it in the hostname. Both forms land on the same route.
 */
export function buildInviteUrl(token: string, schoolSlug: string): string {
  const base = serverEnv('INVITE_LINK_BASE_URL', '').trim();
  const isDevelopment = process.env.NODE_ENV === 'development';

  if (isDevelopment || base === '') {
    const origin = base === '' ? 'http://localhost:3000' : base;
    return `${origin.replace(/\/+$/, '')}/invite/${token}?school=${encodeURIComponent(schoolSlug)}`;
  }

  const url = new URL(base);
  const baseDomain = serverEnv('PLATFORM_BASE_DOMAIN', url.hostname);
  url.hostname = `${schoolSlug}.${baseDomain}`;
  url.pathname = `/invite/${token}`;
  return url.toString();
}

export interface EmailVerifyUrlParams {
  token: string;
  email: string;
  schoolSlug: string;
  /** GHL Location ID, carried so the page works where no subdomain does. */
  locationId: string;
}

/**
 * Builds the absolute URL in an email invitation.
 *
 * Two identifiers for the school travel in it, and they are not redundant:
 *
 *   `school` is the **slug**, because that is what middleware resolves a tenant
 *   from — putting a location id there would leave the page with no branding
 *   and no tenant headers at all.
 *
 *   `loc` is the location id, the fallback the verification endpoints fall
 *   back to on deployments that have no wildcard subdomain (a preview host,
 *   local development). It is not a credential: `resolvePublicTenant` looks it
 *   up rather than believing it, and naming a school is not entering it.
 *
 * `NEXT_PUBLIC_APP_URL` wins when it is set, so a deployment can point
 * invitation links somewhere specific without touching the WhatsApp links that
 * `buildInviteUrl` still produces.
 */
export function buildEmailVerifyUrl(params: EmailVerifyUrlParams): string {
  const configured =
    serverEnv('NEXT_PUBLIC_APP_URL', '').trim() ||
    serverEnv('INVITE_LINK_BASE_URL', '').trim();

  const isDevelopment = process.env.NODE_ENV === 'development';
  const origin = configured === '' ? 'http://localhost:3000' : configured;

  const url =
    isDevelopment || configured === ''
      ? new URL(origin.replace(/\/+$/, ''))
      : (() => {
          const parsed = new URL(origin);
          const baseDomain = serverEnv('PLATFORM_BASE_DOMAIN', parsed.hostname);
          parsed.hostname = `${params.schoolSlug}.${baseDomain}`;
          return parsed;
        })();

  url.pathname = '/auth/verify';
  url.search = '';
  url.searchParams.set('token', params.token);
  url.searchParams.set('email', params.email);
  url.searchParams.set('school', params.schoolSlug);
  url.searchParams.set('loc', params.locationId);

  return url.toString();
}
