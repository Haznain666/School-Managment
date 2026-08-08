import { and, eq } from 'drizzle-orm';

import { examTerms } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getAcademicYear } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { getGradingScheme, listExamTerms } from '@/lib/exam-queries';
import { isIsoDate, isUuid, readString } from '@/lib/validation';

/**
 * /api/school/exam-terms
 *
 * GET  the terms of a year, with how many exams each holds
 * POST open a new term
 *
 * A term is the unit a report card is issued for, so everything downstream —
 * exams, papers, marks — is filed against one. The academic year is taken from
 * the body and validated against the caller's own school below; the tenant
 * itself only ever comes from the session.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const academicYearId = url.searchParams.get('academicYearId') ?? '';

      return apiSuccess({
        terms: await listExamTerms(auth.locationId, {
          academicYearId: academicYearId === '' ? undefined : academicYearId,
        }),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.read' },
);

interface CreateTermBody {
  academicYearId?: unknown;
  name?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  gradingSchemeId?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateTermBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const name = readString(body.name);
      if (name === '' || name.length > 80) {
        return apiFailure('invalid_body', 'Enter a term name of 80 characters or fewer.', 400);
      }
      if (!isUuid(body.academicYearId)) {
        return apiFailure('invalid_body', 'Choose an academic year.', 400);
      }
      if (!isIsoDate(body.startDate) || !isIsoDate(body.endDate)) {
        return apiFailure('invalid_body', 'Choose a start and an end date.', 400);
      }
      if (body.endDate < body.startDate) {
        return apiFailure('invalid_body', 'The term must end after it starts.', 400);
      }

      const schemeId =
        body.gradingSchemeId === undefined || body.gradingSchemeId === null
          ? null
          : body.gradingSchemeId;
      if (schemeId !== null && !isUuid(schemeId)) {
        return apiFailure('invalid_body', 'Choose a grading scheme, or none.', 400);
      }

      // Both ids came out of a request, and neither foreign key is scoped by
      // tenant — Postgres would happily let this school's term point at another
      // school's year. Every id in a body is re-read through a tenant-filtered
      // query before it is stored.
      const [year, scheme] = await Promise.all([
        getAcademicYear(auth.locationId, body.academicYearId),
        schemeId === null
          ? Promise.resolve(null)
          : getGradingScheme(auth.locationId, schemeId),
      ]);

      if (year === null) {
        return apiFailure('not_found', 'That academic year was not found.', 404);
      }
      if (schemeId !== null && scheme === null) {
        return apiFailure('not_found', 'That grading scheme was not found.', 404);
      }

      // The unique index would surface a duplicate as a 500, so it is looked up
      // first and reported as the conflict it is.
      const clash = await db
        .select({ id: examTerms.id })
        .from(examTerms)
        .where(
          and(
            eq(examTerms.locationId, auth.locationId),
            eq(examTerms.academicYearId, body.academicYearId),
            eq(examTerms.name, name),
          ),
        )
        .limit(1);

      if (clash[0] !== undefined) {
        return apiFailure('duplicate', `There is already a "${name}" in that year.`, 409);
      }

      const created = await db
        .insert(examTerms)
        .values({
          // Tenant from the verified session, never from the body.
          locationId: auth.locationId,
          academicYearId: body.academicYearId,
          name,
          startDate: body.startDate,
          endDate: body.endDate,
          gradingSchemeId: schemeId,
        })
        .returning({ id: examTerms.id });

      return apiSuccess({ termId: created[0]?.id ?? null }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
