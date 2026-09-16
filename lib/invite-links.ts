import { serverEnv } from './env';

/**
 * Absolute URLs into a school's portal.
 *
 * ── The rule: the shape follows the origin, not NODE_ENV ─────────────────
 * There are two ways to name a tenant, and they are not interchangeable:
 *
 *   `<slug>.platform.com/login`   — production, tenant in the hostname
 *   `localhost:3000/login?school=<slug>` — local, which has no wildcard DNS
 *
 * These used to be chosen by `NODE_ENV === 'development'` while the *origin*
 * came from `INVITE_LINK_BASE_URL`. On a developer's machine those disagree:
 * `NODE_ENV` is development, but `INVITE_LINK_BASE_URL` points at the real
 * domain, so the dev server emailed people
 *
 *   https://schoolhub.codexmill.com/login?school=sample-test-school
 *
 * — a production origin carrying a development parameter. That URL cannot
 * work anywhere. `middleware.ts` deliberately ignores `?school=` on the
 * platform domain itself (see `isPlatformHost`): the apex is the platform, not
 * a tenant, so the request resolves to no school and lands on
 * /school-not-found. It looked like a broken deployment and was a broken link.
 *
 * Deciding from the origin's hostname removes the disagreement — there is only
 * one input, so there is nothing to contradict. Point `INVITE_LINK_BASE_URL`
 * at `http://localhost:3000` and every link is a working local link; point it
 * at the real domain and every link is a working subdomain link.
 *
 * ── The remaining trap, which is not this file's to solve ────────────────
 * A correct `<slug>.platform.com` URL still only resolves if that subdomain
 * exists. HTTPS is issued per subdomain in hPanel rather than by a wildcard,
 * so creating a school in the Super Admin panel does not by itself make its
 * portal reachable. See `STATE.md` §3.
 */

/** True for an origin that has no wildcard DNS and so needs `?school=`. */
function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname.endsWith('.localhost')
    );
  } catch {
    // An unparseable origin is not something to guess about.
    return true;
  }
}

/** The configured origin, falling back to the usual dev server. */
function baseOrigin(): string {
  const base = serverEnv('INVITE_LINK_BASE_URL', '').trim();
  return base === '' ? 'http://localhost:3000' : base.replace(/\/+$/, '');
}

/**
 * Builds a school-scoped URL for `path` (which must start with `/`).
 *
 * Exported so the two builders below cannot drift apart; they differ only in
 * the path they ask for.
 */
function buildSchoolUrl(path: string, schoolSlug: string): string {
  const origin = baseOrigin();

  /*
   * `path` may carry a query of its own — Sprint 33a's `?c=<conversation>`
   * deep link is the first one that does. Both branches below would have
   * mangled it: the local one by appending a second `?`, and the subdomain one
   * by assigning the whole string to `pathname`, which percent-encodes the `?`
   * into the path. Splitting once, here, keeps every caller honest; a path
   * without a query behaves exactly as it always did.
   */
  const [pathname = '/', query = ''] = path.split('?');

  if (isLocalOrigin(origin)) {
    const separator = query === '' ? '?' : '&';
    return `${origin}${path}${separator}school=${encodeURIComponent(schoolSlug)}`;
  }

  const url = new URL(origin);
  const baseDomain = serverEnv('PLATFORM_BASE_DOMAIN', url.hostname);
  url.hostname = `${schoolSlug}.${baseDomain}`;
  url.pathname = pathname;
  url.search = query;
  return url.toString();
}

/** The absolute URL an invitee clicks. */
export function buildInviteUrl(token: string, schoolSlug: string): string {
  return buildSchoolUrl(`/invite/${token}`, schoolSlug);
}

/**
 * Any portal path, as an absolute URL into one school.
 *
 * Sprint 33a. The unread-message email had no link in it at all — *"Sign in to
 * read and reply"* — so a parent on a phone had to find the portal, sign in,
 * open Messages and then find the thread the email was about. The digest now
 * links straight to it, and it builds that link **here** rather than
 * concatenating a hostname of its own: the local/subdomain difference above is
 * exactly the trap that mailed people a production origin carrying a
 * development parameter, and there is no reason for a second module to
 * rediscover it.
 *
 * `path` must start with `/` and may carry its own query string; a link that
 * already has one is given `&school=` rather than a second `?` on a local
 * origin.
 */
export function buildSchoolPortalUrl(path: string, schoolSlug: string): string {
  return buildSchoolUrl(path, schoolSlug);
}

/** The school's sign-in page. */
export function buildSchoolLoginUrl(schoolSlug: string): string {
  return buildSchoolUrl('/login', schoolSlug);
}

/** Where a first-time member goes to choose their password. */
export function buildSetupPasswordUrl(token: string, schoolSlug: string): string {
  return buildSchoolUrl(`/set-password/${token}`, schoolSlug);
}
