import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';
import {
  extractSubdomain,
  getSchoolBySlug,
  isLocalHost,
  type SchoolRecord,
} from '@/lib/schools';
import { SUPER_ADMIN_COOKIE, verifySuperAdminJWT } from '@/lib/super-admin-auth';

/**
 * Two jobs, in order:
 *
 * 1. Guard `/super-admin/*`. Those pages run on the apex domain and are gated
 *    by a signed httpOnly cookie, not by Firebase — the Super Admin has no
 *    tenant, so a tenant-scoped credential would be the wrong shape.
 *
 * 2. Resolve the tenant for everything else, turning the request's hostname
 *    into a GHL Location ID:
 *
 *      beaconhouse.platform.com  ->  x-location-id: <location id of beaconhouse>
 *
 * Downstream code never parses the host itself; it reads the header. And the
 * header alone is not authority — `withAuth()` cross-checks it against the
 * caller's JWT claims, so a forged header cannot reach another tenant's data.
 */

export const LOCATION_HEADER = 'x-location-id';
export const SUBDOMAIN_HEADER = 'x-subdomain';
export const SCHOOL_NAME_HEADER = 'x-school-name';
export const SCHOOL_STATUS_HEADER = 'x-school-status';

const SUPER_ADMIN_LOGIN_PATH = '/super-admin/login';

/** Public paths that must stay reachable on the apex domain. */
const PUBLIC_PATHS: readonly string[] = [
  '/',
  '/school-not-found',
  '/school-unavailable',
];

/**
 * Warm-instance cache for slug lookups. Serverless instances are recycled
 * often, so this is a short TTL that shaves a database round-trip off bursts of
 * requests rather than a real cache.
 */
const LOOKUP_TTL_MS = 60_000;
const lookupCache = new Map<string, { record: SchoolRecord | null; expiresAt: number }>();

async function resolveSchool(slug: string): Promise<SchoolRecord | null> {
  const cached = lookupCache.get(slug);
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return cached.record;
  }

  const record = await getSchoolBySlug(slug);
  lookupCache.set(slug, { record, expiresAt: Date.now() + LOOKUP_TTL_MS });
  return record;
}

/** Clones the request headers with the resolved tenant stamped on them. */
function forwardWithSchool(request: NextRequest, school: SchoolRecord): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(LOCATION_HEADER, school.locationId);
  headers.set(SUBDOMAIN_HEADER, school.slug);
  headers.set(SCHOOL_NAME_HEADER, encodeURIComponent(school.schoolName));
  headers.set(SCHOOL_STATUS_HEADER, school.isActive ? 'active' : 'inactive');

  return NextResponse.next({ request: { headers } });
}

/**
 * Strips any inbound tenant headers before forwarding. A client must never be
 * able to set `x-location-id` itself.
 */
function forwardWithoutSchool(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(LOCATION_HEADER);
  headers.delete(SUBDOMAIN_HEADER);
  headers.delete(SCHOOL_NAME_HEADER);
  headers.delete(SCHOOL_STATUS_HEADER);

  return NextResponse.next({ request: { headers } });
}

/**
 * Gate for the Super Admin panel and its API.
 * Returns a response when it has handled the request, or null to continue.
 */
async function guardSuperAdmin(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;

  const isPanel = pathname === '/super-admin' || pathname.startsWith('/super-admin/');
  const isPanelApi = pathname.startsWith('/api/super-admin/');

  if (!isPanel && !isPanelApi) return null;

  // The login page and the login/logout endpoints must stay reachable.
  const isLoginPage = pathname === SUPER_ADMIN_LOGIN_PATH;
  const isAuthEndpoint = pathname.startsWith('/api/super-admin/auth/');

  const token = request.cookies.get(SUPER_ADMIN_COOKIE)?.value;
  const session = token === undefined ? null : await verifySuperAdminJWT(token);

  if (isLoginPage) {
    // Already signed in — no reason to show the form again.
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
    // Send them back where they were headed once they sign in.
    if (pathname !== '/super-admin') target.searchParams.set('next', pathname);
    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const superAdminResponse = await guardSuperAdmin(request);
  if (superAdminResponse !== null) return superAdminResponse;

  const host = request.headers.get('host') ?? '';
  const { pathname } = request.nextUrl;

  // -- Local development ----------------------------------------------------
  // There is no real subdomain on localhost. Resolve a tenant from
  // `?subdomain=` (sticky per request) or DEV_FALLBACK_LOCATION_ID, so the
  // portal can be exercised without editing /etc/hosts.
  if (isLocalHost(host)) {
    const devSubdomain = request.nextUrl.searchParams.get('subdomain');

    if (devSubdomain !== null && devSubdomain !== '') {
      try {
        const school = await resolveSchool(devSubdomain);
        if (school !== null) return forwardWithSchool(request, school);
      } catch (error) {
        // A missing DATABASE_URL is common on a fresh checkout; fall through to
        // the env fallback rather than failing every request.
        console.error('[middleware] dev subdomain lookup failed:', error);
      }
    }

    const fallbackLocationId = process.env.DEV_FALLBACK_LOCATION_ID;
    if (fallbackLocationId !== undefined && fallbackLocationId !== '') {
      const headers = new Headers(request.headers);
      headers.set(LOCATION_HEADER, fallbackLocationId);
      headers.set(SCHOOL_STATUS_HEADER, 'active');
      return NextResponse.next({ request: { headers } });
    }

    return forwardWithoutSchool(request);
  }

  const slug = extractSubdomain(host, publicEnv.appDomain);

  // -- Apex domain (no subdomain) -------------------------------------------
  if (slug === null) {
    // Portal routes are meaningless without a school; send visitors to the
    // landing page rather than rendering an empty shell.
    if (!PUBLIC_PATHS.includes(pathname) && !pathname.startsWith('/super-admin')) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return forwardWithoutSchool(request);
  }

  // -- School subdomain -----------------------------------------------------
  let school: SchoolRecord | null;
  try {
    school = await resolveSchool(slug);
  } catch (error) {
    console.error('[middleware] subdomain lookup failed:', error);
    return NextResponse.rewrite(new URL('/school-unavailable?reason=lookup', request.url));
  }

  if (school === null) {
    const target = new URL('/school-not-found', request.url);
    target.hostname = publicEnv.appDomain;
    target.searchParams.set('subdomain', slug);
    return NextResponse.redirect(target);
  }

  if (!school.isActive) {
    const unavailable = new URL('/school-unavailable', request.url);
    unavailable.searchParams.set('reason', 'inactive');
    unavailable.searchParams.set('school', school.schoolName);
    return NextResponse.rewrite(unavailable);
  }

  return forwardWithSchool(request, school);
}

export const config = {
  /**
   * Runs on pages and API routes, but not on build output or static assets.
   * API routes are included deliberately: `withAuth()` depends on the
   * `x-location-id` header this middleware sets, and `/api/super-admin/*`
   * depends on the session check above.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
};
