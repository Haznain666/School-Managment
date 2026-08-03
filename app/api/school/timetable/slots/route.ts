import { slotTimeProblem, timetableSlots } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { listTimetableSlots } from '@/lib/academics-queries';
import { db } from '@/lib/drizzle';
import { readBoolean, readString } from '@/lib/validation';

/**
 * /api/school/timetable/slots
 *
 * GET  the school's bell schedule, in the order the day runs
 * POST add a period or a break
 *
 * `orderIndex` is unique per school because it is what orders the grid: two
 * slots claiming position 3 would make the rows of every timetable arbitrary,
 * so the insert leans on the index and reports the clash as a 409.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const activeOnly = url.searchParams.get('activeOnly') === 'true';

      return apiSuccess({ slots: await listTimetableSlots(auth.locationId, { activeOnly }) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.read' },
);

interface CreateSlotBody {
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

      const created = await db
        .insert(timetableSlots)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          name,
          startTime,
          endTime,
          isBreak: readBoolean(body.isBreak, false),
          orderIndex,
        })
        .onConflictDoNothing({
          target: [timetableSlots.locationId, timetableSlots.orderIndex],
        })
        .returning({ id: timetableSlots.id });

      if (created[0] === undefined) {
        return apiFailure(
          'duplicate',
          `Another period already sits at position ${orderIndex}.`,
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
