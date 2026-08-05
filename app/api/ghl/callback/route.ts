import { NextResponse, type NextRequest } from 'next/server';

import { exchangeGhlAuthorizationCode } from '@/lib/ghl-client';
import { GhlTokenError, deleteGhlTokens } from '@/lib/ghl-tokens';
import {
  decodeOAuthState,
  nonceMatches,
  oauthStateCookieOptions,
  GHL_OAUTH_STATE_COOKIE,
} from '@/lib/ghl-oauth';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * GET /api/ghl/callback
 *
 * Where GoHighLevel returns the operator after they authorise the install.
 * This is the route that was missing: `exchangeGhlAuthorizationCode` has always
 * been able to write `ghl_tokens`, but nothing ever called it, so the table
 * could never receive a first row for any school.
 *
 * Lives at a fixed path rather than under the school, because `redirect_uri`
 * has to match the value registered on the marketplace app byte for byte and
 * cannot carry a school id. The school travels in the state cookie instead.
 *
 * Not under `/api/super-admin/`, so middleware does not guard it — the guard is
 * `requireSuperAdmin()` below, which is the same check made explicit. An
 * unauthenticated hit on this URL must not be able to attach a GHL account to
 * anything.
 *
 * Ends in a redirect rather than JSON: the browser is here as a top-level
 * navigation and the operator needs to land back on a page.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sends the operator back to a page that can explain what happened. */
function back(request: NextRequest, schoolId: string | null, status: string) {
  const target = new URL(
    schoolId === null ? '/super-admin/schools' : `/super-admin/schools/${schoolId}`,
    request.nextUrl.origin,
  );
  target.searchParams.set('ghl', status);

  const response = NextResponse.redirect(target);
  // The state is single-use whatever the outcome.
  response.cookies.set({ ...oauthStateCookieOptions(0), value: '' });
  return response;
}

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const code = request.nextUrl.searchParams.get('code');
    const returnedState = request.nextUrl.searchParams.get('state');

    // GHL sends `error` instead of `code` when the operator declines.
    const declined = request.nextUrl.searchParams.get('error');
    if (declined !== null && declined !== '') {
      return back(request, null, 'declined');
    }

    const rawCookie = request.cookies.get(GHL_OAUTH_STATE_COOKIE)?.value;
    const state = rawCookie === undefined ? null : decodeOAuthState(rawCookie);

    if (state === null || returnedState === null || returnedState === '') {
      // No cookie means the install did not start here, or took longer than the
      // state's lifetime. Either way this request cannot be trusted.
      return back(request, null, 'state_missing');
    }

    if (!nonceMatches(returnedState, state.nonce)) {
      return back(request, state.schoolId, 'state_mismatch');
    }

    if (code === null || code === '') {
      return back(request, state.schoolId, 'no_code');
    }

    let tokens;
    try {
      tokens = await exchangeGhlAuthorizationCode(code);
    } catch (error) {
      console.error(
        '[ghl-callback] authorization code exchange failed:',
        error instanceof Error ? error.message : error,
      );
      return back(request, state.schoolId, 'exchange_failed');
    }

    /**
     * The operator picks the sub-account on GHL's screen, so the location they
     * chose may not be the one this school is configured for. Writing the
     * tokens anyway would connect the wrong school and be invisible until mail
     * went out under someone else's brand.
     *
     * `exchangeGhlAuthorizationCode` has already persisted the row keyed by the
     * location GHL returned, so the correction is to delete it again.
     */
    if (tokens.locationId !== state.locationId) {
      await deleteGhlTokens(tokens.locationId);
      console.warn(
        `[ghl-callback] location mismatch: expected ${state.locationId}, operator chose ${tokens.locationId}`,
      );
      return back(request, state.schoolId, 'location_mismatch');
    }

    return back(request, state.schoolId, 'connected');
  } catch (error) {
    // A GhlTokenError here means the environment is missing GHL_CLIENT_ID or
    // similar; anything else is unexpected. Both belong in the log, and the
    // operator gets a page rather than a stack trace.
    console.error(
      '[ghl-callback] unhandled:',
      error instanceof GhlTokenError ? error.message : error,
    );
    return back(request, null, 'failed');
  }
}
