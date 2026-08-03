import { and, eq, ne } from 'drizzle-orm';

import { isHexColor, subjects } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getSubject } from '@/lib/academics-queries';
import { db } from '@/lib/drizzle';
import { isUuid, readBoolean, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/subjects/[id]
 *
 * GET    one subject
 * PUT    rename it, recolour it, or restore it
 * DELETE retire it
 *
 * DELETE is a soft delete. Timetable entries — and, later, marks — reference a
 * subject, so removing the row would take the meaning of an existing schedule
 * with it. Retiring keeps it off new timetables while leaving the old ones
 * readable.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { id } = await context.params;
      if (!isUuid(id)) return apiFailure('not_found', 'Subject not found.', 404);

      const subject = await getSubject(auth.locationId, id);
      if (subject === null) return apiFailure('not_found', 'Subject not found.', 404);

      return apiSuccess({ subject });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.read' },
);

interface UpdateSubjectBody {
  name?: unknown;
  code?: unknown;
  color?: unknown;
  isActive?: unknown;
}

export const PUT = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { id } = await context.params;
      if (!isUuid(id)) return apiFailure('not_found', 'Subject not found.', 404);

      const existing = await getSubject(auth.locationId, id);
      if (existing === null) return apiFailure('not_found', 'Subject not found.', 404);

      const body = await readJsonBody<UpdateSubjectBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof subjects.$inferInsert> = {};

      if (body.name !== undefined) {
        const name = readString(body.name);
        if (name === '' || name.length > 80) {
          return apiFailure(
            'invalid_body',
            'Enter a subject name of 80 characters or fewer.',
            400,
          );
        }

        // The unique index would raise a 500 on a rename collision, so the
        // clash is looked up first and reported as a 409.
        const clash = await db
          .select({ id: subjects.id })
          .from(subjects)
          .where(
            and(
              eq(subjects.locationId, auth.locationId),
              eq(subjects.name, name),
              ne(subjects.id, id),
            ),
          )
          .limit(1);

        if (clash[0] !== undefined) {
          return apiFailure(
            'duplicate',
            `Your school already teaches a subject called "${name}".`,
            409,
          );
        }

        updates.name = name;
      }

      if (body.code !== undefined) {
        const code = readOptionalString(body.code);
        if (code !== null && code.length > 12) {
          return apiFailure('invalid_body', 'Use a code of 12 characters or fewer.', 400);
        }
        updates.code = code;
      }

      if (body.color !== undefined) {
        const color = readOptionalString(body.color);
        if (color !== null && !isHexColor(color)) {
          return apiFailure('invalid_body', 'Choose a colour from the palette.', 400);
        }
        updates.color = color;
      }

      if (body.isActive !== undefined) {
        updates.isActive = readBoolean(body.isActive, existing.isActive);
      }

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      updates.updatedAt = new Date();

      await db
        .update(subjects)
        .set(updates)
        .where(and(eq(subjects.locationId, auth.locationId), eq(subjects.id, id)));

      return apiSuccess({ subject: await getSubject(auth.locationId, id) });
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
      if (!isUuid(id)) return apiFailure('not_found', 'Subject not found.', 404);

      const retired = await db
        .update(subjects)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(subjects.locationId, auth.locationId), eq(subjects.id, id)))
        .returning({ id: subjects.id });

      if (retired[0] === undefined) {
        return apiFailure('not_found', 'Subject not found.', 404);
      }

      return apiSuccess({ subjectId: retired[0].id });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'academics.write' },
);
