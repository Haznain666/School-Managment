import { and, eq } from 'drizzle-orm';

import { staffCalendarOverrides } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { resolveBranchScope } from '@/lib/branch-scope';
import {
  calendarWriteRefusal,
  getStaffCalendar,
  listCalendarOverrides,
} from '@/lib/staff-calendar-queries';
import { isUuid, readBoolean } from '@/lib/validation';

/**
 * /api/school/staff-calendars/[calendarId]/overrides/[overrideId]
 *
 * PATCH  record that the people it applies to have now been told
 * DELETE undo the override — the holiday applies to them again
 *
 * ── Why "told" is written here and sent somewhere else ───────────────────
 * The announcement is `POST /api/school/holidays/[holidayId]/notify`, which is
 * the one delivery path in this product and stays that way. What it cannot do
 * is know that a *staff calendar override* was the reason, so the screen fires
 * that route and then marks the override here. The two are deliberately not
 * one call: a failed send must not leave a row claiming the school was told,
 * and a successful send must not be undone by a bookkeeping write that failed
 * after it.
 *
 * DELETE removes the override only. The `holidays` row it points at is left
 * alone — one of them may be Independence Day, and a calendar screen must not
 * be able to delete a national holiday from every other calendar in the school.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ calendarId: string; overrideId: string }> };

interface PatchOverrideBody {
  /** True once the announcement has actually gone out. */
  markNotified?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { calendarId, overrideId } = await context.params;
      if (!isUuid(calendarId) || !isUuid(overrideId)) {
        return apiFailure('not_found', 'Override not found.', 404);
      }

      const calendar = await getStaffCalendar(auth.locationId, calendarId);
      if (calendar === null) {
        return apiFailure('not_found', 'Calendar not found.', 404);
      }

      // The campus, on the write — QA round 1, F2. This route checked none.
      const refusal = calendarWriteRefusal(
        await resolveBranchScope(auth.locationId, auth),
        calendar.branchId,
      );
      if (refusal !== null) return apiFailure('forbidden', refusal, 403);

      const body = await readJsonBody<PatchOverrideBody>(request);
      if (body === null || !readBoolean(body.markNotified, false)) {
        return apiFailure('invalid_body', 'Nothing to change.', 400);
      }

      const updated = await db
        .update(staffCalendarOverrides)
        .set({ notify: true, notifiedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(staffCalendarOverrides.locationId, auth.locationId),
            eq(staffCalendarOverrides.calendarId, calendarId),
            eq(staffCalendarOverrides.id, overrideId),
          ),
        )
        .returning({ id: staffCalendarOverrides.id });

      if (updated[0] === undefined) {
        return apiFailure('not_found', 'Override not found.', 404);
      }

      return apiSuccess({
        overrides: await listCalendarOverrides(auth.locationId, calendarId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.manage' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { calendarId, overrideId } = await context.params;
      if (!isUuid(calendarId) || !isUuid(overrideId)) {
        return apiFailure('not_found', 'Override not found.', 404);
      }

      const calendar = await getStaffCalendar(auth.locationId, calendarId);
      if (calendar === null) {
        return apiFailure('not_found', 'Override not found.', 404);
      }

      const refusal = calendarWriteRefusal(
        await resolveBranchScope(auth.locationId, auth),
        calendar.branchId,
      );
      if (refusal !== null) return apiFailure('forbidden', refusal, 403);

      const deleted = await db
        .delete(staffCalendarOverrides)
        .where(
          and(
            eq(staffCalendarOverrides.locationId, auth.locationId),
            eq(staffCalendarOverrides.calendarId, calendarId),
            eq(staffCalendarOverrides.id, overrideId),
          ),
        )
        .returning({ id: staffCalendarOverrides.id });

      if (deleted[0] === undefined) {
        return apiFailure('not_found', 'Override not found.', 404);
      }

      return apiSuccess({
        overrides: await listCalendarOverrides(auth.locationId, calendarId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.manage' },
);
