import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { toPaise } from '@/lib/money';
import { getPlatformInvoiceDetail, recordInvoiceReceipt } from '@/lib/platform-billing-queries';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/super-admin/billing/invoices/[invoiceId]/receipts — §5.
 *
 * `{ amount, transactionId, description? }` — the amount in the invoice's own
 * currency, as typed. Amount and transaction ID are required; a receipt nobody
 * can trace back to a bank statement is a rumour.
 *
 * The response carries the invoice as it now stands and whether the school was
 * unblocked. It carries nothing about *why* — the rule that decides it is
 * server-side only (E6), and the screen reports the fact, not the threshold.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ invoiceId: string }> };

interface ReceiptBody {
  amount?: unknown;
  transactionId?: unknown;
  description?: unknown;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSuperAdmin('billing', 'c');

    const { invoiceId } = await context.params;
    if (!isUuid(invoiceId)) return apiFailure('not_found', 'Invoice not found.', 404);

    const body = await readJsonBody<ReceiptBody>(request);
    const amountText =
      typeof body?.amount === 'number'
        ? String(body.amount)
        : typeof body?.amount === 'string'
          ? body.amount.trim()
          : '';

    if (!/^\d{1,11}(\.\d{1,2})?$/.test(amountText) || toPaise(amountText) <= 0) {
      return apiFailure('invalid_body', 'Enter the amount received, e.g. 150 or 150.50.', 400);
    }

    const transactionId = typeof body?.transactionId === 'string' ? body.transactionId.trim() : '';
    if (transactionId === '') {
      return apiFailure('invalid_body', 'The transaction ID is required.', 400);
    }
    if (transactionId.length > 120) {
      return apiFailure('invalid_body', 'That transaction ID is too long.', 400);
    }

    const description =
      typeof body?.description === 'string' && body.description.trim() !== ''
        ? body.description.trim().slice(0, 500)
        : null;

    const outcome = await recordInvoiceReceipt(
      invoiceId,
      { amountMinor: toPaise(amountText), transactionId, description },
      actor.email,
    );

    if (!outcome.ok) {
      return apiFailure(outcome.code, outcome.message, outcome.code === 'not_found' ? 404 : 409);
    }

    return apiSuccess({
      unblocked: outcome.unblocked,
      invoice: await getPlatformInvoiceDetail(invoiceId),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
