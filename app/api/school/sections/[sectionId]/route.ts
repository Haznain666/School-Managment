import { and, eq } from 'drizzle-orm';

import { sections } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getSectionById, sectionHasEnrollments } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { listClassTeacherCandidates } from '@/lib/exam-queries';
import { isUuid, readString } from '@/lib/validation';

/**
 * /api/school/sections/[sectionId]
 *
 * GET    one section, with its live student count
 * PATCH  rename it or change its capacity
 * DELETE only while nothing is enrolled in it
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sectionId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { sectionId } = await context.params;
      if (!isUuid(sectionId)) return apiFailure('not_found', 'Section not found.', 404);

      const section = await getSectionById(auth.locationId, sectionId);
      if (section === null) return apiFailure('not_found', 'Section not found.', 404);

      return apiSuccess({ section });
    } catch (error) {
      return handleApiError(error);
    }
  },
  {
    permission: 'admissions.read',
  },
);

interface UpdateSectionBody {
  name?: unknown;
  capacity?: unknown;
  isActive?: unknown;
  classTeacherId?: unknown;
}

function readCapacity(value: unknown): number | null | undefined {
  if (value === null || value === '') return null;

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) return undefined;

  return parsed;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { sectionId } = await context.params;
      if (!isUuid(sectionId)) return apiFailure('not_found', 'Section not found.', 404);

      const existing = await getSectionById(auth.locationId, sectionId);
      if (existing === null) return apiFailure('not_found', 'Section not found.', 404);

      const body = await readJsonBody<UpdateSectionBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof sections.$inferInsert> = {};

      if (body.name !== undefined) {
        const name = readString(body.name);
        if (name === '' || name.length > 40) {
          return apiFailure('invalid_body', 'Enter a section name of 40 characters or fewer.', 400);
        }
        updates.name = name;
      }

      if (body.capacity !== undefined) {
        const capacity = readCapacity(body.capacity);
        if (capacity === undefined) {
          return apiFailure('invalid_body', 'Capacity must be a whole number between 1 and 500.', 400);
        }

        // Shrinking below the current roll is refused: the students are already
        // sitting in the room, and a capacity that lies is worse than none.
        if (capacity !== null && capacity < existing.studentCount) {
          return apiFailure(
            'invalid_body',
            `${existing.studentCount} students are already enrolled here, so the capacity cannot be lower than that.`,
            400,
          );
        }

        updates.capacity = capacity;
      }

      if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;

      // The class teacher, which is the authority behind every promotion
      // override on this class — see
      // `/api/school/terms/[termId]/sections/[sectionId]/results`. Only staff
      // the school has marked as class teachers may be named, and the
      // candidate list is re-read through a tenant-filtered query because the
      // foreign key alone would accept another school's employee.
      if (body.classTeacherId !== undefined) {
        if (body.classTeacherId === null || body.classTeacherId === '') {
          updates.classTeacherId = null;
        } else {
          if (!isUuid(body.classTeacherId)) {
            return apiFailure('invalid_body', 'Choose a class teacher, or none.', 400);
          }

          /*
           * Scoped to the caller's own campus, exactly as the picker on the
           * GET is.
           *
           * This passed `null` until 2026-08-22 — school-wide — while the GET
           * that builds the dropdown filtered by `auth.branchId`. School-level
           * tenancy held, but the campus boundary did not: a branch admin could
           * PATCH in the id of a class teacher employed at a campus they do not
           * run, and thereby hand that person promotion-override authority over
           * a class of theirs. The picker would never show who it was, because
           * the GET filters them out.
           */
          const candidates = await listClassTeacherCandidates(
            auth.locationId,
            auth.branchId,
          );
          if (!candidates.some((row) => row.id === body.classTeacherId)) {
            return apiFailure(
              'invalid_body',
              'That member of staff is not marked as a class teacher on their staff record, or is not at this campus.',
              400,
            );
          }

          updates.classTeacherId = body.classTeacherId;
        }
      }

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      const updated = await db
        .update(sections)
        .set(updates)
        .where(and(eq(sections.id, sectionId), eq(sections.locationId, auth.locationId)))
        .returning();

      if (updated[0] === undefined) {
        return apiFailure('not_found', 'Section not found.', 404);
      }

      return apiSuccess({ section: await getSectionById(auth.locationId, sectionId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { sectionId } = await context.params;
      if (!isUuid(sectionId)) return apiFailure('not_found', 'Section not found.', 404);

      const existing = await getSectionById(auth.locationId, sectionId);
      if (existing === null) return apiFailure('not_found', 'Section not found.', 404);

      if (await sectionHasEnrollments(auth.locationId, sectionId)) {
        return apiFailure(
          'in_use',
          'Students are enrolled in this section, so it cannot be deleted. Deactivate it instead.',
          409,
        );
      }

      await db
        .delete(sections)
        .where(and(eq(sections.id, sectionId), eq(sections.locationId, auth.locationId)));

      return apiSuccess({ deleted: true });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
