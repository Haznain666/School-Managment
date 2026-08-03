import { and, eq } from 'drizzle-orm';

import {
  academicYears,
  academicYearName,
  academicYearRangeProblem,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { academicYearHasEnrollments, getAcademicYear } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/academic-years/[yearId]
 *
 * GET    one year
 * PATCH  move its window
 * DELETE only while nothing has been filed against it
 *
 * A year with enrolments is refused rather than cascaded: the whole point of
 * the table is that last year's placements stay answerable.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ yearId: string }> };


export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { yearId } = await context.params;
      if (!isUuid(yearId)) {
        return apiFailure('not_found', 'Academic year not found.', 404);
      }

      const academicYear = await getAcademicYear(auth.locationId, yearId);
      if (academicYear === null) {
        return apiFailure('not_found', 'Academic year not found.', 404);
      }

      return apiSuccess({ academicYear });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.read' },
);

interface UpdateYearBody {
  startMonth?: unknown;
  startYear?: unknown;
  endMonth?: unknown;
  endYear?: unknown;
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return fallback;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { yearId } = await context.params;
      if (!isUuid(yearId)) {
        return apiFailure('not_found', 'Academic year not found.', 404);
      }

      const existing = await getAcademicYear(auth.locationId, yearId);
      if (existing === null) {
        return apiFailure('not_found', 'Academic year not found.', 404);
      }

      const body = await readJsonBody<UpdateYearBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      // Partial update: anything not supplied keeps its current value, and the
      // resulting window is validated as a whole.
      const range = {
        startMonth: readNumber(body.startMonth, existing.startMonth),
        startYear: readNumber(body.startYear, existing.startYear),
        endMonth: readNumber(body.endMonth, existing.endMonth),
        endYear: readNumber(body.endYear, existing.endYear),
      };

      const problem = academicYearRangeProblem(range);
      if (problem !== null) {
        return apiFailure('invalid_body', problem, 400);
      }

      const updated = await db
        .update(academicYears)
        .set({
          ...range,
          name: academicYearName(range.startYear, range.endYear),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(academicYears.id, yearId),
            eq(academicYears.locationId, auth.locationId),
          ),
        )
        .returning();

      const academicYear = updated[0];
      if (academicYear === undefined) {
        return apiFailure('not_found', 'Academic year not found.', 404);
      }

      return apiSuccess({ academicYear });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { yearId } = await context.params;
      if (!isUuid(yearId)) {
        return apiFailure('not_found', 'Academic year not found.', 404);
      }

      const existing = await getAcademicYear(auth.locationId, yearId);
      if (existing === null) {
        return apiFailure('not_found', 'Academic year not found.', 404);
      }

      if (await academicYearHasEnrollments(auth.locationId, yearId)) {
        return apiFailure(
          'in_use',
          'Students are enrolled in this academic year, so it cannot be deleted.',
          409,
        );
      }

      await db
        .delete(academicYears)
        .where(
          and(
            eq(academicYears.id, yearId),
            eq(academicYears.locationId, auth.locationId),
          ),
        );

      return apiSuccess({ deleted: true });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
