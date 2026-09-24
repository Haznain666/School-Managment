import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { readBankAccountBody, type BankAccountBody } from '@/lib/platform-bank-account-input';
import {
  deletePlatformBankAccount,
  listPlatformBankAccounts,
  updatePlatformBankAccount,
} from '@/lib/platform-billing-queries';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * /api/super-admin/billing/bank-accounts/[accountId]
 *
 * PATCH  replace the account's details (every field, validated as on create)
 * DELETE remove it — invoices already emailed keep the account they printed,
 *        because a PDF is a document, not a view
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ accountId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin('billing', 'u');

    const { accountId } = await context.params;
    if (!isUuid(accountId)) return apiFailure('not_found', 'Bank account not found.', 404);

    const read = readBankAccountBody(await readJsonBody<BankAccountBody>(request));
    if (!read.ok) return apiFailure('invalid_body', read.message, 400);

    if (!(await updatePlatformBankAccount(accountId, read.value))) {
      return apiFailure('not_found', 'Bank account not found.', 404);
    }

    return apiSuccess({ accounts: await listPlatformBankAccounts() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin('billing', 'd');

    const { accountId } = await context.params;
    if (!isUuid(accountId)) return apiFailure('not_found', 'Bank account not found.', 404);

    if (!(await deletePlatformBankAccount(accountId))) {
      return apiFailure('not_found', 'Bank account not found.', 404);
    }

    return apiSuccess({ accounts: await listPlatformBankAccounts() });
  } catch (error) {
    return handleApiError(error);
  }
}
