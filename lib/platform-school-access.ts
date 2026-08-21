import 'server-only';

import { createHash } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';

import { publicEnv, requireServerEnv, serverEnv } from './env';
import { subdomainFromHost } from './school-context';

/**
 * Super Admin → school hand-off.
 *
 * ── Why this is not just "set the cookie" ────────────────────────────────
 * The panel and a school portal are not the same origin once a wildcard domain
 * is attached: the panel lives on the apex, a school on `<slug>.<apex>`, and a
 * cookie written by one is never sent to the other. So the operator's re-entered
 * password buys a short-lived, signed hand-off token, the browser is sent to the
 * *school's own* address, and the session is minted there — which is the same
 * shape the emergency-login link already uses, for the same reason.
 *
 * The token is signed with `SUPER_ADMIN_JWT_SECRET`, the credential only the
 * platform holds, and is bound to one location. It carries its own two-minute
 * expiry: long enough to survive a redirect, short enough that a URL left in
 * shell history or a proxy log is inert by the time anyone reads it. It is not
 * single-use — that would need a row per hand-off, and the window is already
 * narrower than the emergency link's fifteen minutes.
 *
 * A leaked token is worth what a leaked emergency link is worth: admin access to
 * one school for a moment. It is not worth the operator's password, which never
 * leaves the panel, and not access to any other tenant.
 */

const ISSUER = 'sms-platform';
const AUDIENCE = 'school-platform-login';

/** Two minutes: enough for one redirect, not enough to be worth stealing. */
export const HANDOFF_TOKEN_SECONDS = 120;

export interface HandoffClaims {
  /** GHL Location ID of the school being entered. */
  locationId: string;
  /** The operator this hand-off was issued to, for the audit trail. */
  email: string;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(requireServerEnv('SUPER_ADMIN_JWT_SECRET'));
}

/** Signs a hand-off token for one school. */
export async function signHandoffToken(claims: HandoffClaims): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);

  return new SignJWT({ locationId: claims.locationId, email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.email)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + HANDOFF_TOKEN_SECONDS)
    .sign(secretKey());
}

/**
 * Verifies a hand-off token. Returns null for anything that is not a currently
 * valid one — expired, tampered with, or minted for a different audience.
 *
 * The audience check is what stops a Super Admin *panel* session cookie being
 * replayed here: both are signed with the same secret, and only this token
 * carries `school-platform-login`.
 */
export async function verifyHandoffToken(token: string): Promise<HandoffClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });

    const locationId = payload['locationId'];
    const email = payload['email'];

    if (typeof locationId !== 'string' || locationId === '') return null;
    if (typeof email !== 'string' || email === '') return null;

    return { locationId, email };
  } catch {
    return null;
  }
}

/**
 * The Supabase account the platform operator uses inside one school.
 *
 * ── Why an address, and why a synthetic one ──────────────────────────────
 * Supabase Auth is keyed by email, so the account needs one. This is the sole
 * place in the application where a synthetic address is right, and it is right
 * precisely because nobody ever reads mail there: the session is minted
 * server-side by `mintSessionForEmail`, which asks GoTrue for a link and
 * redeems it in the same request without sending anything.
 *
 * ── Why one per school ───────────────────────────────────────────────────
 * Derived from the location rather than random, so it is stable across
 * hand-offs, and one per school rather than one globally — an audit trail that
 * pooled every tenant behind a single account would be no trail at all. The
 * `pa_` prefix keeps it clear of any real address.
 *
 * The operator's *own* identity is not this account. It travels in the
 * hand-off token and is stamped into `app_metadata.platformAdminEmail`, which
 * is what the portal shows on screen.
 */
export function platformAdminEmailFor(locationId: string): string {
  const digest = createHash('sha256')
    .update(`platform-admin:${locationId}`)
    .digest('hex')
    .slice(0, 24);

  // A domain that is ours and that no school user can hold an address at.
  const domain = serverEnv('PLATFORM_BASE_DOMAIN', publicEnv.appDomain);

  return `pa_${digest}@${domain}`;
}

/**
 * Where to send the browser to redeem a hand-off.
 *
 * This mirrors `middleware.ts`'s own tenant resolution, and has to: a URL built
 * the other way round resolves to no school and lands on /school-not-found.
 *   · on the platform domain the school is a subdomain
 *   · anywhere else — localhost, any host off the platform domain — it
 *     travels as `?school=`
 */
export function buildHandoffUrl(
  token: string,
  schoolSlug: string,
  requestHost: string,
  protocol: string,
): string {
  const path = `/platform-login/${encodeURIComponent(token)}`;
  const baseDomain = serverEnv('PLATFORM_BASE_DOMAIN', publicEnv.appDomain);

  // Already on `<something>.<apex>`? Then the platform has a wildcard domain
  // and the school has a hostname of its own.
  const hostname = (requestHost.split(':')[0] ?? '').toLowerCase();
  const apex = baseDomain.toLowerCase().trim();
  const isPlatformHost =
    apex !== '' && (hostname === apex || hostname.endsWith(`.${apex}`));

  if (isPlatformHost) {
    const port = requestHost.includes(':') ? `:${requestHost.split(':')[1] ?? ''}` : '';
    return `${protocol}//${schoolSlug}.${apex}${port}${path}`;
  }

  // Same origin, tenant in the query string — the deployment-host fallback
  // middleware already supports.
  return `${path}?school=${encodeURIComponent(schoolSlug)}`;
}

/** True when a host carries its own school subdomain. Used only for messaging. */
export function hostHasSchoolSubdomain(requestHost: string): boolean {
  const baseDomain = serverEnv('PLATFORM_BASE_DOMAIN', publicEnv.appDomain);
  return subdomainFromHost(requestHost, baseDomain) !== null;
}
