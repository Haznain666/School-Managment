import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';
import { fetchSchoolBySlug, type ResolvedSchool } from '@/lib/school-lookup-edge';
import {
  isLocalHostname,
  MIDDLEWARE_HEADERS,
  SCHOOL_ID_HEADER,
  SCHOOL_LOCATION_HEADER,
  SCHOOL_SLUG_HEADER,
  subdomainFromHost,
} from '@/lib/school-context';
import { SUPER_ADMIN_COOKIE, verifySuperAdminJWT } from '@/lib/super-admin-auth';

/**
 * Two jobs, in order:
 *
 * 1. Guard `/super-admin/*` (Sprint 2, unchanged) — a signed cookie verified
 *    here with `jose`, which runs on the Edge.
 *
 * 2. Resolve the school for everything else, turning the hostname (or, in
 *    development, `?school=`) into a GHL Location ID stamped on the request
 *    headers.
 *
 * ── On session verification ──────────────────────────────────────────────
 * The Sprint 3 brief asks middleware to call `verifySessionCookie` and enforce
 * roles here. It cannot: verifying a session needs Node APIs, middleware runs on
 * the Edge, and this Next version rejects `experimental.nodeMiddleware` — the
 * key is unrecognised and the runtime stays Edge.
 *
 * So middleware does the cheap half: it checks whether a session cookie is
 * *present* and bounces anonymous traffic to /login. The authoritative half —
 * verifying the signature, the revocation state and the caller's role — runs in
 * each protected layout and in `withSchoolAuth` on every API route, both on
 * Node. A forged cookie gets past middleware and is rejected milliseconds later
 * by the layout. That is the standard Next.js arrangement and costs nothing in
 * security: nothing renders or returns before the real check runs.
 */

/**
 * Remembers which school this browser is on, for hosts where the tenant cannot
 * live in the hostname. See `schoolFromCookie` for why it exists.
 */
const SCHOOL_SLUG_COOKIE = 'school_slug';

const SUPER_ADMIN_LOGIN_PATH = '/super-admin/login';
const SCHOOL_LOGIN_PATH = '/login';
const SCHOOL_NOT_FOUND_PATH = '/school-not-found';

/** Reachable without a school and without a session. */
const PUBLIC_PATHS: readonly string[] = ['/', SCHOOL_NOT_FOUND_PATH];

/** Route prefixes that require a signed-in school user. */
const PROTECTED_PREFIXES: readonly string[] = [
  '/dashboard',
  '/teacher',
  '/student',
  '/parent',
];

/**
 * Warm-instance cache for slug lookups.
 *
 * On Hostinger this is a single long-lived Node process rather than a fleet of
 * recycling serverless instances, so the cache actually holds — one lookup per
 * school per minute instead of one per request. The 60s TTL is what bounds how
 * long a deactivated school stays reachable.
 */
const LOOKUP_TTL_MS = 60_000;
const lookupCache = new Map<
  string,
  { record: ResolvedSchool | null; expiresAt: number }
>();

/**
 * Resolves a slug through Supabase's REST API — see `lib/school-lookup-edge.ts`
 * for why this cannot be a Drizzle query like every other read in the app.
 *
 * ── Why a failed lookup falls back to the expired entry ──────────────────
 * `fetchSchoolBySlug` throws for "the lookup failed" and returns null for "no
 * such school", and that distinction used to be collapsed here: any throw sent
 * the request to /school-not-found. So a single slow or refused call to
 * Supabase — one dropped connection, one rate-limited second — told a signed-in
 * administrator that their school does not exist, on whichever page they
 * happened to click. Reloading fixed it, which is exactly what makes the
 * failure so hard to report: it is real, it is not reproducible, and the page
 * it produces accuses the tenant rather than the transport.
 *
 * A school that resolved 61 seconds ago has not stopped existing because one
 * HTTPS request failed. So the entry is kept past its expiry and served when a
 * refresh cannot be made, and only a *first* lookup — nothing cached at all —
 * can still fail. The TTL keeps its meaning for the case it was written for: a
 * deactivated school stops being reachable within 60 seconds, because that
 * answer arrives as a successful lookup and replaces the entry.
 */
async function resolveSchoolBySlug(slug: string): Promise<ResolvedSchool | null> {
  const cached = lookupCache.get(slug);
  if (cached !== undefined && cached.expiresAt > Date.now()) return cached.record;

  try {
    const record = await fetchSchoolBySlug(slug);
    lookupCache.set(slug, { record, expiresAt: Date.now() + LOOKUP_TTL_MS });
    return record;
  } catch (error) {
    if (cached === undefined) throw error;

    // Stale, and better than wrong. Logged every time so a Supabase outage is
    // still visible in the logs rather than absorbed silently.
    console.error(
      `[middleware] school lookup for "${slug}" failed; serving the last known ` +
        'result:',
      error,
    );
    return cached.record;
  }
}

