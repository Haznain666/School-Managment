import { slotTimeProblem, timetableSlots } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  getDefaultPeriodStructure,
  getPeriodStructure,
  listTimetableSlots,
} from '@/lib/academics-queries';
import { db } from '@/lib/drizzle';
import { isUuid, readBoolean, readString } from '@/lib/validation';

/**
 * /api/school/timetable/slots
 *
 * GET  the periods of one bell schedule, in the order the day runs
 * POST add a period or a break to one
 *
 * `orderIndex` is unique **per structure**, not per school, and that is the
 * whole point of period structures: two slots claiming position 3 inside one
 * schedule would make its rows arbitrary, but position 3 of the junior day and
 * position 3 of the senior day are different periods at different times. Under
 * the old school-wide index the second schedule a school entered was refused as
 * a duplicate of the first.
 *
 * `periodStructureId` is optional on both verbs and falls back to the school's
 * default. That keeps a school with one bell exactly where it was — it never
 * names a structure and never needs to know one exists.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const activeOnly = url.searchParams.get('activeOnly') === 'true';
      const requested = url.searchParams.get('periodStructureId');

      // An explicit `all` asks for every structure at once, which the
      // management screen wants and no grid does.
      if (requested === 'all') {
        return apiSuccess({
          slots: await listTimetableSlots(auth.locationId, { activeOnly }),
        });
      }

      const structure =
        requested !== null && isUuid(requested)
          ? await getPeriodStructure(auth.locationId, requested)
          : await getDefaultPeriodStructure(auth.locationId);

      if (structure === null) {
        // Not a 404: a school that has never entered a bell schedule is
        // correctly configured on its first day, and the screen that asked
        // needs an empty list, not an error.
        return apiSuccess({ slots: [], structure: null });
      }

      return apiSuccess({
        slots: await listTimetableSlots(auth.locationId, {
          activeOnly,
          periodStructureId: structure.id,
        }),
        structure,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.read' },
);

interface CreateSlotBody {
  periodStructureId?: unknown;
  name?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  isBreak?: unknown;
  orderIndex?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateSlotBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const name = readString(body.name);
      if (name === '' || name.length > 60) {
        return apiFailure(
          'invalid_body',
          'Enter a period name of 60 characters or fewer.',
          400,
        );
      }

      const startTime = readString(body.startTime);
      const endTime = readString(body.endTime);

      const timeProblem = slotTimeProblem(startTime, endTime);
      if (timeProblem !== null) {
        return apiFailure('invalid_body', timeProblem, 400);
      }

      const orderIndex = Number(body.orderIndex);
      if (!Number.isInteger(orderIndex) || orderIndex < 0 || orderIndex > 99) {
        return apiFailure(
          'invalid_body',
          'The position must be a whole number between 0 and 99.',
          400,
        );
      }

      // Re-read from this tenant rather than trusted from the body, so a
      // structure id belonging to another school cannot take a period.
      const structure =
        typeof body.periodStructureId === 'string' && isUuid(body.periodStructureId)
          ? await getPeriodStructure(auth.locationId, body.periodStructureId)
          : await getDefaultPeriodStructure(auth.locationId);

      if (structure === null) {
        return apiFailure(
          'no_structure',
          'This school has no period schedule to add to. Create one first.',
          409,
        );
      }

      const created = await db
        .insert(timetableSlots)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          periodStructureId: structure.id,
          name,
          startTime,
          endTime,
          isBreak: readBoolean(body.isBreak, false),
          orderIndex,
        })
        .onConflictDoNothing({
          target: [timetableSlots.periodStructureId, timetableSlots.orderIndex],
        })
        .returning({ id: timetableSlots.id });

      if (created[0] === undefined) {
        return apiFailure(
          'duplicate',
          `Another period in “${structure.name}” already sits at position ${orderIndex}.`,
          409,
        );
      }

      return apiSuccess({ slotId: created[0].id }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.write' },
);
