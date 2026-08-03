import { and, eq } from 'drizzle-orm';

import { grades, gradeLabel } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/grades/[gradeId]
 *
 * GET   one grade
 * PATCH its display name, and nothing else
 *
 * `name` and `sort_order` come from the platform's predefined ladder and are
 * deliberately immutable here: renaming is a display concern, but reordering or
 * inventing a rung would break promotion and cross-school comparison. A school
 * that wants "Grade V" on screen sets `display_name`; the row is still Class 5.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ gradeId: string }> };

async function loadGrade(locationId: string, gradeId: string) {
  const rows = await db
    .select()
    .from(grades)
    .where(and(eq(grades.locationId, locationId), eq(grades.id, gradeId)))
    .limit(1);

  return rows[0] ?? null;
}

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { gradeId } = await context.params;
      if (!isUuid(gradeId)) return apiFailure('not_found', 'Grade not found.', 404);

      const grade = await loadGrade(auth.locationId, gradeId);
      if (grade === null) return apiFailure('not_found', 'Grade not found.', 404);

      return apiSuccess({ grade: { ...grade, label: gradeLabel(grade) } });
    } catch (error) {
      return handleApiError(error);
    }
  },
  {
    permission: 'admissions.read',
  },
);

interface UpdateGradeBody {
  displayName?: unknown;
  isActive?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { gradeId } = await context.params;
      if (!isUuid(gradeId)) return apiFailure('not_found', 'Grade not found.', 404);

      const existing = await loadGrade(auth.locationId, gradeId);
      if (existing === null) return apiFailure('not_found', 'Grade not found.', 404);

      if (auth.branchId !== null && existing.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Grade not found.', 404);
      }

      const body = await readJsonBody<UpdateGradeBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof grades.$inferInsert> = {};

      // An empty string clears the override and falls back to the canonical name.
      if (body.displayName !== undefined) {
        updates.displayName = readOptionalString(body.displayName);
      }
      if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      const updated = await db
        .update(grades)
        .set(updates)
        .where(and(eq(grades.id, gradeId), eq(grades.locationId, auth.locationId)))
        .returning();

      const grade = updated[0];
      if (grade === undefined) return apiFailure('not_found', 'Grade not found.', 404);

      return apiSuccess({ grade: { ...grade, label: gradeLabel(grade) } });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
