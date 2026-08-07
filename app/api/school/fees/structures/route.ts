import { and, eq, inArray } from 'drizzle-orm';

import { academicYears, feeStructures, feeTypes, grades } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { batch, db, type Tx } from '@/lib/drizzle';
import { getFeeStructureMatrix } from '@/lib/fee-queries';
import { paiseToNumeric, toPaise } from '@/lib/money';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/fees/structures
 *
 * GET  the price-list matrix for one academic year
 * POST save the whole matrix at once
 *
 * The save is a bulk upsert rather than a row-at-a-time PATCH because the
 * screen is a grid: an admin sets twelve grades' tuition in one sitting, and
 * twelve half-applied requests would leave a price list nobody could trust.
 * Every write goes out through `batch()`, in one transaction, so the year's
 * prices change together or not at all.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const academicYearId = url.searchParams.get('academicYearId') ?? '';

      if (!isUuid(academicYearId)) {
        return apiFailure('invalid_query', 'Select an academic year.', 400);
      }

      // A branch-scoped admin sees their own branch whatever they ask for.
      const requestedBranch = url.searchParams.get('branchId') ?? undefined;
      const branchId = auth.branchId ?? requestedBranch;

      return apiSuccess(
        await getFeeStructureMatrix(auth.locationId, academicYearId, branchId ?? undefined),
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);

interface SaveStructuresBody {
  academicYearId?: unknown;
  cells?: unknown;
}

interface ParsedCell {
  feeTypeId: string;
  gradeId: string;
  /** Null means "not charged": the row is deleted rather than set to zero. */
  amount: string | null;
}

/**
 * Reads the grid the browser sent.
 *
 * A blank cell and a zero are different statements — "this grade is not charged
 * this fee" versus "this grade is charged nothing" — so a blank deletes the row
 * and a zero stores 0.00.
 */
function parseCells(value: unknown): ParsedCell[] | string {
  if (!Array.isArray(value)) return 'Expected a list of cells.';
  if (value.length > 2000) return 'Too many cells in one save.';

  const cells: ParsedCell[] = [];

  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return 'Each cell must be an object.';

    const cell = raw as Record<string, unknown>;
    const feeTypeId = cell['feeTypeId'];
    const gradeId = cell['gradeId'];

    if (!isUuid(feeTypeId) || !isUuid(gradeId)) {
      return 'Each cell must name a fee type and a grade.';
    }

    const amountRaw = cell['amount'];

    if (amountRaw === null || amountRaw === undefined || amountRaw === '') {
      cells.push({ feeTypeId, gradeId, amount: null });
      continue;
    }

    const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw);
    if (!Number.isFinite(amount) || amount < 0 || amount > 9_999_999) {
      return 'Every amount must be a number between 0 and 9,999,999.';
    }

    cells.push({ feeTypeId, gradeId, amount: paiseToNumeric(toPaise(amount)) });
  }

  return cells;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<SaveStructuresBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const academicYearId = body.academicYearId;
      if (!isUuid(academicYearId)) {
        return apiFailure('invalid_body', 'Select an academic year.', 400);
      }

      const parsed = parseCells(body.cells);
      if (typeof parsed === 'string') {
        return apiFailure('invalid_body', parsed, 400);
      }

      if (parsed.length === 0) {
        return apiFailure('invalid_body', 'There is nothing to save.', 400);
      }

      // Every id in the body is untrusted. The year, the heads and the grades
      // must all belong to *this* school, or a uuid from another tenant would
      // be written straight through the foreign key.
      const [yearRows, typeRows, gradeRows] = await Promise.all([
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
        db
          .select({ id: feeTypes.id })
          .from(feeTypes)
          .where(
            and(
              eq(feeTypes.locationId, auth.locationId),
              inArray(feeTypes.id, [...new Set(parsed.map((cell) => cell.feeTypeId))]),
            ),
          ),
        db
          .select({ id: grades.id, branchId: grades.branchId })
          .from(grades)
          .where(
            and(
              eq(grades.locationId, auth.locationId),
              inArray(grades.id, [...new Set(parsed.map((cell) => cell.gradeId))]),
            ),
          ),
      ]);

      if (yearRows[0] === undefined) {
        return apiFailure('invalid_body', 'That academic year does not exist.', 400);
      }

      const knownTypes = new Set(typeRows.map((row) => row.id));
      const knownGrades = new Map(gradeRows.map((row) => [row.id, row.branchId]));

      for (const cell of parsed) {
        if (!knownTypes.has(cell.feeTypeId) || !knownGrades.has(cell.gradeId)) {
          return apiFailure(
            'invalid_body',
            'One of the fee types or grades does not belong to this school.',
            400,
          );
        }

        if (auth.branchId !== null && knownGrades.get(cell.gradeId) !== auth.branchId) {
          return apiFailure(
            'forbidden',
            'You can only set fees for your own branch.',
            403,
          );
        }
      }

      // Deferred until `batch()` opens the transaction: a Drizzle builder is
      // bound to the session that created it, so these must be built on `tx`.
      const statements = parsed.map((cell) => (tx: Tx) =>
        cell.amount === null
          ? tx
              .delete(feeStructures)
              .where(
                and(
                  eq(feeStructures.locationId, auth.locationId),
                  eq(feeStructures.feeTypeId, cell.feeTypeId),
                  eq(feeStructures.gradeId, cell.gradeId),
                  eq(feeStructures.academicYearId, academicYearId),
                ),
              )
          : tx
              .insert(feeStructures)
              .values({
                locationId: auth.locationId,
                feeTypeId: cell.feeTypeId,
                gradeId: cell.gradeId,
                academicYearId,
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
      );

      await batch(db, (tx) => statements.map((statement) => statement(tx)));

      return apiSuccess({
        saved: parsed.filter((cell) => cell.amount !== null).length,
        cleared: parsed.filter((cell) => cell.amount === null).length,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
