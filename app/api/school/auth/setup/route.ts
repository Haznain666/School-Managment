import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { passwordSetupTokens, schoolUsers } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  checkThrottle,
  clientIpHash,
  recordAttempt,
  throttledResponse,
} from '@/lib/auth-throttle';
import { db } from '@/lib/drizzle';
import { validatePasswordStrength } from '@/lib/password-strength';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';
import {
  getOrCreateAuthUser,
  mintSessionForEmail,
  normaliseEmail,
  setUserPassword,
} from '@/lib/supabase-auth';
import { homeRouteForRole, isUserRole } from '@/types/school-auth';

/**
 * POST /api/school/auth/setup — redeem a setup link and choose a first password.
 *
 * Unauthenticated: the token is the credential. See
 * `db/schema/password-setup-tokens.ts` for what that costs and why it is
 * acceptable.
 *
 * ── One request, not two ─────────────────────────────────────────────────
 * The obvious design is a GET that redeems the link and opens a session, then
 * a separate POST that sets the password. It is the wrong one: mail clients
 * and security scanners follow links in messages, so a GET that consumes a
 * single-use token can be spent before the recipient ever clicks it — and the
 * user would meet an "invalid or expired link" page for a link they had just
 * been sent.
 *
 * So nothing happens on page load. The token is spent here, at the moment the
 * password is submitted, and the session only exists once there is a password
 * behind it.
 *
 * ── Redemption order ─────────────────────────────────────────────────────
 * The token is marked used *first*, in an UPDATE whose WHERE clause still
 * requires it to be unused. Two simultaneous submissions therefore cannot both
 * proceed: the second updates zero rows and is refused. Only then is the
 * account touched.
 *
 * ── The throttle identifier is the token, not an address ─────────────────
 * Every other throttled endpoint counts per email. This one cannot: the address
 * is not known until the token has been looked up, and looking it up first is
 * the work the limiter exists to prevent. The token is the identity being
 * claimed here, so it is what the per-identifier counter keys on.
 *
 * That makes the per-identifier limit almost decorative against a real attack —
 * a guesser sends a *different* token every time and never trips it. The per-IP
 * limit is what actually defends this endpoint, and it is sized for that: 32
 * random bytes is not guessable in thirty attempts a quarter of an hour, which
 * is the point. The identifier counter still earns its place by bounding
 * repeated submissions of one link.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SetupBody {
  token?: unknown;
  password?: unknown;
}

/** One message for every rejection. Distinguishing them only helps a guesser. */
const REJECTED = 'This link is invalid, has expired, or has already been used.';

export async function POST(request: NextRequest) {
  try {
    const locationId = request.headers.get(SCHOOL_LOCATION_HEADER);
    if (locationId === null || locationId === '') {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const body = await readJsonBody<SetupBody>(request);
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (token === '') {
      return apiFailure('invalid_token', REJECTED, 400);
    }

    // Checked before the token is spent, so a weak password does not burn the
    // link and leave the person locked out of a message they cannot re-request.
    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      return apiFailure(
        'weak_password',
        strength.error ?? 'Choose a stronger password.',
        400,
      );
    }

    // After the strength check for the same reason that check comes first: a
    // weak password is the caller's own mistake to correct, not an attempt on
    // anything, and counting it would lock a legitimate person out of a link
    // they cannot re-request.
    const ipHash = clientIpHash(request);
    const throttle = await checkThrottle('setup', token, ipHash);
    if (!throttle.allowed) return throttledResponse(throttle);

    const rows = await db
      .select({
        id: passwordSetupTokens.id,
        schoolUserId: passwordSetupTokens.schoolUserId,
        locationId: passwordSetupTokens.locationId,
      })
      .from(passwordSetupTokens)
      .where(
        and(
          eq(passwordSetupTokens.token, token),
          isNull(passwordSetupTokens.usedAt),
          gt(passwordSetupTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    const record = rows[0];
    if (record === undefined || record.locationId !== locationId) {
      // The only branch a guesser can reach, so it is the only one counted.
      // The states further down — deactivated, already has a password — belong
      // to someone holding a genuine link, and locking them out of it would
      // punish the wrong person.
      await recordAttempt('setup', token, ipHash, false);
      return apiFailure('invalid_token', REJECTED, 404);
    }

    const memberRows = await db
      .select({
        id: schoolUsers.id,
        email: schoolUsers.email,
        role: schoolUsers.role,
        isActive: schoolUsers.isActive,
        authUserId: schoolUsers.authUserId,
      })
      .from(schoolUsers)
      .where(
        and(
          eq(schoolUsers.id, record.schoolUserId),
          eq(schoolUsers.locationId, record.locationId),
        ),
      )
      .limit(1);

    const member = memberRows[0];

    if (member === undefined || !member.isActive) {
      return apiFailure(
        'account_disabled',
        'This account is not active. Contact your school administrator.',
        403,
      );
    }

    if (member.email === null || member.email.trim() === '') {
      return apiFailure('invalid_token', REJECTED, 404);
    }

    // The link is only ever issued to someone who has never signed in, and it
    // is re-checked here rather than trusted from issue time: an account that
    // gained a password in the meantime must go through Forgot Password, which
    // proves the mailbox with a code. Otherwise an old link in an old inbox
    // would outrank the stronger path forever.
    if (member.authUserId !== null) {
      return apiFailure(
        'already_set',
        'This account already has a password. Use “Forgot password?” on the ' +
          'sign-in page to choose a new one.',
        409,
      );
    }

    if (!isUserRole(member.role)) {
      return apiFailure('invalid_role', 'This account has an unrecognised role.', 500);
    }

    // Spend the token before touching the account. The WHERE clause still
    // demands it be unused, so of two simultaneous submissions exactly one
    // updates a row and the other is refused.
    const spent = await db
      .update(passwordSetupTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordSetupTokens.id, record.id),
          isNull(passwordSetupTokens.usedAt),
        ),
      )
      .returning({ id: passwordSetupTokens.id });

    if (spent.length === 0) {
      await recordAttempt('setup', token, ipHash, false);
      return apiFailure('invalid_token', REJECTED, 404);
    }

    await recordAttempt('setup', token, ipHash, true);

    const email = normaliseEmail(member.email);

    /**
     * From here on the token is spent, so any failure would leave the person
     * holding a dead link and no account — unable to retry and unable to
     * explain why. The spend is undone on the way out instead.
     *
     * Undoing it re-opens the double-redemption window this ordering exists to
     * close, but only for a request that has already failed, and only until
     * the link expires. A link that can be retried after a Supabase blip is
     * worth more than a race that requires two simultaneous clicks *and* an
     * outage to matter.
     */
    try {
      const authUser = await getOrCreateAuthUser(email);
      await setUserPassword(authUser.id, password);

      await db
        .update(schoolUsers)
        .set({ authUserId: authUser.id, joinedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schoolUsers.id, member.id),
            eq(schoolUsers.locationId, record.locationId),
            isNull(schoolUsers.authUserId),
          ),
        );

      // Writes the session cookie onto this response, so the browser is signed
      // in by the time it reads the redirect.
      await mintSessionForEmail(email);
    } catch (error) {
      await db
        .update(passwordSetupTokens)
        .set({ usedAt: null })
        .where(eq(passwordSetupTokens.id, record.id));

      throw error;
    }

    return apiSuccess({ redirectTo: homeRouteForRole(member.role) });
  } catch (error) {
    return handleApiError(error);
  }
}
