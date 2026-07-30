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
