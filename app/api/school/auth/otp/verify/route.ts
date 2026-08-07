import { and, eq, isNull, or } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolUsers } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';
import { normaliseEmail, signOutCurrentSession, verifyEmailOtp } from '@/lib/supabase-auth';

/**
 * POST /api/school/auth/otp/verify — redeem the code and open a session.
 *
 * On success the session cookie is already written (GoTrue does it through the
 * cookie-bound client), and the membership row is bound to the Supabase
 * account. The caller is then sent to set a password.
 *
 * ── Binding the account to the membership ────────────────────────────────
 * `school_users.auth_user_id` is null until this moment: a row can represent an
 * invited person who has never signed in. This is where the invitation stops
 * being a promise and becomes an account.
 *
 * The update is guarded on the row still being unbound *or* already bound to
 * this same account. Re-running the flow — a lost password, a second device —
 * is therefore harmless, but the row cannot be re-pointed at a different
 * account by someone who later gains control of the address. Rebinding is an
 * administrative act and does not belong on an unauthenticated endpoint.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface VerifyBody {
  email?: unknown;
  code?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const locationId = request.headers.get(SCHOOL_LOCATION_HEADER);
    if (locationId === null || locationId === '') {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const body = await readJsonBody<VerifyBody>(request);
    const email = normaliseEmail(typeof body?.email === 'string' ? body.email : '');
    const code = typeof body?.code === 'string' ? body.code.trim() : '';

    if (email === '' || code === '') {
      return apiFailure('invalid_body', 'Enter the code sent to your email.', 400);
    }

    const user = await verifyEmailOtp(email, code);

    // Wrong and expired are not distinguished: knowing which one it was only
    // helps someone guessing.
    if (user === null) {
      return apiFailure('otp_invalid', 'That code is incorrect or has expired.', 401);
    }

    const bound = await db
      .update(schoolUsers)
      .set({ authUserId: user.id, joinedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schoolUsers.locationId, locationId),
          eq(schoolUsers.email, email),
          eq(schoolUsers.isActive, true),
          // Unbound, or already this account. See the docblock.
          or(isNull(schoolUsers.authUserId), eq(schoolUsers.authUserId, user.id)),
        ),
      )
      .returning({ id: schoolUsers.id });

    if (bound.length === 0) {
      // The address verified, but it is not an active member here — or the row
      // belongs to a different account. Either way this session must not
      // survive: the cookie GoTrue just wrote would otherwise be a valid
      // credential with nothing behind it.
      await signOutCurrentSession();
      return apiFailure('otp_invalid', 'That code is incorrect or has expired.', 401);
    }

    return apiSuccess({ verified: true, setPasswordRequired: true });
  } catch (error) {
    return handleApiError(error);
  }
}
