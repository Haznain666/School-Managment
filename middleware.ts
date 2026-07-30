import { NextResponse, type NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';
import {
  extractSubdomain,
  getSchoolBySubdomain,
  isLocalHost,
  type SchoolRecord,
} from '@/lib/schools';

/**
 * Tenant resolution middleware.
 *
 * Runs before every page and API route and turns the request's hostname into a
 * GHL Location ID:
 *
 *   beaconhouse.platform.com  ->  x-location-id: <location id of beaconhouse>
 *
 * Downstream code never parses the host itself; it reads the header. And the
 * header alone is not authority — `withAuth()` cross-checks it against the
 * caller's JWT claims, so a forged header cannot reach another tenant's data.
 *
 * Cases handled:
 *   - localhost / preview hosts: subdomain logic skipped, optional dev fallback
 *   - apex domain (no subdomain): served as the public landing site
 *   - unknown subdomain: redirected to the landing site with an error
 *   - suspended or inactive school: shown the unavailable page
 */

export const LOCATION_HEADER = 'x-location-id';
export const SUBDOMAIN_HEADER = 'x-subdomain';
export const SCHOOL_NAME_HEADER = 'x-school-name';
export const SCHOOL_STATUS_HEADER = 'x-school-status';

/** Public paths that must stay reachable on the apex domain. */
const PUBLIC_PATHS: readonly string[] = [
  '/',
  '/school-not-found',
  '/school-unavailable',
];

/**
 * Warm-instance cache for subdomain lookups. Serverless instances are recycled
 * often, so this is a short TTL that shaves a database round-trip off bursts of
 * requests rather than a real cache.
 */
const LOOKUP_TTL_MS = 60_000;
const lookupCache = new Map<string, { record: SchoolRecord | null; expiresAt: number }>();

async function resolveSchool(subdomain: string): Promise<SchoolRecord | null> {
  const cached = lookupCache.get(subdomain);
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return cached.record;
  }

  const record = await getSchoolBySubdomain(subdomain);
  lookupCache.set(subdomain, { record, expiresAt: Date.now() + LOOKUP_TTL_MS });
  return record;
}

/** Clones the request headers with the resolved tenant stamped on them. */
function forwardWithSchool(request: NextRequest, school: SchoolRecord): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(LOCATION_HEADER, school.locationId);
  headers.set(SUBDOMAIN_HEADER, school.subdomain);
  headers.set(SCHOOL_NAME_HEADER, encodeURIComponent(school.schoolName));
  headers.set(SCHOOL_STATUS_HEADER, school.status);

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

export async function middleware(request: NextRequest): Promise<NextResponse> {
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

  const subdomain = extractSubdomain(host, publicEnv.appDomain);

  // -- Apex domain (no subdomain) -------------------------------------------
  if (subdomain === null) {
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
    school = await resolveSchool(subdomain);
  } catch (error) {
    console.error('[middleware] subdomain lookup failed:', error);
    return NextResponse.rewrite(new URL('/school-unavailable?reason=lookup', request.url));
  }

  if (school === null) {
    const target = new URL('/school-not-found', request.url);
    target.hostname = publicEnv.appDomain;
    target.searchParams.set('subdomain', subdomain);
    return NextResponse.redirect(target);
  }

  if (school.status !== 'active') {
    const unavailable = new URL('/school-unavailable', request.url);
    unavailable.searchParams.set('reason', school.status);
    unavailable.searchParams.set('school', school.schoolName);
    return NextResponse.rewrite(unavailable);
  }

  return forwardWithSchool(request, school);
}

export const config = {
  /**
   * Runs on pages and API routes, but not on build output or static assets.
   * API routes are included deliberately: `withAuth()` depends on the
   * `x-location-id` header this middleware sets.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
};
