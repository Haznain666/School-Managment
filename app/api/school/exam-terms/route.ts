import { and, eq, isNull, sql } from 'drizzle-orm';

import { examTerms, TERM_NAME_MAX } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { academicYearBounds } from '@/lib/academics-queries';
import { getAcademicYear } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { getGradingScheme, listExamTerms } from '@/lib/exam-queries';
import { isUuid, readOptionalDate, readString } from '@/lib/validation';

/**
 * /api/school/exam-terms
 *
 * GET  the terms of a year, with how many schedules and exams each holds
 * POST open a new term
 *
 * A term is the unit a report card is issued for, so everything downstream —
 * schedules, exams, papers, marks — is filed against one. The academic year is
 * taken from the body and validated against the caller's own school below; the
 * tenant itself only ever comes from the session.
 *
 * ── The dates are optional from Sprint 14 ────────────────────────────────
 * The authoritative window lives on each schedule, where it differs per grade.
 * What is sent here is an envelope for calendar views, and a school that leaves
 * it blank gets the window derived from its schedules. Where it *is* sent it
 * must fall inside the academic year — a term outside its own session is a term
 * whose attendance summary counts the wrong days.
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
          includeArchived: url.searchParams.get('includeArchived') === 'true',
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
      if (name === '' || name.length > TERM_NAME_MAX) {
        return apiFailure(
          'invalid_body',
          `Enter a term name of ${TERM_NAME_MAX} characters or fewer.`,
          400,
        );
      }
      if (!isUuid(body.academicYearId)) {
        return apiFailure('invalid_body', 'Choose an academic year.', 400);
      }

      const startDate = readOptionalDate(body.startDate);
      const endDate = readOptionalDate(body.endDate);
      if (startDate === undefined || endDate === undefined) {
        return apiFailure('invalid_body', 'Enter dates as YYYY-MM-DD, or leave them blank.', 400);
      }
      if (startDate !== null && endDate !== null && endDate < startDate) {
        return apiFailure('invalid_body', 'The term must end after it starts.', 400);
      }
      if (startDate === null && endDate !== null) {
        return apiFailure(
          'invalid_body',
          'A term with an end date needs a start date too.',
          400,
        );
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

      const bounds = academicYearBounds(year);
      for (const date of [startDate, endDate]) {
        if (date === null) continue;
        if (date < bounds.start || date > bounds.end) {
          return apiFailure(
            'invalid_body',
            `The ${year.name} session runs ${bounds.start} to ${bounds.end}. A term outside it would summarise the wrong days' attendance.`,
            400,
          );
        }
      }

      // The unique index would surface a duplicate as a 500, so it is looked up
      // first and reported as the conflict it is. Archived terms are excluded,
      // matching the partial index: archiving "First Term" frees the name.
      const clash = await db
        .select({ id: examTerms.id })
        .from(examTerms)
        .where(
          and(
            eq(examTerms.locationId, auth.locationId),
            eq(examTerms.academicYearId, body.academicYearId),
            eq(examTerms.name, name),
            isNull(examTerms.archivedAt),
          ),
        )
        .limit(1);

      if (clash[0] !== undefined) {
        return apiFailure('duplicate', `There is already a "${name}" in that year.`, 409);
      }

      // New terms land at the end of the school's own reading order. Computed
      // rather than defaulted to 0, which would put every new term joint first
      // and let the list arrange itself.
      const last = await db
        .select({ highest: sql<number | null>`max(${examTerms.sequenceOrder})` })
        .from(examTerms)
        .where(
          and(
            eq(examTerms.locationId, auth.locationId),
            eq(examTerms.academicYearId, body.academicYearId),
            isNull(examTerms.archivedAt),
          ),
        );

      const created = await db
        .insert(examTerms)
        .values({
          // Tenant from the verified session, never from the body.
          locationId: auth.locationId,
          academicYearId: body.academicYearId,
          name,
          startDate,
          endDate,
          sequenceOrder: (last[0]?.highest ?? 0) + 1,
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
