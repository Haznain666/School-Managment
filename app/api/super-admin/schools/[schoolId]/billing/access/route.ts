import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { blockSchool, unblockSchool } from '@/lib/platform-billing-queries';
import { resolveLocationId } from '@/lib/schools';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/super-admin/schools/[schoolId]/billing/access — Sprint 35, §2.
 *
 * `{ action: 'block' | 'unblock' }`. The manual half of what the blocking sweep
 * does automatically, through the same two functions — so a manual block is
 * claimed the same way, recorded in `school_access_events` the same way, and
 * emails the school administrator the same way.
 *
 * Asking for the state a school is already in is not an error: the answer says
 * nothing changed, and nobody is emailed twice.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSuperAdmin('billing', 'u');

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) return apiFailure('not_found', 'School not found.', 404);

    const locationId = await resolveLocationId(schoolId);
    if (locationId === null) return apiFailure('not_found', 'School not found.', 404);

    const body = await readJsonBody<{ action?: unknown }>(request);
    if (body?.action !== 'block' && body?.action !== 'unblock') {
      return apiFailure('invalid_body', 'Expected { action: "block" | "unblock" }.', 400);
    }

    const changed =
      body.action === 'block'
        ? await blockSchool(locationId, 'manual', actor.email)
        : await unblockSchool(locationId, 'manual', actor.email);

    return apiSuccess({ action: body.action, changed });
  } catch (error) {
    return handleApiError(error);
  }
}
