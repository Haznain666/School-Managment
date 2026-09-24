import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { readBankAccountBody, type BankAccountBody } from '@/lib/platform-bank-account-input';
import { MAX_PLATFORM_BANK_ACCOUNTS } from '@/lib/platform-billing';
import {
  createPlatformBankAccount,
  listPlatformBankAccounts,
} from '@/lib/platform-billing-queries';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * /api/super-admin/billing/bank-accounts — the platform's own accounts. §5.
 *
 * GET  up to three
 * POST one more, in the first free slot — refused once there are three
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireSuperAdmin('billing', 'r');
    return apiSuccess({ accounts: await listPlatformBankAccounts() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin('billing', 'c');

    const read = readBankAccountBody(await readJsonBody<BankAccountBody>(request));
    if (!read.ok) return apiFailure('invalid_body', read.message, 400);

    const created = await createPlatformBankAccount(read.value);
    if (created === null) {
      return apiFailure(
        'too_many',
        `The platform can list at most ${String(MAX_PLATFORM_BANK_ACCOUNTS)} bank accounts. Remove one first.`,
        409,
      );
    }

    return apiSuccess({ account: created, accounts: await listPlatformBankAccounts() }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
