import { and, eq, inArray } from 'drizzle-orm';

import { academicYears, branches, feeStructures, feeTypes, grades } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getFeeStructureMatrix } from '@/lib/fee-queries';
import { FEE_READ_ROLES, FEE_WRITE_ROLES } from '@/lib/fee-roles';
import { paiseToNumericString, parsePaise } from '@/lib/money';
import { isUuid, readString } from '@/lib/validation';

/**
 * /api/school/fees/structures — what each grade pays under each head.
 *
 * GET  the setup matrix for one branch and one academic year
 * POST save the whole matrix at once
 *
 * The save is a bulk upsert rather than a cell-at-a-time PATCH: an admin fills
 * in thirty cells and presses save once, and thirty separate requests would
 * leave the matrix half-written if the tab closed midway. Everything lands in
 * one `db.batch()`, which Neon runs as a single transaction.
 *
 * A blank cell means "this grade is not charged this head" and deletes any
 * existing row, rather than storing a zero — a zero-rupee line would print on
 * the challan.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const branchId = url.searchParams.get('branchId') ?? '';
      const academicYearId = url.searchParams.get('academicYearId') ?? '';

      if (!isUuid(branchId)) {
        return apiFailure('invalid_query', 'Select a branch.', 400);
      }
      if (!isUuid(academicYearId)) {
        return apiFailure('invalid_query', 'Select an academic year.', 400);
      }

      // Both must belong to this school — a UUID from another tenant must not
      // become a readable matrix.
      const [branchRows, yearRows] = await Promise.all([
        db
          .select({ id: branches.id })
          .from(branches)
          .where(
            and(eq(branches.id, branchId), eq(branches.locationId, auth.locationId)),
          )
          .limit(1),
        db
          .select({ id: academicYears.id })
          .from(academicYears)
          .where(
            and(
              eq(academicYears.id, academicYearId),
              eq(academicYears.locationId, auth.locationId),
            ),
          )
          .limit(1),
      ]);

      if (branchRows[0] === undefined) {
        return apiFailure('not_found', 'That branch does not exist.', 404);
      }
      if (yearRows[0] === undefined) {
        return apiFailure('not_found', 'That academic year does not exist.', 404);
      }

      return apiSuccess(
        await getFeeStructureMatrix(auth.locationId, branchId, academicYearId),
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_READ_ROLES },
);

interface StructureCell {
  feeTypeId?: unknown;
  gradeId?: unknown;
  academicYearId?: unknown;
  /** Blank or null clears the cell. */
  amount?: unknown;
}

interface SaveStructuresBody {
  cells?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<SaveStructuresBody>(request);
      if (body === null || !Array.isArray(body.cells)) {
        return apiFailure('invalid_body', 'Expected a list of cells.', 400);
      }

      if (body.cells.length === 0) {
        return apiSuccess({ saved: 0, cleared: 0 });
      }

      if (body.cells.length > 500) {
        return apiFailure('invalid_body', 'Too many cells in one save.', 400);
      }

      const toWrite: Array<{
        feeTypeId: string;
        gradeId: string;
        academicYearId: string;
        amount: string;
      }> = [];
      const toClear: Array<{ feeTypeId: string; gradeId: string; academicYearId: string }> =
        [];

      for (const [index, raw] of body.cells.entries()) {
        if (typeof raw !== 'object' || raw === null) {
          return apiFailure('invalid_body', `Cell ${index + 1} is malformed.`, 400);
        }

        const cell = raw as StructureCell;
        const feeTypeId = readString(cell.feeTypeId);
        const gradeId = readString(cell.gradeId);
        const academicYearId = readString(cell.academicYearId);

        if (!isUuid(feeTypeId) || !isUuid(gradeId) || !isUuid(academicYearId)) {
          return apiFailure('invalid_body', `Cell ${index + 1} has a bad reference.`, 400);
        }

        const rawAmount = cell.amount;
        const isBlank =
          rawAmount === null ||
          rawAmount === undefined ||
          (typeof rawAmount === 'string' && rawAmount.trim() === '');

        if (isBlank) {
          toClear.push({ feeTypeId, gradeId, academicYearId });
          continue;
        }

        const paise = parsePaise(rawAmount as string | number);
        if (paise === null || paise < 0) {
          return apiFailure(
            'invalid_body',
            `Cell ${index + 1} is not a valid amount. Use rupees, e.g. 5000 or 5000.50.`,
            400,
          );
        }

        toWrite.push({
          feeTypeId,
          gradeId,
          academicYearId,
          amount: paiseToNumericString(paise),
        });
      }

      // Every referenced id must belong to this school. Checked in one query
      // per kind rather than per cell — a matrix save touches thirty rows.
      const feeTypeIds = [
        ...new Set([...toWrite, ...toClear].map((cell) => cell.feeTypeId)),
      ];
      const gradeIds = [...new Set([...toWrite, ...toClear].map((cell) => cell.gradeId))];
      const yearIds = [
        ...new Set([...toWrite, ...toClear].map((cell) => cell.academicYearId)),
      ];

      const [ownedTypes, ownedGrades, ownedYears] = await Promise.all([
        db
          .select({ id: feeTypes.id })
          .from(feeTypes)
          .where(
            and(
              eq(feeTypes.locationId, auth.locationId),
              inArray(feeTypes.id, feeTypeIds),
            ),
          ),
        db
          .select({ id: grades.id })
          .from(grades)
          .where(
            and(eq(grades.locationId, auth.locationId), inArray(grades.id, gradeIds)),
          ),
        db
          .select({ id: academicYears.id })
          .from(academicYears)
          .where(
            and(
              eq(academicYears.locationId, auth.locationId),
              inArray(academicYears.id, yearIds),
            ),
          ),
      ]);

      if (
        ownedTypes.length !== feeTypeIds.length ||
        ownedGrades.length !== gradeIds.length ||
        ownedYears.length !== yearIds.length
      ) {
        return apiFailure(
          'invalid_body',
          'One of the fee heads, grades or academic years does not belong to this school.',
          400,
        );
      }

      const statements = [
        ...toWrite.map((cell) =>
          db
            .insert(feeStructures)
            .values({
              locationId: auth.locationId,
              feeTypeId: cell.feeTypeId,
              gradeId: cell.gradeId,
              academicYearId: cell.academicYearId,
              amount: cell.amount,
            })
            .onConflictDoUpdate({
              target: [
                feeStructures.feeTypeId,
                feeStructures.gradeId,
                feeStructures.academicYearId,
              ],
              set: { amount: cell.amount, updatedAt: new Date() },
            }),
        ),
        ...toClear.map((cell) =>
          db
            .delete(feeStructures)
            .where(
              and(
                eq(feeStructures.locationId, auth.locationId),
                eq(feeStructures.feeTypeId, cell.feeTypeId),
                eq(feeStructures.gradeId, cell.gradeId),
                eq(feeStructures.academicYearId, cell.academicYearId),
              ),
            ),
        ),
      ];

      const [first, ...rest] = statements;
      if (first !== undefined) {
        await db.batch([first, ...rest]);
      }

      return apiSuccess({ saved: toWrite.length, cleared: toClear.length });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_WRITE_ROLES },
);
