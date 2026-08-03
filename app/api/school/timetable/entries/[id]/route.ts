import { and, eq } from 'drizzle-orm';

import { timetableEntries } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/timetable/entries/[id]
 *
 * DELETE clears one cell of the grid.
 *
 * Unlike subjects and periods this is a hard delete: nothing references a
 * timetable entry, and an emptied cell has no history worth keeping — a
 * soft-deleted row would only have to be excluded from every read and would
 * still occupy the unique key the next save needs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { id } = await context.params;
      if (!isUuid(id)) return apiFailure('not_found', 'Lesson not found.', 404);

      const removed = await db
        .delete(timetableEntries)
        .where(
          and(
            eq(timetableEntries.locationId, auth.locationId),
            eq(timetableEntries.id, id),
          ),
        )
        .returning({ id: timetableEntries.id });

      if (removed[0] === undefined) {
        return apiFailure('not_found', 'Lesson not found.', 404);
      }

      return apiSuccess({ entryId: removed[0].id });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.write' },
);
