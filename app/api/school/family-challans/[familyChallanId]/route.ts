import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import {
  cancelFamilyChallan,
  recordFamilyPayment,
  FamilyChallanError,
} from '@/lib/family-challans';
import { isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/family-challans/[familyChallanId]
 *
 * POST   record a payment against the voucher
 * DELETE cancel it — releasing the children back to individual billing when
 *        the voucher was assembled over vouchers they already had, and
 *        cancelling them with it when it raised them itself
 *
 * A payment here is distributed across the member challans, oldest first, and
 * writes a `fee_payments` row against each. That is not bookkeeping tidiness:
 * the defaulter list and every fee report read the child challans, so a family
 * payment that only moved the voucher's own total would leave three children
 * reported as defaulters by a system holding their money.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ familyChallanId: string }> };

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque'] as const;

interface PaymentBody {
  amount?: unknown;
  paymentMethod?: unknown;
  reference?: unknown;
}

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { familyChallanId } = await context.params;
      if (!isUuid(familyChallanId)) {
        return apiFailure('not_found', 'Voucher not found.', 404);
      }

      const body = await readJsonBody<PaymentBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return apiFailure('invalid_body', 'Enter the amount received.', 400);
      }

      const paymentMethod =
        typeof body.paymentMethod === 'string' ? body.paymentMethod : '';
      if (!(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
        return apiFailure('invalid_body', 'Choose how the money was paid.', 400);
      }

      const result = await recordFamilyPayment({
        locationId: auth.locationId,
        actorUid: auth.uid,
        familyChallanId,
        amount,
        paymentMethod,
        reference: readOptionalString(body.reference),
      });

      return apiSuccess({ result });
    } catch (error) {
      if (error instanceof FamilyChallanError) {
        return apiFailure('invalid_body', error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { familyChallanId } = await context.params;
      if (!isUuid(familyChallanId)) {
        return apiFailure('not_found', 'Voucher not found.', 404);
      }

      /*
       * What cancelling did depends on how the voucher was raised, and the
       * response says which — see `cancelFamilyChallan`. A clerk cancelling a
       * *generated* voucher has just cancelled three children's vouchers too,
       * and being told so on the screen is the difference between an action and
       * a surprise.
       */
      const outcome = await cancelFamilyChallan(auth.locationId, familyChallanId);
      return apiSuccess({ cancelled: true, outcome });
    } catch (error) {
      if (error instanceof FamilyChallanError) {
        return apiFailure('conflict', error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'fees.write' },
);
