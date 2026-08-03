import { and, eq, ne } from 'drizzle-orm';

import {
  academicYears,
  academicYearName,
  academicYearRangeProblem,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { listAcademicYears } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { readBoolean } from '@/lib/validation';

/**
 * /api/school/academic-years — the sessions this school runs.
 *
 * GET  every year, newest first, with the enrolment count that blocks deletion
 * POST create one, optionally making it the active year
 *
 * Windows are stored as month/year pairs because Pakistani schools do not share
 * a calendar; see `db/schema/academic-years.ts`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      return apiSuccess({ academicYears: await listAcademicYears(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.read' },
);

interface CreateYearBody {
  startMonth?: unknown;
  startYear?: unknown;
  endMonth?: unknown;
  endYear?: unknown;
  setAsActive?: unknown;
}

/** Reads a numeric field, returning NaN for anything that is not a number. */
function readNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateYearBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const range = {
        startMonth: readNumber(body.startMonth),
        startYear: readNumber(body.startYear),
        endMonth: readNumber(body.endMonth),
        endYear: readNumber(body.endYear),
      };

      const problem = academicYearRangeProblem(range);
      if (problem !== null) {
        return apiFailure('invalid_body', problem, 400);
      }

      const setAsActive = readBoolean(body.setAsActive, false);
      const name = academicYearName(range.startYear, range.endYear);

      const inserted = await db
        .insert(academicYears)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          name,
          ...range,
          isActive: setAsActive,
        })
        .returning();

      const created = inserted[0];
      if (created === undefined) {
        return apiFailure('write_failed', 'Could not create the academic year.', 500);
      }

      // Only one year may be active. Demoting the incumbent happens after the
      // insert so that a failed insert cannot leave the school with none.
      if (setAsActive) {
        await db
          .update(academicYears)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(academicYears.locationId, auth.locationId),
              ne(academicYears.id, created.id),
            ),
          );
      }

      return apiSuccess({ academicYear: created }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
