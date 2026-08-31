import { and, eq, isNull, or } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolUsers } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { activeMembershipsByEmail } from '@/lib/school-queries';
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

    /*
     * Which membership this address is, resolved before anything is written.
     *
     * The update used to be issued straight at `(location, email)` and took
     * whichever rows matched. At LGS that was **two**: a father's parent row
     * and the directory row of one of his own children, which had been given
     * his address by an upsert that landed on the wrong side of the phone
     * index. Both were updated, the unique auth index allowed exactly one of
     * them to keep his uid, and the one it happened to be was his daughter's —
     * so he signed in with his own address and arrived in the student portal,
     * as her, every time, with four of his five children unreachable by any
     * login he had and nothing on any screen saying so.
     *
     * `0038` makes that impossible by adding the partial unique index on
     * `(location_id, lower(email))`. This is what happens if it ever becomes
     * possible again: more than one active membership on one address is a
     * school's data being wrong in a way no session should paper over, so none
     * is bound and the session goes, exactly as an unknown address does.
     *
     * The lookup itself is in `lib/school-queries.ts` so that
     * `npm run check-sprint21` can execute it. This route cannot be executed by
     * any check script — it redeems a one-time code and writes a session — and
     * a statement that only runs on a path nobody can run in a test is a
     * statement nobody has run.
     */
    const candidates = await activeMembershipsByEmail(locationId, email);

    const membership = candidates.length === 1 ? candidates[0] : undefined;

    const bound =
      membership === undefined
        ? []
        : await db
            .update(schoolUsers)
            .set({ authUserId: user.id, joinedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(schoolUsers.locationId, locationId),
                eq(schoolUsers.id, membership.id),
                // Unbound, or already this account. See the docblock.
                or(isNull(schoolUsers.authUserId), eq(schoolUsers.authUserId, user.id)),
              ),
            )
            .returning({ id: schoolUsers.id });

    if (bound.length === 0) {
      // The address verified, but it is not an active member here, or the row
      // belongs to a different account, or — the case above — more than one
      // membership claims it and there is no honest way to choose. Every one
      // of them ends here: the cookie GoTrue just wrote would otherwise be a
      // valid credential with nothing behind it, or worse, with the wrong
      // person behind it.
      await signOutCurrentSession();
      return apiFailure('otp_invalid', 'That code is incorrect or has expired.', 401);
    }

    return apiSuccess({ verified: true, setPasswordRequired: true });
  } catch (error) {
    return handleApiError(error);
  }
}
