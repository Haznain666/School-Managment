import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import {
  getPlatformInvoiceDetail,
  listPlatformBankAccounts,
} from '@/lib/platform-billing-queries';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/** GET /api/super-admin/billing/invoices/[invoiceId] — one invoice, whole. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ invoiceId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin('billing', 'r');

    const { invoiceId } = await context.params;
    if (!isUuid(invoiceId)) return apiFailure('not_found', 'Invoice not found.', 404);

    const [invoice, bankAccounts] = await Promise.all([
      getPlatformInvoiceDetail(invoiceId),
      listPlatformBankAccounts(),
    ]);
    if (invoice === null) return apiFailure('not_found', 'Invoice not found.', 404);

    return apiSuccess({ invoice, bankAccounts });
  } catch (error) {
    return handleApiError(error);
  }
}
