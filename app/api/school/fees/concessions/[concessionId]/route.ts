import { and, eq } from 'drizzle-orm';

import { studentConcessions } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { repriceOpenChallans } from '@/lib/fee-challans';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/fees/concessions/[concessionId]
 *
 * PATCH  amend a concession, or close it by setting an end date
 * DELETE remove one entered in error
 *
 * Ending a concession is a PATCH, not a DELETE: `valid_until` closes it going
 * forwards while leaving the challans it already discounted explainable.
 * DELETE exists for the genuine mistake — the wrong child, the wrong amount.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ concessionId: string }> };

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function loadConcession(locationId: string, concessionId: string) {
  const rows = await db
    .select({
      id: studentConcessions.id,
      studentProfileId: studentConcessions.studentProfileId,
      validFrom: studentConcessions.validFrom,
      discountType: studentConcessions.discountType,
    })
    .from(studentConcessions)
    .where(
      and(
        eq(studentConcessions.id, concessionId),
        eq(studentConcessions.locationId, locationId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

interface UpdateConcessionBody {
  concessionName?: unknown;
  discountValue?: unknown;
  validUntil?: unknown;
  notes?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { concessionId } = await context.params;
      if (!isUuid(concessionId)) {
        return apiFailure('not_found', 'Concession not found.', 404);
      }

      const existing = await loadConcession(auth.locationId, concessionId);
      if (existing === null) {
        return apiFailure('not_found', 'Concession not found.', 404);
      }

      const body = await readJsonBody<UpdateConcessionBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof studentConcessions.$inferInsert> = {};

      if (body.concessionName !== undefined) {
        const name = readString(body.concessionName);
        if (name === '' || name.length > 80) {
          return apiFailure(
            'invalid_body',
            'Give the concession a name of 80 characters or fewer.',
            400,
          );
        }
        updates.concessionName = name;
      }

      if (body.discountValue !== undefined) {
        const value = Number(body.discountValue);
        if (!Number.isFinite(value) || value <= 0) {
          return apiFailure('invalid_body', 'Enter a discount greater than zero.', 400);
        }
        if (existing.discountType === 'percentage' && value > 100) {
          return apiFailure(
            'invalid_body',
            'A percentage discount cannot exceed 100%.',
            400,
          );
        }
        updates.discountValue = value.toFixed(2);
      }

      if (body.validUntil !== undefined) {
        if (body.validUntil === null || body.validUntil === '') {
          updates.validUntil = null;
        } else if (!isDateOnly(body.validUntil)) {
          return apiFailure(
            'invalid_body',
            'Enter a valid end date, or leave it blank.',
            400,
          );
        } else if (body.validUntil < existing.validFrom) {
          return apiFailure(
            'invalid_body',
            'The end date must be after the start date.',
            400,
          );
        } else {
          updates.validUntil = body.validUntil;
        }
      }

      if (body.notes !== undefined) {
        updates.notes = readOptionalString(body.notes);
      }

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      const updated = await db
        .update(studentConcessions)
        .set(updates)
        .where(
          and(
            eq(studentConcessions.id, concessionId),
            eq(studentConcessions.locationId, auth.locationId),
          ),
        )
        .returning({ id: studentConcessions.id });

      if (updated[0] === undefined) {
        return apiFailure('not_found', 'Concession not found.', 404);
      }

      /*
       * An amended discount reaches the bills already sitting unpaid, exactly
       * as a newly granted one does — see the same call in `POST
       * /api/school/fees/concessions`.
       *
       * This route matters as much as that one and is easier to overlook:
       * correcting "10%" to "20%" the morning after is the commonest way a
       * concession is fixed, and before Sprint 17 the correction changed
       * nothing about the challan the parent was holding.
       */
      const reprice = await repriceOpenChallans(db, {
        locationId: auth.locationId,
        studentProfileId: existing.studentProfileId,
        actorUid: auth.uid,
      });

      return apiSuccess({ updated: true, reprice });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { concessionId } = await context.params;
      if (!isUuid(concessionId)) {
        return apiFailure('not_found', 'Concession not found.', 404);
      }

      // Read before the delete: the row is the only place the student is
      // named, and the repricing below needs them.
      const existing = await loadConcession(auth.locationId, concessionId);

      const deleted = await db
        .delete(studentConcessions)
        .where(
          and(
            eq(studentConcessions.id, concessionId),
            eq(studentConcessions.locationId, auth.locationId),
          ),
        )
        .returning({ id: studentConcessions.id });

      if (deleted[0] === undefined) {
        return apiFailure('not_found', 'Concession not found.', 404);
      }

      /*
       * And the same repricing, in the other direction.
       *
       * DELETE is for the genuine mistake — the wrong child, the wrong amount —
       * so the discount it applied has to come back off the bills that are
       * still open, or the school has quietly forgiven money it never meant to.
       * Paid challans are untouched, as always: what was collected was
       * collected.
       */
      const reprice =
        existing === null
          ? null
          : await repriceOpenChallans(db, {
              locationId: auth.locationId,
              studentProfileId: existing.studentProfileId,
              actorUid: auth.uid,
            });

      return apiSuccess({ deleted: true, reprice });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
