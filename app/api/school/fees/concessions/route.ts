import { and, eq } from 'drizzle-orm';

import { feeTypes, isDiscountType, studentConcessions } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getStudentDetail } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { listConcessions } from '@/lib/fee-queries';
import { FEE_READ_ROLES, FEE_WRITE_ROLES } from '@/lib/fee-roles';
import { paiseToNumericString, parsePaise } from '@/lib/money';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/fees/concessions — per-student discounts.
 *
 * GET  a student's concessions
 * POST grant one
 *
 * Concessions cost the school money, so `approved_by_uid` records who granted
 * each one, and only the roles that can move money may create them.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const studentProfileId = url.searchParams.get('studentProfileId') ?? '';

      if (!isUuid(studentProfileId)) {
        return apiFailure('invalid_query', 'Select a student.', 400);
      }

      // Proves the student belongs to this school before anything is returned.
      const student = await getStudentDetail(auth.locationId, studentProfileId);
      if (student === null) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      return apiSuccess({
        concessions: await listConcessions(auth.locationId, studentProfileId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_READ_ROLES },
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

      const studentProfileId = readString(body.studentProfileId);
      if (!isUuid(studentProfileId)) {
        return apiFailure('invalid_body', 'Select a student.', 400);
      }

      const student = await getStudentDetail(auth.locationId, studentProfileId);
      if (student === null) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      const concessionName = readString(body.concessionName);
      if (concessionName === '' || concessionName.length > 80) {
        return apiFailure(
          'invalid_body',
          'Name the concession, e.g. Sibling Discount.',
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

      const rawValue = readString(body.discountValue);
      let discountValue: string;

      if (body.discountType === 'percentage') {
        const percent = Number(rawValue);
        if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
          return apiFailure(
            'invalid_body',
            'A percentage discount must be between 0 and 100.',
            400,
          );
        }
        discountValue = percent.toFixed(2);
      } else {
        const paise = parsePaise(rawValue);
        if (paise === null || paise <= 0) {
          return apiFailure(
            'invalid_body',
            'Enter the discount in rupees, e.g. 1500.',
            400,
          );
        }
        discountValue = paiseToNumericString(paise);
      }

      // Null means the concession applies to tuition only — the common case.
      const appliesToFeeTypeId = readOptionalString(body.appliesToFeeTypeId);
      if (appliesToFeeTypeId !== null) {
        if (!isUuid(appliesToFeeTypeId)) {
          return apiFailure('invalid_body', 'That fee head does not exist.', 400);
        }

        const owned = await db
          .select({ id: feeTypes.id })
          .from(feeTypes)
          .where(
            and(
              eq(feeTypes.id, appliesToFeeTypeId),
              eq(feeTypes.locationId, auth.locationId),
            ),
          )
          .limit(1);

        if (owned[0] === undefined) {
          return apiFailure('invalid_body', 'That fee head does not exist.', 400);
        }
      }

      const validFrom = readString(body.validFrom);
      if (!isValidDate(validFrom)) {
        return apiFailure('invalid_body', 'Enter a valid start date.', 400);
      }

      const validUntil = readOptionalString(body.validUntil);
      if (validUntil !== null && !isValidDate(validUntil)) {
        return apiFailure('invalid_body', 'Enter a valid end date.', 400);
      }

      if (validUntil !== null && validUntil < validFrom) {
        return apiFailure('invalid_body', 'The end date must be after the start date.', 400);
      }

      await db.insert(studentConcessions).values({
        // Tenant comes from the verified session, never from the body.
        locationId: auth.locationId,
        studentProfileId,
        concessionName,
        discountType: body.discountType,
        discountValue,
        appliesToFeeTypeId,
        validFrom,
        validUntil,
        approvedByUid: auth.uid,
        notes: readOptionalString(body.notes),
      });

      return apiSuccess(
        { concessions: await listConcessions(auth.locationId, studentProfileId) },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: FEE_WRITE_ROLES },
);
