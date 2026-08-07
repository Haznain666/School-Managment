/**
 * Headers that middleware stamps on every request after resolving the school
 * from the hostname (production) or the `?school=` query parameter (dev).
 *
 * Kept in their own module because both Edge middleware and Node server
 * components import them; nothing here may pull in `server-only` or
 * `server-only` or a database driver.
 */

export const SCHOOL_LOCATION_HEADER = 'x-school-location-id';
export const SCHOOL_ID_HEADER = 'x-school-id';
export const SCHOOL_SLUG_HEADER = 'x-school-slug';

/** Set only when a valid session cookie was present. Advisory, never authority. */
export const USER_UID_HEADER = 'x-user-uid';
export const USER_ROLE_HEADER = 'x-user-role';
export const USER_BRANCH_HEADER = 'x-user-branch-id';

/** Every header above, for stripping client-supplied copies. */
export const MIDDLEWARE_HEADERS: readonly string[] = [
  SCHOOL_LOCATION_HEADER,
  SCHOOL_ID_HEADER,
  SCHOOL_SLUG_HEADER,
  USER_UID_HEADER,
  USER_ROLE_HEADER,
  USER_BRANCH_HEADER,
];

export interface SchoolContextHeaders {
  locationId: string | null;
  schoolId: string | null;
  slug: string | null;
}

/**
 * Extracts the school slug from a Host header.
 * Returns null for the apex domain, `www`, and anything that is not a direct
 * child of `baseDomain`.
 */
export function subdomainFromHost(host: string, baseDomain: string): string | null {
  const hostname = (host.split(':')[0] ?? '').toLowerCase().trim();
  const apex = baseDomain.toLowerCase().trim();

  if (hostname === '' || apex === '') return null;
  if (hostname === apex || hostname === `www.${apex}`) return null;
  if (!hostname.endsWith(`.${apex}`)) return null;

  const label = hostname.slice(0, hostname.length - apex.length - 1);

  // Only single-label subdomains map to schools: `a.b.platform.com` does not.
  return label === '' || label.includes('.') ? null : label;
}

/** True for local development and preview hosts, where there is no real subdomain. */
export function isLocalHostname(host: string): boolean {
  const hostname = (host.split(':')[0] ?? '').toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local')
  );
}
