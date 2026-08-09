import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { deleteSchoolMember, listSchoolUsersByIds } from '@/lib/school-queries';
import { resolveLocationId } from '@/lib/schools';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import {
  deletionSummary,
  MAX_BULK_DELETE,
  referencedExplanation,
  type DeletionOutcome,
} from '@/lib/user-deletion';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/super-admin/schools/[schoolId]/users/bulk-delete
 *
 * The platform operator's equivalent of the school portal's bulk delete, and it
 * shares that route's shape for the same reasons: one statement per row because
 * `NO ACTION` foreign keys make a single `IN (...)` all-or-nothing, and a
 * partial result reported per row rather than as a failure.
 *
 * What it deliberately does **not** share are the policy guards in
 * `lib/school-user-policy.ts`. A school administrator is stopped from deleting
 * themselves or the school's last administrator because they cannot undo
 * either from inside the portal. The operator here is the person who *is* the
 * recovery path, and refusing them would only mean doing it in SQL instead.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string }> };

interface BulkDeleteBody {
  userIds?: unknown;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) return apiFailure('not_found', 'School not found.', 404);

    const locationId = await resolveLocationId(schoolId);
    if (locationId === null) return apiFailure('not_found', 'School not found.', 404);

    const body = await readJsonBody<BulkDeleteBody>(request);
    if (body === null || !Array.isArray(body.userIds)) {
      return apiFailure('invalid_body', 'Expected { userIds: string[] }.', 400);
    }

    const requested = [...new Set(body.userIds.filter((id): id is string => isUuid(id)))];

    if (requested.length === 0) {
      return apiFailure('invalid_body', 'Select at least one user.', 400);
    }

    if (requested.length > MAX_BULK_DELETE) {
      return apiFailure(
        'invalid_body',
        `Delete at most ${MAX_BULK_DELETE} users at a time.`,
        400,
      );
    }

    // Scoped to this school, so an id from another school's list cannot be
    // deleted through this school's URL.
    const members = await listSchoolUsersByIds(locationId, requested);
    const found = new Map(members.map((member) => [member.id, member]));

    const outcomes: DeletionOutcome[] = [];

    for (const id of requested) {
      const member = found.get(id);

      if (member === undefined) {
        outcomes.push({
          id,
          name: 'Unknown user',
          deleted: false,
          reason: 'That user is not a member of this school.',
        });
        continue;
      }

      const result = await deleteSchoolMember(locationId, id);

      outcomes.push(
        result.deleted
          ? { id, name: member.name, deleted: true, reason: null }
          : {
              id,
              name: member.name,
              deleted: false,
              reason:
                result.refusal === 'referenced'
                  ? referencedExplanation(member.name)
                  : 'That user is not a member of this school.',
            },
      );
    }

    return apiSuccess({
      outcomes,
      deleted: outcomes.filter((outcome) => outcome.deleted).length,
      summary: deletionSummary(outcomes),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
