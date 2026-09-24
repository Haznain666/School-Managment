import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { getPlatformInvoiceDetail, removeInvoiceDiscount } from '@/lib/platform-billing-queries';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * DELETE /api/super-admin/billing/invoices/[invoiceId]/discounts/[discountId]
 *
 * Draft only. The remaining discounts are re-priced, so removing the first of
 * two can raise what the second takes off if it had been capped.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ invoiceId: string; discountId: string }> };

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin('billing', 'u');

    const { invoiceId, discountId } = await context.params;
    if (!isUuid(invoiceId) || !isUuid(discountId)) {
      return apiFailure('not_found', 'Discount not found.', 404);
    }

    const outcome = await removeInvoiceDiscount(invoiceId, discountId);
    if (!outcome.ok) {
      return apiFailure(outcome.code, outcome.message, outcome.code === 'not_found' ? 404 : 409);
    }

    return apiSuccess({ invoice: await getPlatformInvoiceDetail(invoiceId) });
  } catch (error) {
    return handleApiError(error);
  }
}
