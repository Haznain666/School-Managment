import { and, eq, inArray } from 'drizzle-orm';

import { academicYears, feeStructures, grades } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { batch, db, type Tx } from '@/lib/drizzle';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/fees/structures/copy
 *
 * Copies a whole year's price list onto another year, so setting up 2026-2027
 * starts from last year's numbers instead of a blank grid.
 *
 * Existing prices in the target year win: the upsert leaves them alone rather
 * than overwriting them, because a school that has already keyed in this year's
 * increase must not have it silently reverted by a stray click on "copy".
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CopyBody {
  fromAcademicYearId?: unknown;
  toAcademicYearId?: unknown;
  branchId?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CopyBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const { fromAcademicYearId, toAcademicYearId } = body;

      if (!isUuid(fromAcademicYearId) || !isUuid(toAcademicYearId)) {
        return apiFailure('invalid_body', 'Choose both academic years.', 400);
      }

      if (fromAcademicYearId === toAcademicYearId) {
        return apiFailure(
          'invalid_body',
          'Choose two different academic years to copy between.',
          400,
        );
      }

      // Both years must be this school's own.
      const years = await db
        .select({ id: academicYears.id })
        .from(academicYears)
        .where(
          and(
            eq(academicYears.locationId, auth.locationId),
            inArray(academicYears.id, [fromAcademicYearId, toAcademicYearId]),
          ),
        );

      if (years.length !== 2) {
        return apiFailure('invalid_body', 'One of those academic years does not exist.', 400);
      }

      const branchId = auth.branchId ?? (isUuid(body.branchId) ? body.branchId : null);

      const sourceConditions = [
        eq(feeStructures.locationId, auth.locationId),
        eq(feeStructures.academicYearId, fromAcademicYearId),
      ];

      const source = await db
        .select({
          feeTypeId: feeStructures.feeTypeId,
          gradeId: feeStructures.gradeId,
          amount: feeStructures.amount,
          branchId: grades.branchId,
        })
        .from(feeStructures)
        .innerJoin(grades, eq(grades.id, feeStructures.gradeId))
        .where(and(...sourceConditions));

      const rows =
        branchId === null
          ? source
          : source.filter((row) => row.branchId === branchId);

      if (rows.length === 0) {
        return apiFailure(
          'nothing_to_copy',
          'That academic year has no fee structure to copy.',
          409,
        );
      }

      // Deferred until `batch()` opens the transaction: a Drizzle builder is
      // bound to the session that created it, so these must be built on `tx`.
      const statements = rows.map((row) => (tx: Tx) =>
        tx
          .insert(feeStructures)
          .values({
            locationId: auth.locationId,
            feeTypeId: row.feeTypeId,
            gradeId: row.gradeId,
            academicYearId: toAcademicYearId,
            amount: row.amount,
          })
          .onConflictDoNothing({
            target: [
              feeStructures.feeTypeId,
              feeStructures.gradeId,
              feeStructures.academicYearId,
            ],
          }),
      );

      await batch(db, (tx) => statements.map((statement) => statement(tx)));

      return apiSuccess({ copied: rows.length });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
