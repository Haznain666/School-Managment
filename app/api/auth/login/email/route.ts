import type { NextRequest, NextResponse } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  burnPasswordTiming,
  isValidEmail,
  normalizeEmail,
  verifyPassword,
} from '@/lib/email-auth';
import { findPasswordRecord } from '@/lib/email-credentials';
import {
  applySessionCookie,
  establishEmailSession,
  loadMemberIdentity,
} from '@/lib/email-session';
import { resolvePublicTenant } from '@/lib/email-verifications';

/**
 * POST /api/auth/login/email
 *
 * Email and password sign-in. Unauthenticated by necessity — it runs before
 * anyone has a session.
 *
 * On success the response carries the httpOnly session cookie and nothing the
 * browser could keep: no token, no uid, no claims. The redirect is computed
 * server-side from the role in the same breath, so the page that receives it
 * has no say in where a role may land.
 *
 * ── On the single error message ──────────────────────────────────────────
 * "Invalid email or password" is returned for an unknown address, a wrong
 * password and a malformed body alike, and `burnPasswordTiming` keeps the
 * unknown-address path roughly as slow as a real bcrypt comparison. Together
 * those are what stop this endpoint from answering "does this person have an
 * account at this school", which for a school portal is itself information
 * worth protecting.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LoginBody {
  email?: unknown;
  password?: unknown;
  locationId?: unknown;
}

const GENERIC_FAILURE = 'Invalid email or password.';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody<LoginBody>(request);
    const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!isValidEmail(email) || password === '') {
      await burnPasswordTiming();
      return apiFailure('invalid_credentials', GENERIC_FAILURE, 401);
    }

    const tenant = await resolvePublicTenant(request, body?.locationId);
    const record = await findPasswordRecord(email, tenant?.locationId ?? null);

    if (record === null) {
      await burnPasswordTiming();
      return apiFailure('invalid_credentials', GENERIC_FAILURE, 401);
    }

    if (!(await verifyPassword(password, record.passwordHash))) {
      return apiFailure('invalid_credentials', GENERIC_FAILURE, 401);
    }

    // The credential is good. Whether the account may still sign in is a
    // separate question, and the answer lives in `school_users`.
    const identity = await loadMemberIdentity(record.locationId, record.firebaseUid);

    if (identity === null) {
      return apiFailure(
        'account_disabled',
        'Your account is not active. Contact your school administrator.',
        403,
      );
    }

    const session = await establishEmailSession(record.locationId, identity);

    const response = apiSuccess({
      redirect: session.redirect,
      role: session.role,
      name: session.name,
      mustChangePassword: record.mustChangePassword,
    });

    applySessionCookie(response, session);
    return response as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
