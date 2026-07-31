import { and, eq } from 'drizzle-orm';

import { studentConcessions } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { listConcessions } from '@/lib/fee-queries';
import { FEE_WRITE_ROLES } from '@/lib/fee-roles';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/fees/concessions/[concessionId]
 *
 * PATCH  adjust the window, the name or the notes
 * DELETE remove it entirely
 *
 * Ending a concession is usually better done by setting `valid_until` than by
 * deleting: challans already raised keep the discount they were calculated
 * with either way, but a dated record explains *why* a family's bill changed in
 * March. Deletion stays available for the case where one was granted in error.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ concessionId: string }> };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

async function loadConcession(locationId: string, concessionId: string) {
  const rows = await db
    .select()
    .from(studentConcessions)
    .where(
      and(
        eq(studentConcessions.locationId, locationId),
        eq(studentConcessions.id, concessionId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

interface UpdateConcessionBody {
  concessionName?: unknown;
  validFrom?: unknown;
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
          return apiFailure('invalid_body', 'Enter a name of 80 characters or fewer.', 400);
        }
        updates.concessionName = name;
      }

      if (body.validFrom !== undefined) {
        const validFrom = readString(body.validFrom);
        if (!isValidDate(validFrom)) {
          return apiFailure('invalid_body', 'Enter a valid start date.', 400);
        }
        updates.validFrom = validFrom;
      }

      if (body.validUntil !== undefined) {
        const validUntil = readOptionalString(body.validUntil);
        if (validUntil !== null && !isValidDate(validUntil)) {
          return apiFailure('invalid_body', 'Enter a valid end date.', 400);
        }
        updates.validUntil = validUntil;
      }

      if (body.notes !== undefined) updates.notes = readOptionalString(body.notes);

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      // The resulting window is validated as a whole, not field by field.
      const nextFrom = updates.validFrom ?? existing.validFrom;
      const nextUntil =
        updates.validUntil === undefined ? existing.validUntil : updates.validUntil;

      if (nextUntil !== null && nextUntil < nextFrom) {
        return apiFailure('invalid_body', 'The end date must be after the start date.', 400);
      }

      await db
        .update(studentConcessions)
        .set(updates)
        .where(
          and(
            eq(studentConcessions.id, concessionId),
            eq(studentConcessions.locationId, auth.locationId),
          ),
        );

      return apiSuccess({
        concessions: await listConcessions(auth.locationId, existing.studentProfileId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_WRITE_ROLES },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { concessionId } = await context.params;
      if (!isUuid(concessionId)) {
        return apiFailure('not_found', 'Concession not found.', 404);
      }

      const existing = await loadConcession(auth.locationId, concessionId);
      if (existing === null) {
        return apiFailure('not_found', 'Concession not found.', 404);
      }

      await db
        .delete(studentConcessions)
        .where(
          and(
            eq(studentConcessions.id, concessionId),
            eq(studentConcessions.locationId, auth.locationId),
          ),
        );

      return apiSuccess({
        concessions: await listConcessions(auth.locationId, existing.studentProfileId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_WRITE_ROLES },
);
