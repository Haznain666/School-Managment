import { NextResponse, type NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  checkThrottle,
  clientIpHash,
  recordAttempt,
  throttledResponse,
} from '@/lib/auth-throttle';
import {
  candidateEmailsFor,
  createLoginHandoff,
  membershipsFor,
  signChooserToken,
  verifySchoolPassword,
} from '@/lib/central-signin';
import { buildHandoffUrl } from '@/lib/platform-school-access';
import { recordSuperAdminSignIn } from '@/lib/super-admin-accounts';
import {
  SUPER_ADMIN_SESSION_SECONDS,
  sessionCookieOptions,
  signSuperAdminJWT,
} from '@/lib/super-admin-auth';
import { verifySuperAdminCredentials } from '@/lib/super-admin-credentials';

/**
 * POST /api/platform/sign-in — the apex form. Sprint 35, §7.
 *
 * `{ loginId, password }`. In order:
 *
 *   1. **Super admin?** `super_admin_users` by bcrypt (with the environment
 *      fallback for the owner). A match sets the panel's cookie — on the apex,
 *      which is where the panel lives — and answers `{ kind: 'super_admin' }`.
 *   2. **School user?** Supabase, checked without writing a cookie (the apex
 *      cookie would be useless on a school's host). A Login ID with no `@` is a
 *      student's ID and is matched to their credential address.
 *   3. **Where to?** One membership: a single-use hand-off URL on that school's
 *      own address. Several: a signed five-minute chooser token and the list —
 *      school name and logo — for the entity picker.
 *
 * Throttled on its own scope before anything is looked up, so a throttled
 * answer costs the same and says the same thing for an address that exists
 * and one that does not. Every failure — wrong password, unknown ID, a real
 * account with no school — is the one sentence below.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SignInBody {
  loginId?: unknown;
  password?: unknown;
}

const REFUSAL = 'That Login ID and password do not match an account.';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody<SignInBody>(request);
    const loginId = typeof body?.loginId === 'string' ? body.loginId.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (loginId === '' || password === '') {
      return apiFailure('invalid_body', 'Enter your Login ID and password.', 400);
    }

    const ipHash = clientIpHash(request);
    const throttle = await checkThrottle('central_login', loginId, ipHash);
    if (!throttle.allowed) return throttledResponse(throttle);

    /* ── 1. the operators ─────────────────────────────────────────────── */
    if (loginId.includes('@')) {
      const operator = await verifySuperAdminCredentials(loginId, password);
      if (operator.ok) {
        await recordAttempt('central_login', operator.email, ipHash, true);
        if (operator.adminId !== null) await recordSuperAdminSignIn(operator.adminId);

        const response = apiSuccess({ kind: 'super_admin' as const, redirectTo: '/super-admin' });
        response.cookies.set({
          ...sessionCookieOptions(SUPER_ADMIN_SESSION_SECONDS),
          value: await signSuperAdminJWT(operator.email, operator.adminId),
        });
        return response as NextResponse;
      }
      // `misconfigured` falls through: a deployment with no operator account
      // must still let its schools sign in here.
    }

    /* ── 2. the schools ───────────────────────────────────────────────── */
    let user: Awaited<ReturnType<typeof verifySchoolPassword>> = null;
    for (const email of await candidateEmailsFor(loginId)) {
      user = await verifySchoolPassword(email, password);
      if (user !== null) break;
    }

    const memberships = user === null ? [] : await membershipsFor(user.id);

    if (user === null || user.email === undefined || memberships.length === 0) {
      await recordAttempt('central_login', loginId, ipHash, false);
      return apiFailure('invalid_credentials', REFUSAL, 401);
    }

    await recordAttempt('central_login', loginId, ipHash, true);

    /* ── 3. the hand-off ──────────────────────────────────────────────── */
    const host = request.headers.get('host') ?? '';
    const protocol = new URL(request.url).protocol;

    const only = memberships.length === 1 ? memberships[0] : undefined;
    if (only !== undefined) {
      const token = await createLoginHandoff({
        locationId: only.locationId,
        authUserId: user.id,
        email: user.email,
      });
      return apiSuccess({
        kind: 'redirect' as const,
        url: buildHandoffUrl(token, only.slug, host, protocol, 'handoff'),
        schoolName: only.name,
      });
    }

    return apiSuccess({
      kind: 'choose' as const,
      chooserToken: await signChooserToken({ id: user.id, email: user.email }),
      entities: memberships.map((membership) => ({
        schoolId: membership.schoolId,
        name: membership.name,
        logoUrl: membership.logoUrl,
        roleLabel: membership.roleLabel,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
