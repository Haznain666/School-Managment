import { apiSuccess, handleApiError } from '@/lib/api-response';
import { endSchoolSession, readSchoolSession } from '@/lib/school-auth';

/**
 * POST /api/school/auth/logout
 *
 * Revokes the account's refresh tokens, then clears the cookie. Revoking
 * matters: without it the session would keep working on other devices until it
 * expired on its own.
 *
 * Being honest about the gap this leaves — an access token already issued
 * stays valid until it expires, up to an hour, because GoTrue has no
 * equivalent of Firebase's revocation check. That gap is covered by
 * `isAccountActive` in `lib/school-auth.ts`, which re-reads the membership on
 * every request; see the note there.
 *
 * Signing out while already signed out is not an error.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const claims = await readSchoolSession();
    await endSchoolSession(claims?.uid ?? null);

    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