/**
 * Which school is this request for?
 * Development reads `?school=`; production reads the Host header.
 */
function schoolFromQuery(request: NextRequest): string | null {
  const fromQuery = request.nextUrl.searchParams.get('school');
  return fromQuery !== null && fromQuery.trim() !== '' ? fromQuery.trim() : null;
}

/**
 * The tenant remembered from an earlier request on this host.
 *
 * ── Why this is needed ───────────────────────────────────────────────────
 * Without a wildcard domain the tenant travels in `?school=`, and a query
 * string survives exactly one navigation. Every in-app link is a bare path —
 * `<Link href="/dashboard/fees">` — so the first click after signing in
 * arrived with no tenant, resolved to nothing, and was rewritten to
 * /school-not-found. The dashboard worked only because the redirect that
 * landed on it still carried the parameter.
 *
 * Threading the parameter through every link in the application would be the
 * other fix, and a worse one: it is dozens of call sites, each of which is one
 * forgotten `?school=` away from reintroducing this.
 *
 * ── Why it is safe ───────────────────────────────────────────────────────
 * Same reasoning as the query parameter it backs up: selecting a tenant is not
 * entering it. `requireSchoolRole` and `withSchoolAuth` compare the resolved
 * location against the session's own claims, so a stale or forged cookie
 * cannot open a school the caller has no session for — at worst it bounces
 * them to login. The query parameter still wins when present, so switching
 * schools works and refreshes this.
 */
function schoolFromCookie(request: NextRequest): string | null {
  const value = request.cookies.get(SCHOOL_SLUG_COOKIE)?.value;
  return value !== undefined && value.trim() !== '' ? value.trim() : null;
}

interface SlugResolution {
  slug: string | null;
  /** True when the hostname itself carried the tenant, so nothing is stored. */
  fromHost: boolean;
}

function slugForRequest(request: NextRequest): SlugResolution {
  const host = request.headers.get('host') ?? '';

  if (process.env.NODE_ENV === 'development' || isLocalHostname(host)) {
    return {
      slug: schoolFromQuery(request) ?? schoolFromCookie(request),
      fromHost: false,
    };
  }

  const baseDomain = process.env['PLATFORM_BASE_DOMAIN'] ?? publicEnv.appDomain;

  const fromHost = subdomainFromHost(host, baseDomain);
  // The hostname carries the tenant on its own — nothing to remember, and a
  // remembered value must never be able to override it.
  if (fromHost !== null) return { slug: fromHost, fromHost: true };

  /**
   * Deployment hosts that are not part of the platform domain — a bare
   * `*.vercel.app` preview or alias — have no subdomain to carry a tenant, so
   * every school page would be unreachable on them. They fall back to
   * `?school=`, the same mechanism development already uses.
   *
   * This cannot widen access on a real tenant host: `<slug>.platform.com`
   * resolves through `subdomainFromHost` above and returns before reaching
   * here, so the parameter is never consulted there. The apex itself is
   * excluded too. And selecting a tenant is not entering it — `withSchoolAuth`
   * and `requireSchoolRole` still compare the resolved location against the
   * session's own claims, so a chosen slug grants nothing without a session
   * minted for that school.
   *
   * Remove this once a wildcard domain is attached and school traffic no
   * longer arrives on a deployment host.
   */
  const hostname = (host.split(':')[0] ?? '').toLowerCase();
  const apex = baseDomain.toLowerCase().trim();
  const isPlatformHost =
    apex !== '' && (hostname === apex || hostname.endsWith(`.${apex}`));

  return {
    slug: isPlatformHost
      ? null
      : (schoolFromQuery(request) ?? schoolFromCookie(request)),
    fromHost: false,
  };
}

/** Fresh headers with any client-supplied middleware headers stripped. */
function cleanHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  for (const name of MIDDLEWARE_HEADERS) headers.delete(name);
  return headers;
}

/** Carries `?school=` across a redirect so dev sessions keep their tenant. */
function withSchoolParam(url: URL, request: NextRequest): URL {
  const school = request.nextUrl.searchParams.get('school');
  if (school !== null && school !== '') url.searchParams.set('school', school);
  return url;
}

