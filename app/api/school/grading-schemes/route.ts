import { and, eq, ne } from 'drizzle-orm';

import { gradingBands, gradingSchemes } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  branchForWrite,
  effectiveBranchIds,
  readBranchParam,
  resolveBranchScope,
} from '@/lib/branch-scope';
import { batch, db } from '@/lib/drizzle';
import { listGradingSchemes } from '@/lib/exam-queries';
import { bandsProblem, markToNumeric, parseBandsInput } from '@/lib/grading';
import { readBoolean, readOptionalString, readString } from '@/lib/validation';

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
 *
 * ── The first scheme a school creates becomes its default ────────────────
 * `is_default` used to come from the body and default to false, and nothing in
 * the UI sent it. So a school could configure a complete six-band ladder and
 * every report card and tabulation sheet would still print a dash for every
 * grade, because `bandsForTerm()` found no default to fall back to — the exact
 * output as a school that had configured nothing at all. QA hit this on
 * 2026-08-09.
 *
 * That ambiguity is worse than either state on its own: "no grades because
 * nobody has said what an A is" is a deliberate, legible answer (see
 * `lib/grading.ts`), and it stops being legible the moment it also means "you
 * did say, and we ignored it". A school with exactly one scheme has, by
 * construction, told us which one to grade by. Subsequent schemes still have
 * to be promoted deliberately, because then the choice is real.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const scope = await resolveBranchScope(
        auth.locationId,
        auth,
        readBranchParam(new URL(request.url)),
      );

      return apiSuccess({
        schemes: await listGradingSchemes(auth.locationId, effectiveBranchIds(scope)),
      });
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
  /** Null or absent = shared by every campus. Item 2e validates it. */
  branchId?: unknown;
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

      const existing = await db
        .select({ id: gradingSchemes.id, name: gradingSchemes.name })
        .from(gradingSchemes)
        .where(eq(gradingSchemes.locationId, auth.locationId));

      if (existing.some((scheme) => scheme.name === name)) {
        return apiFailure('duplicate', `There is already a scheme called "${name}".`, 409);
      }

      // The first scheme a school creates is its default whatever the body
      // says — see the docblock. After that, promotion is deliberate.
      const isDefault = existing.length === 0 || readBoolean(body.isDefault, false);

      // Item 2e. `exams.write` is a branch administrator's by default, so this
      // guard fires in practice: an unanswered campus resolves to theirs.
      const scope = await resolveBranchScope(auth.locationId, auth);
      const campus = branchForWrite(scope, readOptionalString(body.branchId));
      if (!campus.ok) return apiFailure('forbidden', campus.message, 403);

      const created = await db
        .insert(gradingSchemes)
        .values({ locationId: auth.locationId, branchId: campus.branchId, name, isDefault })
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
