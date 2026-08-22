import { and, eq, inArray } from 'drizzle-orm';

import { resultSubcategories } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { batch, db } from '@/lib/drizzle';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/result-subcategories/reorder
 *
 * PATCH the whole list — `{ subcategories: [{ id, sortOrder }, …] }`.
 *
 * The order is the order a teacher reads the picker in and the order a parent
 * reads the legend in, so it is best-to-worst and it is the school's own. Same
 * shape as the term reorder and for the same reason: a reorder is a statement
 * about the list, and sending only the pair that swapped leaves the rest of the
 * sequence to be repaired by whichever request lands second.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReorderEntry {
  id?: unknown;
  sortOrder?: unknown;
}

interface ReorderBody {
  subcategories?: unknown;
}

export const PATCH = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<ReorderBody>(request);
      if (
        body === null ||
        !Array.isArray(body.subcategories) ||
        body.subcategories.length === 0
      ) {
        return apiFailure(
          'invalid_body',
          'Send the sub-categories in their new order.',
          400,
        );
      }
      if (body.subcategories.length > 100) {
        return apiFailure('invalid_body', 'That is more than a school has.', 400);
      }

      const requested: Array<{ id: string; sortOrder: number }> = [];

      for (const raw of body.subcategories as ReorderEntry[]) {
        if (!isUuid(raw.id)) {
          return apiFailure('invalid_body', 'Every entry needs a sub-category id.', 400);
        }
        const order = raw.sortOrder;
        if (typeof order !== 'number' || !Number.isInteger(order) || order < 0) {
          return apiFailure(
            'invalid_body',
            'Every entry needs a whole-number position.',
            400,
          );
        }
        requested.push({ id: raw.id, sortOrder: order });
      }

      const ids = requested.map((entry) => entry.id);
      if (new Set(ids).size !== ids.length) {
        return apiFailure(
          'invalid_body',
          'A sub-category appears twice in that order.',
          400,
        );
      }

      const found = await db
        .select({ id: resultSubcategories.id })
        .from(resultSubcategories)
        .where(
          and(
            eq(resultSubcategories.locationId, auth.locationId),
            inArray(resultSubcategories.id, ids),
          ),
        );

      if (found.length !== requested.length) {
        return apiFailure('not_found', 'One of those sub-categories was not found.', 404);
      }

      const now = new Date();

      // Built on `tx`: a builder made from `db` runs outside the transaction
      // even when awaited inside one, and a half-applied reorder is a legend
      // with two descriptors sharing a position.
      await batch(db, (tx) =>
        requested.map((entry) =>
          tx
            .update(resultSubcategories)
            .set({ sortOrder: entry.sortOrder, updatedAt: now })
            .where(
              and(
                eq(resultSubcategories.locationId, auth.locationId),
                eq(resultSubcategories.id, entry.id),
              ),
            ),
        ),
      );

      return apiSuccess({ reordered: requested.length });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'exams.write' },
);
