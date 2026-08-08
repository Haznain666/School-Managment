import { and, count, eq, ne } from 'drizzle-orm';

import { examTerms, gradingBands, gradingSchemes } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { batch, db } from '@/lib/drizzle';
import { getGradingScheme } from '@/lib/exam-queries';
import {
  bandsProblem,
  markToNumeric,
  parseBandsInput,
  type ResolvedBand,
} from '@/lib/grading';
import { isUuid, readBoolean, readString } from '@/lib/validation';

/**
 * /api/school/grading-schemes/[schemeId]
 *
 * PATCH  rename, make default, retire, or replace the bands wholesale
 * DELETE remove a scheme no term uses
 *
 * ── Bands are replaced, not patched ──────────────────────────────────────
 * The editor sends the whole ladder. Patching band by band would let a school
 * hold, for a moment, a set with a hole in it — and a percentage that falls in
 * that hole gets no grade, which on a report card reads as a system failure
 * rather than a half-finished edit. Delete-then-insert inside one transaction
 * means the ladder is only ever complete or unchanged.
 *
 * Retiring is `isActive: false`. Deleting is refused once a term names the
 * scheme, because the report cards that term issued were graded by it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schemeId: string }> };

interface UpdateSchemeBody {
  name?: unknown;
  isDefault?: unknown;
  isActive?: unknown;
  bands?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { schemeId } = await context.params;
      if (!isUuid(schemeId)) return apiFailure('not_found', 'Scheme not found.', 404);

      const existing = await getGradingScheme(auth.locationId, schemeId);
      if (existing === null) return apiFailure('not_found', 'Scheme not found.', 404);

      const body = await readJsonBody<UpdateSchemeBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof gradingSchemes.$inferInsert> = {};

      if (body.name !== undefined) {
        const name = readString(body.name);
        if (name === '' || name.length > 60) {
          return apiFailure('invalid_body', 'Enter a scheme name of 60 characters or fewer.', 400);
        }

        const clash = await db
          .select({ id: gradingSchemes.id })
          .from(gradingSchemes)
          .where(
            and(
              eq(gradingSchemes.locationId, auth.locationId),
              eq(gradingSchemes.name, name),
              ne(gradingSchemes.id, schemeId),
            ),
          )
          .limit(1);

        if (clash[0] !== undefined) {
          return apiFailure('duplicate', `There is already a scheme called "${name}".`, 409);
        }

        updates.name = name;
      }

      const makeDefault =
        body.isDefault === undefined ? null : readBoolean(body.isDefault, false);

      if (makeDefault !== null) updates.isDefault = makeDefault;
      if (body.isActive !== undefined) {
        updates.isActive = readBoolean(body.isActive, existing.isActive);
      }

      let replacement: ResolvedBand[] | null = null;

      if (body.bands !== undefined) {
        const parsed = parseBandsInput(body.bands);
        if (typeof parsed === 'string') {
          return apiFailure('invalid_body', parsed, 400);
        }

        const problem = bandsProblem(parsed);
        if (problem !== null) {
          return apiFailure('invalid_body', problem, 400);
        }

        replacement = parsed;
      }

      if (Object.keys(updates).length === 0 && replacement === null) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      updates.updatedAt = new Date();

      // One transaction: the scheme row, the demotion of the incumbent default,
      // and the whole ladder. Statements built on `tx` — a builder made from
      // `db` runs outside the transaction. See `lib/drizzle.ts`.
      await batch(db, (tx) => [
        tx
          .update(gradingSchemes)
          .set(updates)
          .where(
            and(
              eq(gradingSchemes.locationId, auth.locationId),
              eq(gradingSchemes.id, schemeId),
            ),
          ),
        ...(makeDefault === true
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
        ...(replacement === null
          ? []
          : [
              tx
                .delete(gradingBands)
                .where(
                  and(
                    eq(gradingBands.locationId, auth.locationId),
                    eq(gradingBands.schemeId, schemeId),
                  ),
                ),
              ...replacement.map((band, index) =>
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
            ]),
      ]);

      return apiSuccess({ scheme: await getGradingScheme(auth.locationId, schemeId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { schemeId } = await context.params;
      if (!isUuid(schemeId)) return apiFailure('not_found', 'Scheme not found.', 404);

      const used = await db
        .select({ value: count() })
        .from(examTerms)
        .where(
          and(
            eq(examTerms.locationId, auth.locationId),
            eq(examTerms.gradingSchemeId, schemeId),
          ),
        );

      if ((used[0]?.value ?? 0) > 0) {
        return apiFailure(
          'conflict',
          'A term is graded by this scheme. Retire it instead — the report cards that term issued were graded by these bands.',
          409,
        );
      }

      const removed = await db
        .delete(gradingSchemes)
        .where(
          and(
            eq(gradingSchemes.locationId, auth.locationId),
            eq(gradingSchemes.id, schemeId),
          ),
        )
        .returning({ id: gradingSchemes.id });

      if (removed[0] === undefined) {
        return apiFailure('not_found', 'Scheme not found.', 404);
      }

      return apiSuccess({ schemeId });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
