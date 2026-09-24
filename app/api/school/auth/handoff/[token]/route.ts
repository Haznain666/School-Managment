import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { activeMembershipAt, redeemLoginHandoff } from '@/lib/central-signin';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';
import { mintSessionForEmail } from '@/lib/supabase-auth';
import { homeRouteForRole } from '@/types/school-auth';

/**
 * POST /api/school/auth/handoff/[token] — the apex sign-in, arriving. §7.4.
 *
 * Unauthenticated by definition: the token is the credential, as it is for the
 * operator's hand-off and the emergency link beside it. What makes it safe:
 *
 *   · it is **claimed** — one conditional `UPDATE … RETURNING` — so it signs
 *     somebody in once, ever, and a replay gets nothing;
 *   · it lives sixty seconds;
 *   · it names one school, and is refused at any other school's address;
 *   · the membership is re-read here, so a person deactivated between the apex
 *     form and this request is refused.
 *
 * On success the school's own session cookie is written by
 * `mintSessionForEmail` — on this host, which is the whole reason for the
 * hop — and the answer says where that role's portal starts.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ token: string }> };

const REFUSAL = 'This sign-in link is invalid or has expired. Sign in again.';

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;

    const locationId = request.headers.get(SCHOOL_LOCATION_HEADER);
    if (locationId === null || locationId === '') {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const handoff = await redeemLoginHandoff(token, locationId);
    if (handoff === null) return apiFailure('invalid_token', REFUSAL, 401);

    const membership = await activeMembershipAt(locationId, handoff.authUserId);
    if (membership === null) return apiFailure('invalid_token', REFUSAL, 401);

    await mintSessionForEmail(handoff.email);

    return apiSuccess({ redirectTo: homeRouteForRole(membership.role) });
  } catch (error) {
    return handleApiError(error);
  }
}