// -----------------------------------------------------------------------------
// Super Admin (Sprint 2 — behaviour unchanged)
// -----------------------------------------------------------------------------

async function guardSuperAdmin(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;

  const isPanel = pathname === '/super-admin' || pathname.startsWith('/super-admin/');
  const isPanelApi = pathname.startsWith('/api/super-admin/');
  if (!isPanel && !isPanelApi) return null;

  const isLoginPage = pathname === SUPER_ADMIN_LOGIN_PATH;
  const isAuthEndpoint = pathname.startsWith('/api/super-admin/auth/');

  const token = request.cookies.get(SUPER_ADMIN_COOKIE)?.value;
  const session = token === undefined ? null : await verifySuperAdminJWT(token);

  if (isLoginPage) {
    return session === null
      ? NextResponse.next()
      : NextResponse.redirect(new URL('/super-admin', request.url));
  }

  if (isAuthEndpoint) return NextResponse.next();

  if (session === null) {
    if (isPanelApi) {
      return NextResponse.json(
        { ok: false, error: { code: 'unauthenticated', message: 'Sign in required.' } },
        { status: 401 },
      );
    }

    const target = new URL(SUPER_ADMIN_LOGIN_PATH, request.url);
    if (pathname !== '/super-admin') target.searchParams.set('next', pathname);
    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

// -----------------------------------------------------------------------------

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const superAdminResponse = await guardSuperAdmin(request);
  if (superAdminResponse !== null) return superAdminResponse;

  const { pathname } = request.nextUrl;

  // The invite token is the credential; these stay reachable with no school
  // context and no session.
  if (pathname.startsWith('/invite/') || pathname.startsWith('/api/school/invitations/')) {
    return NextResponse.next({ request: { headers: cleanHeaders(request) } });
  }

  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next({ request: { headers: cleanHeaders(request) } });
  }

  // -- Resolve the school ---------------------------------------------------
  const { slug, fromHost } = slugForRequest(request);

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const isSchoolApi = pathname.startsWith('/api/school/');
  const needsSchool = isProtected || isSchoolApi || pathname === SCHOOL_LOGIN_PATH;

  if (slug === null) {
    return needsSchool
      ? NextResponse.rewrite(new URL(SCHOOL_NOT_FOUND_PATH, request.url))
      : NextResponse.next({ request: { headers: cleanHeaders(request) } });
  }

  let school: ResolvedSchool | null;
  try {
    school = await resolveSchoolBySlug(slug);
  } catch (error) {
    console.error('[middleware] school lookup failed:', error);
    return NextResponse.rewrite(new URL(SCHOOL_NOT_FOUND_PATH, request.url));
  }

  if (school === null || !school.isActive) {
    return NextResponse.rewrite(new URL(SCHOOL_NOT_FOUND_PATH, request.url));
  }

  const headers = cleanHeaders(request);
  headers.set(SCHOOL_LOCATION_HEADER, school.locationId);
  headers.set(SCHOOL_ID_HEADER, school.schoolId);
  headers.set(SCHOOL_SLUG_HEADER, school.slug);

  // -- Session presence check ----------------------------------------------
  // Presence only; the layouts verify. See the note at the top of this file.
  if (isProtected) {
    const cookieName = process.env['SCHOOL_SESSION_COOKIE_NAME'] ?? 'school_session';
    const session = request.cookies.get(cookieName)?.value;

    if (session === undefined || session === '') {
      const login = withSchoolParam(new URL(SCHOOL_LOGIN_PATH, request.url), request);
      login.searchParams.set('next', pathname);
      return rememberSchool(NextResponse.redirect(login), school.slug, fromHost);
    }
  }

  return rememberSchool(
    NextResponse.next({ request: { headers } }),
    school.slug,
    fromHost,
  );
}

/**
 * Stores the resolved tenant so the next bare in-app link still finds it.
 *
 * Skipped when the hostname carried the tenant itself: on `<slug>.platform.com`
 * the subdomain is the authority, and a cookie there could only ever disagree
 * with it. Refreshed on every request, so switching schools with `?school=`
 * takes effect immediately rather than being pinned by a stale value.
 */
function rememberSchool(
  response: NextResponse,
  slug: string,
  fromHost: boolean,
): NextResponse {
  if (fromHost) return response;

  response.cookies.set({
    name: SCHOOL_SLUG_COOKIE,
    value: slug,
    // Not a credential — it selects a tenant, it does not authorise one — but
    // there is no reason for scripts to read it either.
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 14 * 24 * 60 * 60,
  });

  return response;
}

export const config = {
  /** Pages and API routes, but not build output or static assets. */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
};
