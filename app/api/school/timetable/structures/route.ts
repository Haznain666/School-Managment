import { eq } from 'drizzle-orm';

import { periodStructures } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  listPeriodStructures,
  listStructureGradeAssignments,
  listTimetableSlots,
} from '@/lib/academics-queries';
import { db } from '@/lib/drizzle';
import { readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/timetable/structures
 *
 * GET  every bell schedule, its periods and the grades assigned to it
 * POST add a schedule
 *
 * ── One request, not three ───────────────────────────────────────────────
 * The management screen needs structures, their slots and their grade
 * assignments together, and it cannot draw any of them alone: a structure with
 * no periods listed under it looks like an empty school. Three round trips to
 * Supabase measured ~2.4 seconds each from a developer machine (§5q), so they
 * are issued in parallel and returned as one payload.
 *
 * ── The first structure a school creates is its default ──────────────────
 * Not a checkbox on the form. A school arriving here has either a "Standard"
 * structure from the migration or nothing at all, and in the second case
 * refusing to mark the first one default would leave every grade pointing at
 * nothing — the empty-grid state the fallback exists to prevent. Which
 * structure is default is changed afterwards, deliberately, on the row itself.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const [structures, slots, assignments] = await Promise.all([
        listPeriodStructures(auth.locationId),
        listTimetableSlots(auth.locationId),
        listStructureGradeAssignments(auth.locationId),
      ]);

      return apiSuccess({ structures, slots, assignments });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.read' },
);

interface CreateStructureBody {
  name?: unknown;
  description?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateStructureBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const name = readString(body.name);
      if (name === '' || name.length > 60) {
        return apiFailure(
          'invalid_body',
          'Give the schedule a name of 60 characters or fewer, for example “Junior school”.',
          400,
        );
      }

      const description = readOptionalString(body.description);
      if (description !== null && description.length > 200) {
        return apiFailure(
          'invalid_body',
          'Keep the description to 200 characters or fewer.',
          400,
        );
      }

      const existing = await db
        .select({ id: periodStructures.id })
        .from(periodStructures)
        .where(eq(periodStructures.locationId, auth.locationId))
        .limit(1);

      const created = await db
        .insert(periodStructures)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          name,
          description,
          isDefault: existing[0] === undefined,
        })
        // The name is unique per school. Leaning on the index rather than on the
        // check above: two admins adding "Senior school" at the same moment
        // would both pass a check, and only the constraint can decide.
        .onConflictDoNothing({
          target: [periodStructures.locationId, periodStructures.name],
        })
        .returning({ id: periodStructures.id });

      if (created[0] === undefined) {
        return apiFailure(
          'duplicate',
          `Your school already has a schedule called “${name}”.`,
          409,
        );
      }

      return apiSuccess({ structureId: created[0].id }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.write' },
);
