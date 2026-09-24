import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  createLoginHandoff,
  membershipsFor,
  verifyChooserToken,
} from '@/lib/central-signin';
import { buildHandoffUrl } from '@/lib/platform-school-access';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/platform/handoff — the entity chooser's second step. §7.3.
 *
 * `{ chooserToken, schoolId }`. The chooser token proves the password was
 * right a few minutes ago; the membership is re-read **now**, so a school
 * picked from a list that was correct five minutes ago but has since
 * deactivated this person is refused. Answers with the single-use hand-off URL
 * on that school's own address.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody<{ chooserToken?: unknown; schoolId?: unknown }>(request);
    const chooserToken = typeof body?.chooserToken === 'string' ? body.chooserToken : '';
    const schoolId = typeof body?.schoolId === 'string' ? body.schoolId : '';

    const who = chooserToken === '' ? null : await verifyChooserToken(chooserToken);
    if (who === null) {
      return apiFailure('expired', 'That sign-in has expired. Sign in again.', 401);
    }
    if (!isUuid(schoolId)) return apiFailure('not_found', 'Choose a school from the list.', 400);

    const membership = (await membershipsFor(who.id)).find((entry) => entry.schoolId === schoolId);
    if (membership === undefined) {
      return apiFailure('not_member', 'You no longer have access to that school.', 403);
    }

    const token = await createLoginHandoff({
      locationId: membership.locationId,
      authUserId: who.id,
      email: who.email,
    });

    return apiSuccess({
      url: buildHandoffUrl(
        token,
        membership.slug,
        request.headers.get('host') ?? '',
        new URL(request.url).protocol,
        'handoff',
      ),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
