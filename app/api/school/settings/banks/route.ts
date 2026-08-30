import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  BankAccountError,
  createBankAccount,
  listBankAccounts,
} from '@/lib/bank-accounts';
import {
  branchForWrite,
  effectiveBranchIds,
  readBranchParam,
  resolveBranchScope,
} from '@/lib/branch-scope';

import { readBankAccountInput } from './input';

/**
 * /api/school/settings/banks — the accounts a school prints on a voucher and
 * pays salaries from (Sprint 20, item 10).
 *
 * GET  every account this caller may see, active and inactive
 * POST add one
 *
 * ── No new permission key ────────────────────────────────────────────────
 * `settings.read` to look and `settings.write` to change — the pair the rest of
 * Settings already runs on. Bank details are school-wide reference data of
 * exactly the kind that screen holds, and a key of its own would be a question
 * the permissions matrix has to ask plus a widening of the `role_permissions`
 * CHECK, which is the trap STATE.md §5o records.
 *
 * ── The campus is decided on the server ──────────────────────────────────
 * `branchForWrite` answers whether this caller may file an account under the
 * campus they named, or shared. A branch administrator creating a *shared*
 * account would be adding a number every other campus then prints, which is
 * the same refusal every other scoped write in this product makes.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const scope = await resolveBranchScope(
        auth.locationId,
        auth,
        readBranchParam(new URL(request.url)),
      );

      return apiSuccess({
        accounts: await listBankAccounts(auth.locationId, effectiveBranchIds(scope)),
        // The campuses this caller may file an account under, so the form can
        // offer exactly what the server would accept.
        branches: scope.options,
        canShare: !scope.bound,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'settings.read' },
);

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<Record<string, unknown>>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
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

      const id = await createBankAccount(auth.locationId, {
        ...input,
        branchId: campus.branchId,
      });

      return apiSuccess({ bankAccountId: id }, 201);
    } catch (error) {
      if (error instanceof BankAccountError) {
        return apiFailure(error.code, error.message, error.status);
      }
      return handleApiError(error);
    }
  },
  { permission: 'settings.write' },
);
