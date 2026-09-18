import { and, eq } from 'drizzle-orm';

import { timetableEntries } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { liveTimetableEntries } from '@/lib/timetable-history';
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
 *
 * ── Sprint 33c: it deletes the live version and only the live version ────
 * `0049` made a cell a series of versions rather than a single row, and every
 * screen returns the live one — so an id that names a *superseded* row can only
 * have come from somewhere it should not have. The predicate is here so that
 * such a request is a 404 rather than a silent deletion of the record of who
 * taught the class in March, which is the one thing this sprint exists to stop.
 *
 * Clearing a cell still removes the standing lesson outright rather than
 * closing it. A cell that has been emptied has no successor to point at, and a
 * closed-but-never-replaced row would be a version of nothing.
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
            liveTimetableEntries(),
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
