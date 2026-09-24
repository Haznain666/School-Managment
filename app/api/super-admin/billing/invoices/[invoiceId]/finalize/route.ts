import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { finalizeInvoice, getPlatformInvoiceDetail } from '@/lib/platform-billing-queries';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/super-admin/billing/invoices/[invoiceId]/finalize — §5.
 *
 * Draft → finalized, claimed (`WHERE status = 'draft'`), so two tabs pressing
 * it produce one finalization and one "already finalized". Only a finalized
 * invoice can block a school (E5), take a receipt, or be seen by the school.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ invoiceId: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSuperAdmin('billing', 'u');

    const { invoiceId } = await context.params;
    if (!isUuid(invoiceId)) return apiFailure('not_found', 'Invoice not found.', 404);

    const outcome = await finalizeInvoice(invoiceId, actor.email);
    if (!outcome.ok) {
      return apiFailure(outcome.code, outcome.message, outcome.code === 'not_found' ? 404 : 409);
    }

    return apiSuccess({ invoice: await getPlatformInvoiceDetail(invoiceId) });
  } catch (error) {
    return handleApiError(error);
  }
}
