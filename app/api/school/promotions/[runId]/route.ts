import { and, eq, inArray } from 'drizzle-orm';

import { promotionDecisions, promotionRuns, sections } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { db } from '@/lib/drizzle';
import {
  getPromotionRun,
  listRunDecisions,
  PROMOTION_DECISION_VALUES,
} from '@/lib/promotion-queries';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/promotions/[runId]
 *
 * GET    the run and its decisions
 * PATCH  change decisions in bulk
 * DELETE discard a draft
 *
 * An applied run is immutable. Editing one would leave a record describing a
 * decision different from the enrolments it actually produced, and the whole
 * reason `promotion_decisions` is stored at all is so the run can be read back
 * afterwards and believed.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ runId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { runId } = await context.params;
      if (!isUuid(runId)) return apiFailure('not_found', 'Promotion not found.', 404);

      const run = await getPromotionRun(auth.locationId, runId);
      if (run === null) return apiFailure('not_found', 'Promotion not found.', 404);

      return apiSuccess({ run, decisions: await listRunDecisions(runId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.promote' },
);

interface PatchBody {
  /** `[{ id, decision, toSectionId?, note? }]` */
  decisions?: unknown;
}

interface DecisionUpdate {
  id: string;
  decision: 'promote' | 'retain' | 'graduate';
  toSectionId: string | null;
  note: string | null;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { runId } = await context.params;
      if (!isUuid(runId)) return apiFailure('not_found', 'Promotion not found.', 404);

      const run = await getPromotionRun(auth.locationId, runId);
      if (run === null) return apiFailure('not_found', 'Promotion not found.', 404);

      if (run.status === 'applied') {
        return apiFailure(
          'conflict',
          'This promotion has already been carried out and cannot be changed.',
          409,
        );
      }

      const body = await readJsonBody<PatchBody>(request);
      if (body === null || !Array.isArray(body.decisions)) {
        return apiFailure('invalid_body', 'Expected { decisions: [...] }.', 400);
      }

      const updates: DecisionUpdate[] = [];

      for (const raw of body.decisions) {
        if (typeof raw !== 'object' || raw === null) continue;
        const entry = raw as Record<string, unknown>;

        const id = typeof entry['id'] === 'string' ? entry['id'] : '';
        const decision = entry['decision'];

        if (
          !isUuid(id) ||
          typeof decision !== 'string' ||
          !(PROMOTION_DECISION_VALUES as readonly string[]).includes(decision)
        ) {
          continue;
        }

        const toSectionId =
          typeof entry['toSectionId'] === 'string' && isUuid(entry['toSectionId'])
            ? entry['toSectionId']
            : null;

        updates.push({
          id,
          decision: decision as DecisionUpdate['decision'],
          // A retain stays where it is and a graduate goes nowhere, so neither
          // carries a section. Storing one anyway would create a second place
          // the answer could be wrong — `applyPromotionRun` reads a retained
          // student's section off their enrolment.
          toSectionId: decision === 'promote' ? toSectionId : null,
          note: readOptionalString(entry['note']),
        });
      }

      if (updates.length === 0) {
        return apiFailure('invalid_body', 'No usable decisions in that request.', 400);
      }

      // Every decision must belong to this run — an id from another school's
      // run satisfies the primary key perfectly well.
      const owned = await db
        .select({ id: promotionDecisions.id })
        .from(promotionDecisions)
        .where(
          and(
            eq(promotionDecisions.runId, runId),
            inArray(
              promotionDecisions.id,
              updates.map((update) => update.id),
            ),
          ),
        );

      const ownedIds = new Set(owned.map((row) => row.id));
      const applicable = updates.filter((update) => ownedIds.has(update.id));

      if (applicable.length === 0) {
        return apiFailure('invalid_body', 'Those decisions are not part of this run.', 400);
      }

      // Sections named as destinations must belong to this school and to the
      // receiving year, or a promotion could file a child into next year's
      // register at another campus.
      const sectionIds = [
        ...new Set(
          applicable
            .map((update) => update.toSectionId)
            .filter((value): value is string => value !== null),
        ),
      ];

      if (sectionIds.length > 0) {
        const valid = await db
          .select({ id: sections.id })
          .from(sections)
          .where(
            and(
              eq(sections.locationId, auth.locationId),
              eq(sections.academicYearId, run.toAcademicYearId),
              inArray(sections.id, sectionIds),
            ),
          );

        const validIds = new Set(valid.map((row) => row.id));
        const bad = sectionIds.find((id) => !validIds.has(id));
        if (bad !== undefined) {
          return apiFailure(
            'invalid_body',
            'One of those classes is not in the receiving year.',
            400,
          );
        }
      }

      await db.transaction(async (tx) => {
        for (const update of applicable) {
          await tx
            .update(promotionDecisions)
            .set({
              decision: update.decision,
              toSectionId: update.toSectionId,
              note: update.note,
              updatedAt: new Date(),
            })
            .where(eq(promotionDecisions.id, update.id));
        }
      });

      return apiSuccess({ updated: applicable.length });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.promote' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { runId } = await context.params;
      if (!isUuid(runId)) return apiFailure('not_found', 'Promotion not found.', 404);

      const run = await getPromotionRun(auth.locationId, runId);
      if (run === null) return apiFailure('not_found', 'Promotion not found.', 404);

      if (run.status === 'applied') {
        return apiFailure(
          'conflict',
          'This promotion has already moved students. Deleting the record would not move them back — it is the only account of what happened.',
          409,
        );
      }

      // A draft has written nothing outside its own two tables, so deleting it
      // really is a discard. `promotion_decisions.run_id` cascades, so the one
      // statement takes both.
      await db.delete(promotionRuns).where(eq(promotionRuns.id, runId));

      return apiSuccess({ deleted: true });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.promote' },
);
