import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  examScheduleGrades,
  examScheduleSubjects,
  examSchedules,
  examSubjects,
  examTerms,
  exams,
  TERM_NAME_MAX,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { academicYearBounds } from '@/lib/academics-queries';
import { getAcademicYear } from '@/lib/admissions-queries';
import { batch, db } from '@/lib/drizzle';
import { getExamTerm, getGradingScheme } from '@/lib/exam-queries';
import { hasPermission } from '@/lib/permission-queries';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isUuid, readOptionalDate, readString } from '@/lib/validation';

/**
 * /api/school/exam-terms/[termId]
 *
 * PATCH  rename, move the dates, change the grading scheme, or publish
 * DELETE archive — the term and everything generated under it
 *
 * ── Two permissions on one route ─────────────────────────────────────────
 * `withSchoolAuth` takes one permission, and this route needs two: editing a
 * term is `exams.write`, but publishing one *issues its report cards* and is
 * `exams.publish`. The route is gated on the weaker of the two and checks the
 * stronger itself when the body asks for it, rather than being split into two
 * endpoints that would then both have to be kept in step about everything else
 * a term can carry.
 *
 * ── DELETE archives, and archives the whole tree ─────────────────────────
 * Nothing in Sprint 14 issues a real DELETE. A term is what report cards were
 * issued against, and its papers may carry a fortnight of marking. But archiving
 * only the term would leave its schedule *grades* live, and those carry the
 * partial unique index that says a grade sits one datesheet per term — so every
 * grade in the archived term would stay locked out of its replacement by an
 * index nobody can see, with an error naming a term that no longer appears on
 * any screen. The whole tree moves in one transaction or none of it does.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ termId: string }> };

interface UpdateTermBody {
  name?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  gradingSchemeId?: unknown;
  isPublished?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { termId } = await context.params;
      if (!isUuid(termId)) return apiFailure('not_found', 'Term not found.', 404);

      const existing = await getExamTerm(auth.locationId, termId);
      if (existing === null) return apiFailure('not_found', 'Term not found.', 404);
      if (existing.isArchived) {
        return apiFailure('invalid_state', 'That term has been archived.', 409);
      }

      const body = await readJsonBody<UpdateTermBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof examTerms.$inferInsert> = {};

      if (body.name !== undefined) {
        const name = readString(body.name);
        if (name === '' || name.length > TERM_NAME_MAX) {
          return apiFailure(
            'invalid_body',
            `Enter a term name of ${TERM_NAME_MAX} characters or fewer.`,
            400,
          );
        }
        updates.name = name;
      }

      if (body.startDate !== undefined || body.endDate !== undefined) {
        const startDate =
          body.startDate === undefined
            ? existing.startDate
            : readOptionalDate(body.startDate);
        const endDate =
          body.endDate === undefined ? existing.endDate : readOptionalDate(body.endDate);

        if (startDate === undefined || endDate === undefined) {
          return apiFailure(
            'invalid_body',
            'Enter dates as YYYY-MM-DD, or leave them blank.',
            400,
          );
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

        const year = await getAcademicYear(auth.locationId, existing.academicYearId);
        if (year !== null) {
          const bounds = academicYearBounds(year);
          for (const date of [startDate, endDate]) {
            if (date === null) continue;
            if (date < bounds.start || date > bounds.end) {
              return apiFailure(
                'invalid_body',
                `The ${year.name} session runs ${bounds.start} to ${bounds.end}.`,
                400,
              );
            }
          }
        }

        updates.startDate = startDate;
        updates.endDate = endDate;
      }

      if (body.gradingSchemeId !== undefined) {
        if (body.gradingSchemeId === null || body.gradingSchemeId === '') {
          updates.gradingSchemeId = null;
        } else {
          if (!isUuid(body.gradingSchemeId)) {
            return apiFailure('invalid_body', 'Choose a grading scheme, or none.', 400);
          }
          // Re-read through a tenant-filtered query: the foreign key alone
          // would accept another school's scheme.
          const scheme = await getGradingScheme(auth.locationId, body.gradingSchemeId);
          if (scheme === null) {
            return apiFailure('not_found', 'That grading scheme was not found.', 404);
          }
          updates.gradingSchemeId = body.gradingSchemeId;
        }
      }

      if (body.isPublished !== undefined) {
        if (typeof body.isPublished !== 'boolean') {
          return apiFailure('invalid_body', 'isPublished must be true or false.', 400);
        }

        const mayPublish = await hasPermission(
          auth.locationId,
          auth.role,
          'exams.publish',
        );
        if (!mayPublish) {
          return apiFailure(
            'forbidden',
            'Your role may edit a term but not publish its results.',
            403,
          );
        }

        updates.isPublished = body.isPublished;
        // Kept rather than cleared on unpublish: "this was published once, on
        // this date" is the fact a school is asked about when a parent turns up
        // with an older card.
        if (body.isPublished) updates.publishedAt = new Date();
      }

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      updates.updatedAt = new Date();

      await db
        .update(examTerms)
        .set(updates)
        .where(and(eq(examTerms.locationId, auth.locationId), eq(examTerms.id, termId)));

      return apiSuccess({ term: await getExamTerm(auth.locationId, termId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { termId } = await context.params;
      if (!isUuid(termId)) return apiFailure('not_found', 'Term not found.', 404);

      const existing = await getExamTerm(auth.locationId, termId);
      if (existing === null) return apiFailure('not_found', 'Term not found.', 404);
      if (existing.isArchived) {
        return apiSuccess({ termId, alreadyArchived: true });
      }

      const actor = await getSchoolUserByUid(auth.locationId, auth.uid);
      const now = new Date();

      // The exams under this term, read before anything moves — the papers are
      // archived by exam id and the exams themselves lose nothing by being
      // listed first.
      const examRows = await db
        .select({ id: exams.id })
        .from(exams)
        .where(and(eq(exams.locationId, auth.locationId), eq(exams.termId, termId)));

      const examIds = examRows.map((row) => row.id);

      const scheduleRows = await db
        .select({ id: examSchedules.id })
        .from(examSchedules)
        .where(
          and(
            eq(examSchedules.locationId, auth.locationId),
            eq(examSchedules.termId, termId),
          ),
        );

      const scheduleIds = scheduleRows.map((row) => row.id);

      // Built on `tx`, not on `db`: a builder made from `db` runs outside the
      // transaction even when awaited inside one, and a half-archived term is
      // the exact state the partial unique index cannot recover from.
      await batch(db, (tx) => [
        tx
          .update(examTerms)
          .set({ archivedAt: now, archivedBy: actor?.id ?? null, updatedAt: now })
          .where(
            and(eq(examTerms.locationId, auth.locationId), eq(examTerms.id, termId)),
          ),
        tx
          .update(examSchedules)
          .set({ archivedAt: now, archivedBy: actor?.id ?? null, updatedAt: now })
          .where(
            and(
              eq(examSchedules.locationId, auth.locationId),
              eq(examSchedules.termId, termId),
              isNull(examSchedules.archivedAt),
            ),
          ),
        // The grade rows are the ones that matter: they carry the index that
        // says a grade sits one datesheet per term.
        tx
          .update(examScheduleGrades)
          .set({ archivedAt: now })
          .where(
            and(
              eq(examScheduleGrades.locationId, auth.locationId),
              eq(examScheduleGrades.termId, termId),
              isNull(examScheduleGrades.archivedAt),
            ),
          ),
        scheduleIds.length === 0
          ? tx.select({ none: sql<number>`0` }).from(examTerms).limit(0)
          : tx
              .update(examScheduleSubjects)
              .set({ archivedAt: now, updatedAt: now })
              .where(
                and(
                  eq(examScheduleSubjects.locationId, auth.locationId),
                  inArray(examScheduleSubjects.scheduleId, scheduleIds),
                  isNull(examScheduleSubjects.archivedAt),
                ),
              ),
        tx
          .update(exams)
          .set({ archivedAt: now, updatedAt: now })
          .where(
            and(
              eq(exams.locationId, auth.locationId),
              eq(exams.termId, termId),
              isNull(exams.archivedAt),
            ),
          ),
        examIds.length === 0
          ? tx.select({ none: sql<number>`0` }).from(examTerms).limit(0)
          : tx
              .update(examSubjects)
              .set({ archivedAt: now, updatedAt: now })
              .where(
                and(
                  eq(examSubjects.locationId, auth.locationId),
                  inArray(examSubjects.examId, examIds),
                  isNull(examSubjects.archivedAt),
                ),
              ),
      ]);

      return apiSuccess({
        termId,
        archived: {
          schedules: scheduleIds.length,
          exams: examIds.length,
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
