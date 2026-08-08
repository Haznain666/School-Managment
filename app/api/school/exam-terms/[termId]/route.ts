import { and, eq } from 'drizzle-orm';

import { examTerms } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getExamTerm, getGradingScheme } from '@/lib/exam-queries';
import { hasPermission } from '@/lib/permission-queries';
import { isIsoDate, isUuid, readString } from '@/lib/validation';

/**
 * /api/school/exam-terms/[termId]
 *
 * PATCH rename, move the dates, change the grading scheme, or publish.
 *
 * ── Two permissions on one route ─────────────────────────────────────────
 * `withSchoolAuth` takes one permission, and this route needs two: editing a
 * term is `exams.write`, but publishing one *issues its report cards* and is
 * `exams.publish`. The route is gated on the weaker of the two and checks the
 * stronger itself when the body asks for it, rather than being split into two
 * endpoints that would then both have to be kept in step about everything else
 * a term can carry.
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

      const body = await readJsonBody<UpdateTermBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof examTerms.$inferInsert> = {};

      if (body.name !== undefined) {
        const name = readString(body.name);
        if (name === '' || name.length > 80) {
          return apiFailure('invalid_body', 'Enter a term name of 80 characters or fewer.', 400);
        }
        updates.name = name;
      }

      const startDate = body.startDate ?? existing.startDate;
      const endDate = body.endDate ?? existing.endDate;

      if (body.startDate !== undefined || body.endDate !== undefined) {
        if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
          return apiFailure('invalid_body', 'Choose a start and an end date.', 400);
        }
        if (endDate < startDate) {
          return apiFailure('invalid_body', 'The term must end after it starts.', 400);
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
