import { and, eq, ne } from 'drizzle-orm';

import { gradingBands, gradingSchemes } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { batch, db } from '@/lib/drizzle';
import { listGradingSchemes } from '@/lib/exam-queries';
import { bandsProblem, markToNumeric, parseBandsInput } from '@/lib/grading';
import { readBoolean, readString } from '@/lib/validation';

/**
 * /api/school/grading-schemes
 *
 * GET  every scheme with its bands
 * POST create one, bands and all
 *
 * A scheme and its bands are written together, in one transaction, because a
 * scheme with no bands grades nothing — creating one and then failing to add
 * bands would leave a school with a grading scheme that silently produces no
 * grades at all.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      return apiSuccess({ schemes: await listGradingSchemes(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.read' },
);

interface SchemeBody {
  name?: unknown;
  isDefault?: unknown;
  bands?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<SchemeBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const name = readString(body.name);
      if (name === '' || name.length > 60) {
        return apiFailure('invalid_body', 'Enter a scheme name of 60 characters or fewer.', 400);
      }

      const bands = parseBandsInput(body.bands);
      if (typeof bands === 'string') {
        return apiFailure('invalid_body', bands, 400);
      }

      const problem = bandsProblem(bands);
      if (problem !== null) {
        return apiFailure('invalid_body', problem, 400);
      }

      const clash = await db
        .select({ id: gradingSchemes.id })
        .from(gradingSchemes)
        .where(
          and(
            eq(gradingSchemes.locationId, auth.locationId),
            eq(gradingSchemes.name, name),
          ),
        )
        .limit(1);

      if (clash[0] !== undefined) {
        return apiFailure('duplicate', `There is already a scheme called "${name}".`, 409);
      }

      const isDefault = readBoolean(body.isDefault, false);

      const created = await db
        .insert(gradingSchemes)
        .values({ locationId: auth.locationId, name, isDefault })
        .returning({ id: gradingSchemes.id });

      const schemeId = created[0]?.id;
      if (schemeId === undefined) {
        return apiFailure('internal_error', 'The scheme could not be created.', 500);
      }

      // Bands and the demotion of the incumbent default run in one transaction
      // — statements built on `tx`, because a builder made from `db` would
      // execute outside it. See `lib/drizzle.ts`.
      await batch(db, (tx) => [
        ...bands.map((band, index) =>
          tx.insert(gradingBands).values({
            locationId: auth.locationId,
            schemeId,
            label: band.label,
            minPercentage: markToNumeric(band.minPercentage),
            maxPercentage: markToNumeric(band.maxPercentage),
            gpa: band.gpa === null ? null : markToNumeric(band.gpa),
            remark: band.remark,
            sortOrder: index,
          }),
        ),
        ...(isDefault
          ? [
              tx
                .update(gradingSchemes)
                .set({ isDefault: false, updatedAt: new Date() })
                .where(
                  and(
                    eq(gradingSchemes.locationId, auth.locationId),
                    ne(gradingSchemes.id, schemeId),
                  ),
                ),
            ]
          : []),
      ]);

      return apiSuccess({ schemeId }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
