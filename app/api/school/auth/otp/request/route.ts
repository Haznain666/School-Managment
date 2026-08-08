import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolUsers } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  checkThrottle,
  clientIpHash,
  recordAttempt,
  throttledResponse,
} from '@/lib/auth-throttle';
import { db } from '@/lib/drizzle';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';
import { normaliseEmail, sendEmailOtp } from '@/lib/supabase-auth';

/**
 * POST /api/school/auth/otp/request — send a six-digit code to an address.
 *
 * This is the signup half of the flow: someone who has been invited proves the
 * address is theirs, then sets a password at
 * `/api/school/auth/password`. After that they use `/api/school/auth/login`
 * and never see a code again.
 *
 * ── What changed ─────────────────────────────────────────────────────────
 * The path is the same one WhatsApp passcode login used, and the shape of the
 * exchange is deliberately unchanged so the login screen did not have to be
 * rebuilt around it. Everything underneath is different: the code goes to an
 * email address instead of a handset, and GoTrue generates, stores, expires
 * and rate-limits it. `lib/otp.ts` and its `otp_sessions` table are no longer
 * on this path at all.
 *
 * ── Why it always answers the same way ───────────────────────────────────
 * A code is only sent to an address that is already an active member of *this*
 * school. But the response does not say so: an endpoint that reported
 * "unknown address" would let anyone enumerate a school's staff. Both cases
 * return the same success, and only one of them sends mail.
 *
 * ── Why the throttle counts successes here, unlike login ─────────────────
 * This endpoint answers "sent" unconditionally, by design, so it has no
 * failures to count — a limiter watching only failures would leave it with no
 * limit at all. Here the volume *is* the harm: every call that lands on a real
 * member costs an SMTP send and puts a code in somebody's inbox, and a script
 * pointed at one address could otherwise fill a mailbox indefinitely. So every
 * request counts, on both axes, and the refusal is the same 429 whether the
 * address is a member, a stranger, or nonsense — the check happens before the
 * `school_users` read for exactly that reason.
 *
 * `shouldCreateUser` is true because an invited member may have no Supabase
 * account yet — this is exactly the request that creates it. It is safe here
 * *because* of the membership check above; without that, this endpoint would
 * create an account for any address anyone typed.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  email?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const locationId = request.headers.get(SCHOOL_LOCATION_HEADER);
    if (locationId === null || locationId === '') {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const body = await readJsonBody<RequestBody>(request);
    const raw = typeof body?.email === 'string' ? body.email : '';
    const email = normaliseEmail(raw);

    if (email === '' || !email.includes('@')) {
      return apiFailure('invalid_body', 'Enter a valid email address.', 400);
    }

    const ipHash = clientIpHash(request);
    const throttle = await checkThrottle('otp_request', email, ipHash);
    if (!throttle.allowed) return throttledResponse(throttle);

    await recordAttempt('otp_request', email, ipHash, true);

    const rows = await db
      .select({ isActive: schoolUsers.isActive })
      .from(schoolUsers)
      .where(and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.email, email)))
      .limit(1);

    const member = rows[0];

    if (member !== undefined && member.isActive) {
      await sendEmailOtp(email, true);
    }

    // Same answer either way. See the docblock.
    return apiSuccess({ sent: true });
  } catch (error) {
    return handleApiError(error);
  }
}
