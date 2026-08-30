import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  BankAccountError,
  deleteBankAccount,
  setBankAccountActive,
  updateBankAccount,
} from '@/lib/bank-accounts';
import {
  branchForWrite,
  readBranchParam,
  resolveBranchScope,
} from '@/lib/branch-scope';
import { isUuid } from '@/lib/validation';

import { readBankAccountInput } from '../input';

/**
 * /api/school/settings/banks/[bankAccountId]
 *
 * PATCH  edit one, or switch it on and off
 * DELETE remove one
 *
 * ── Two shapes of PATCH, and why the small one exists ────────────────────
 * A body carrying only `isActive` flips the toggle and touches nothing else.
 * Anything else is a full record and is validated as one.
 *
 * The row toggle sends the small shape deliberately: a full-record write from a
 * table row would carry whatever the row was rendered with and silently
 * overwrite an edit somebody else had just saved in the modal. A toggle is one
 * fact about one column and is written as one.
 *
 * ── DELETE is allowed, and the confirmation is the safeguard ─────────────
 * The obvious rule — refuse once the account has been printed on a voucher —
 * cannot be enforced, because nothing records that a voucher was printed and a
 * voucher snapshots none of these details. So the screen says in words that
 * slips already in parents' hands carry these numbers and will not change, and
 * offers the toggle as the safer act. See `lib/bank-accounts.ts`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ bankAccountId: string }> };

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { bankAccountId } = await context.params;
      if (!isUuid(bankAccountId)) {
        return apiFailure('not_found', 'Account not found.', 404);
      }

      const body = await readJsonBody<Record<string, unknown>>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      // The toggle-only shape: exactly one key, and it is `isActive`.
      const keys = Object.keys(body);
      if (keys.length === 1 && keys[0] === 'isActive') {
        if (typeof body['isActive'] !== 'boolean') {
          return apiFailure('invalid_body', 'Expected true or false.', 400);
        }

        await setBankAccountActive(auth.locationId, bankAccountId, body['isActive']);
        return apiSuccess({ updated: true });
      }

      const input = readBankAccountInput(body);
      if (typeof input === 'string') {
        return apiFailure('invalid_body', input, 400);
      }

      const scope = await resolveBranchScope(
        auth.locationId,
        auth,
        readBranchParam(new URL(request.url)),
      );

      const campus = branchForWrite(scope, input.branchId);
      if (!campus.ok) return apiFailure('forbidden', campus.message, 403);

      await updateBankAccount(auth.locationId, bankAccountId, {
        ...input,
        branchId: campus.branchId,
      });

      return apiSuccess({ updated: true });
    } catch (error) {
      if (error instanceof BankAccountError) {
        return apiFailure(error.code, error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'settings.write' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { bankAccountId } = await context.params;
      if (!isUuid(bankAccountId)) {
        return apiFailure('not_found', 'Account not found.', 404);
      }

      await deleteBankAccount(auth.locationId, bankAccountId);
      return apiSuccess({ deleted: true });
    } catch (error) {
      if (error instanceof BankAccountError) {
        return apiFailure(error.code, error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'settings.write' },
);
