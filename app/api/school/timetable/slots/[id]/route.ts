import { and, eq, ne } from 'drizzle-orm';

import { slotTimeProblem, timetableSlots } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getTimetableSlot } from '@/lib/academics-queries';
import { db } from '@/lib/drizzle';
import { isUuid, readBoolean, readString } from '@/lib/validation';

/**
 * /api/school/timetable/slots/[id]
 *
 * GET    one period
 * PUT    change its name, times, position or kind
 * DELETE retire it
 *
 * DELETE is a soft delete: timetable entries reference the slot, and dropping
 * the row would orphan every lesson taught in that period.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { id } = await context.params;
      if (!isUuid(id)) return apiFailure('not_found', 'Period not found.', 404);

      const slot = await getTimetableSlot(auth.locationId, id);
      if (slot === null) return apiFailure('not_found', 'Period not found.', 404);

      return apiSuccess({ slot });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.read' },
);

interface UpdateSlotBody {
  name?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  isBreak?: unknown;
  orderIndex?: unknown;
  isActive?: unknown;
}

export const PUT = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { id } = await context.params;
      if (!isUuid(id)) return apiFailure('not_found', 'Period not found.', 404);

      const existing = await getTimetableSlot(auth.locationId, id);
      if (existing === null) return apiFailure('not_found', 'Period not found.', 404);

      const body = await readJsonBody<UpdateSlotBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof timetableSlots.$inferInsert> = {};

      if (body.name !== undefined) {
        const name = readString(body.name);
        if (name === '' || name.length > 60) {
          return apiFailure(
            'invalid_body',
            'Enter a period name of 60 characters or fewer.',
            400,
          );
        }
        updates.name = name;
      }

      // Times are validated as a pair even when only one of them is being
      // changed, so an edit cannot leave a period ending before it starts.
      if (body.startTime !== undefined || body.endTime !== undefined) {
        const startTime =
          body.startTime === undefined ? existing.startTime : readString(body.startTime);
        const endTime =
          body.endTime === undefined ? existing.endTime : readString(body.endTime);

        const timeProblem = slotTimeProblem(startTime, endTime);
        if (timeProblem !== null) {
          return apiFailure('invalid_body', timeProblem, 400);
        }

        updates.startTime = startTime;
        updates.endTime = endTime;
      }

      if (body.isBreak !== undefined) {
        updates.isBreak = readBoolean(body.isBreak, existing.isBreak);
      }

      if (body.orderIndex !== undefined) {
        const orderIndex = Number(body.orderIndex);
        if (!Number.isInteger(orderIndex) || orderIndex < 0 || orderIndex > 99) {
          return apiFailure(
            'invalid_body',
            'The position must be a whole number between 0 and 99.',
            400,
          );
        }

        const clash = await db
          .select({ id: timetableSlots.id })
          .from(timetableSlots)
          .where(
            and(
              eq(timetableSlots.locationId, auth.locationId),
              eq(timetableSlots.orderIndex, orderIndex),
              ne(timetableSlots.id, id),
            ),
          )
          .limit(1);

        if (clash[0] !== undefined) {
          return apiFailure(
            'duplicate',
            `Another period already sits at position ${orderIndex}.`,
            409,
          );
        }

        updates.orderIndex = orderIndex;
      }

      if (body.isActive !== undefined) {
        updates.isActive = readBoolean(body.isActive, existing.isActive);
      }

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      updates.updatedAt = new Date();

      await db
        .update(timetableSlots)
        .set(updates)
        .where(
          and(eq(timetableSlots.locationId, auth.locationId), eq(timetableSlots.id, id)),
        );

      return apiSuccess({ slot: await getTimetableSlot(auth.locationId, id) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { id } = await context.params;
      if (!isUuid(id)) return apiFailure('not_found', 'Period not found.', 404);

      const retired = await db
        .update(timetableSlots)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(eq(timetableSlots.locationId, auth.locationId), eq(timetableSlots.id, id)),
        )
        .returning({ id: timetableSlots.id });

      if (retired[0] === undefined) {
        return apiFailure('not_found', 'Period not found.', 404);
      }

      return apiSuccess({ slotId: retired[0].id });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.write' },
);
