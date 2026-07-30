/**
 * Slug rules for school subdomains.
 *
 * A slug becomes a hostname label (`slug.platform.com`), so it must be a valid
 * RFC-1123 label: lowercase alphanumerics and inner hyphens, 1–63 characters.
 */

/** Labels that would collide with platform surfaces or infrastructure. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www',
  'app',
  'api',
  'admin',
  'super-admin',
  'auth',
  'login',
  'static',
  'assets',
  'cdn',
  'mail',
  'status',
  'dashboard',
  'portal',
]);

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Derives a candidate slug from a school name. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    // Strip combining accents so "Béaconhouse" becomes "beaconhouse".
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

export function isValidSlug(candidate: string): boolean {
  return SLUG_PATTERN.test(candidate) && !RESERVED_SLUGS.has(candidate);
}

/** Human-readable reason a slug was rejected, or null when it is fine. */
export function slugRejectionReason(candidate: string): string | null {
  if (candidate === '') return 'Enter a subdomain.';
  if (candidate.length > 63) return 'Subdomain must be 63 characters or fewer.';
  if (!SLUG_PATTERN.test(candidate)) {
    return 'Use lowercase letters, digits and hyphens only, starting and ending with a letter or digit.';
  }
  if (RESERVED_SLUGS.has(candidate)) return 'That subdomain is reserved.';
  return null;
}
