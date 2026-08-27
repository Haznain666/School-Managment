import { and, eq } from 'drizzle-orm';

import { feeTypes, isDiscountType, studentConcessions, studentProfiles } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { repriceOpenChallans } from '@/lib/fee-challans';
import { listConcessions } from '@/lib/fee-queries';
import { paiseToNumeric, toPaise } from '@/lib/money';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/fees/concessions
 *
 * GET  a student's concessions
 * POST grant one
 *
 * Concessions are per student and never global: a school-wide discount is a
 * price change, and belongs in the fee structure.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `YYYY-MM-DD`, and a real date rather than `2025-13-45`. */
function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const studentProfileId = url.searchParams.get('studentProfileId') ?? '';

      if (!isUuid(studentProfileId)) {
        return apiFailure('invalid_query', 'Select a student.', 400);
      }

      return apiSuccess({
        concessions: await listConcessions(auth.locationId, studentProfileId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.read' },
);

interface CreateConcessionBody {
  studentProfileId?: unknown;
  concessionName?: unknown;
  discountType?: unknown;
  discountValue?: unknown;
  appliesToFeeTypeId?: unknown;
  validFrom?: unknown;
  validUntil?: unknown;
  notes?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateConcessionBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const studentProfileId = body.studentProfileId;
      if (!isUuid(studentProfileId)) {
        return apiFailure('invalid_body', 'Select a student.', 400);
      }

      const concessionName = readString(body.concessionName);
      if (concessionName === '' || concessionName.length > 80) {
        return apiFailure(
          'invalid_body',
          'Give the concession a name of 80 characters or fewer, e.g. "Sibling discount".',
          400,
        );
      }

      if (!isDiscountType(body.discountType)) {
        return apiFailure(
          'invalid_body',
          'Choose whether the discount is a percentage or a fixed amount.',
          400,
        );
      }

      const discountValue = Number(body.discountValue);
      if (!Number.isFinite(discountValue) || discountValue <= 0) {
        return apiFailure('invalid_body', 'Enter a discount greater than zero.', 400);
      }

      // A percentage over 100 would turn a fee into a refund.
      if (body.discountType === 'percentage' && discountValue > 100) {
        return apiFailure('invalid_body', 'A percentage discount cannot exceed 100%.', 400);
      }
      if (body.discountType === 'fixed' && discountValue > 9_999_999) {
        return apiFailure('invalid_body', 'That discount amount is too large.', 400);
      }

      if (!isDateOnly(body.validFrom)) {
        return apiFailure('invalid_body', 'Enter a valid start date.', 400);
      }

      const validUntil =
        body.validUntil === null || body.validUntil === undefined || body.validUntil === ''
          ? null
          : body.validUntil;

      if (validUntil !== null && !isDateOnly(validUntil)) {
        return apiFailure('invalid_body', 'Enter a valid end date, or leave it blank.', 400);
      }

      if (validUntil !== null && validUntil < body.validFrom) {
        return apiFailure('invalid_body', 'The end date must be after the start date.', 400);
      }

      // The student must belong to this school — an id from another tenant
      // must not slip through the foreign key.
      const student = await db
        .select({ id: studentProfiles.id })
        .from(studentProfiles)
        .where(
          and(
            eq(studentProfiles.id, studentProfileId),
            eq(studentProfiles.locationId, auth.locationId),
          ),
        )
        .limit(1);

      if (student[0] === undefined) {
        return apiFailure('invalid_body', 'That student does not exist.', 400);
      }

      const appliesToFeeTypeId = isUuid(body.appliesToFeeTypeId)
        ? body.appliesToFeeTypeId
        : null;

      if (appliesToFeeTypeId !== null) {
        const feeType = await db
          .select({ id: feeTypes.id })
          .from(feeTypes)
          .where(
            and(
              eq(feeTypes.id, appliesToFeeTypeId),
              eq(feeTypes.locationId, auth.locationId),
            ),
          )
          .limit(1);

        if (feeType[0] === undefined) {
          return apiFailure('invalid_body', 'That fee type does not exist.', 400);
        }
      }

      const created = await db
        .insert(studentConcessions)
        .values({
          locationId: auth.locationId,
          studentProfileId,
          concessionName,
          discountType: body.discountType,
          discountValue:
            body.discountType === 'percentage'
              ? discountValue.toFixed(2)
              : paiseToNumeric(toPaise(discountValue)),
          appliesToFeeTypeId,
          validFrom: body.validFrom,
          validUntil,
          approvedByUid: auth.uid,
          notes: readOptionalString(body.notes),
        })
        .returning({ id: studentConcessions.id });

      /*
       * A discount granted now reaches the bills already sitting unpaid.
       *
       * The product owner's rule: *as long as the fee has not been paid, any
       * discount applied will be effective.* Before Sprint 17 this route
       * stopped at the INSERT above, so a sibling discount granted in October
       * did nothing to October's outstanding challan — the parent went on
       * paying the full amount and nothing on any screen said the discount had
       * missed. What it cannot reach, because history is not editable, comes
       * back as a credit on the next voucher.
       *
       * Awaited rather than fired and forgotten: the response tells the clerk
       * which vouchers moved, and "it did not reach the family voucher" is
       * precisely the thing they need to read while they are still on the
       * screen. It never throws — the concession is already committed.
       */
      const reprice = await repriceOpenChallans(db, {
        locationId: auth.locationId,
        studentProfileId,
        actorUid: auth.uid,
      });

      return apiSuccess(
        { concessionId: created[0]?.id ?? null, reprice },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
