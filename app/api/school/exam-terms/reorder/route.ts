import { and, eq, inArray, isNull } from 'drizzle-orm';

import { examTerms } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { batch, db } from '@/lib/drizzle';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/exam-terms/reorder
 *
 * PATCH the whole list at once — `{ terms: [{ id, sequenceOrder }, …] }`.
 *
 * ── Why the whole list and not the two rows that moved ───────────────────
 * A reorder is a statement about the list, not about a row. Sending only the
 * pair that swapped leaves the rest of the sequence to be repaired by whichever
 * request arrives second, and two people dragging at once end up with an order
 * neither of them asked for. Every position is rewritten in one transaction, so
 * the list a school sees afterwards is the list somebody actually dragged.
 *
 * Terms from other years are refused rather than ignored: `sequence_order` is
 * scoped to a year, and a payload mixing two years is a client bug that would
 * otherwise silently renumber a year nobody was looking at.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReorderEntry {
  id?: unknown;
  sequenceOrder?: unknown;
}

interface ReorderBody {
  terms?: unknown;
}

export const PATCH = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<ReorderBody>(request);
      if (body === null || !Array.isArray(body.terms) || body.terms.length === 0) {
        return apiFailure('invalid_body', 'Send the terms in their new order.', 400);
      }
      if (body.terms.length > 100) {
        return apiFailure('invalid_body', 'That is more terms than a year has.', 400);
      }

      const requested: Array<{ id: string; sequenceOrder: number }> = [];

      for (const raw of body.terms as ReorderEntry[]) {
        if (!isUuid(raw.id)) {
          return apiFailure('invalid_body', 'Every entry needs a term id.', 400);
        }
        const order = raw.sequenceOrder;
        if (typeof order !== 'number' || !Number.isInteger(order) || order < 0) {
          return apiFailure(
            'invalid_body',
            'Every entry needs a whole-number position.',
            400,
          );
        }
        requested.push({ id: raw.id, sequenceOrder: order });
      }

      const ids = requested.map((entry) => entry.id);
      if (new Set(ids).size !== ids.length) {
        return apiFailure('invalid_body', 'A term appears twice in that order.', 400);
      }

      // Read back through a tenant-filtered query before writing: the ids came
      // out of a request and the table holds every school's terms.
      const found = await db
        .select({ id: examTerms.id, academicYearId: examTerms.academicYearId })
        .from(examTerms)
        .where(
          and(
            eq(examTerms.locationId, auth.locationId),
            inArray(examTerms.id, ids),
            isNull(examTerms.archivedAt),
          ),
        );

      if (found.length !== requested.length) {
        return apiFailure('not_found', 'One of those terms was not found.', 404);
      }

      const years = new Set(found.map((row) => row.academicYearId));
      if (years.size > 1) {
        return apiFailure(
          'invalid_body',
          'Terms are ordered within one academic year. Reorder a single year at a time.',
          400,
        );
      }

      const now = new Date();

      // Built on `tx`, not on `db`: a builder made from `db` runs outside the
      // transaction even when awaited inside one, and a half-applied reorder is
      // a list with two terms sharing a position.
      await batch(db, (tx) =>
        requested.map((entry) =>
          tx
            .update(examTerms)
            .set({ sequenceOrder: entry.sequenceOrder, updatedAt: now })
            .where(
              and(eq(examTerms.locationId, auth.locationId), eq(examTerms.id, entry.id)),
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
