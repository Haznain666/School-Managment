import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { schools } from '@/db/schema';
import { db } from '@/lib/drizzle';
import { publicEnv } from '@/lib/env';
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
 * roles here. It cannot: `firebase-admin` needs Node APIs, middleware runs on
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

interface ResolvedSchool {
  locationId: string;
  schoolId: string;
  slug: string;
  isActive: boolean;
}

/**
 * Warm-instance cache for slug lookups. Serverless instances recycle often, so
 * this shaves a round-trip off bursts rather than acting as a real cache.
 */
const LOOKUP_TTL_MS = 60_000;
const lookupCache = new Map<
  string,
  { record: ResolvedSchool | null; expiresAt: number }
>();

async function resolveSchoolBySlug(slug: string): Promise<ResolvedSchool | null> {
  const cached = lookupCache.get(slug);
  if (cached !== undefined && cached.expiresAt > Date.now()) return cached.record;

  const rows = await db
    .select({
      locationId: schools.locationId,
      schoolId: schools.id,
      slug: schools.slug,
      isActive: schools.isActive,
    })
    .from(schools)
    .where(eq(schools.slug, slug))
    .limit(1);

  const record = rows[0] ?? null;
  lookupCache.set(slug, { record, expiresAt: Date.now() + LOOKUP_TTL_MS });
  return record;
}

/**
 * Which school is this request for?
 * Development reads `?school=`; production reads the Host header.
 */
function slugForRequest(request: NextRequest): string | null {
  const host = request.headers.get('host') ?? '';

  if (process.env.NODE_ENV === 'development' || isLocalHostname(host)) {
    const fromQuery = request.nextUrl.searchParams.get('school');
    return fromQuery !== null && fromQuery.trim() !== '' ? fromQuery.trim() : null;
  }

  const baseDomain = process.env['PLATFORM_BASE_DOMAIN'] ?? publicEnv.appDomain;
  return subdomainFromHost(host, baseDomain);
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
  const slug = slugForRequest(request);

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
      return NextResponse.redirect(login);
    }
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  /** Pages and API routes, but not build output or static assets. */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
};
