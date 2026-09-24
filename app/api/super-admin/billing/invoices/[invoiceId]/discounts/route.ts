import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { toPaise } from '@/lib/money';
import { discountProblem } from '@/lib/platform-billing';
import { addInvoiceDiscount, getPlatformInvoiceDetail } from '@/lib/platform-billing-queries';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/super-admin/billing/invoices/[invoiceId]/discounts — E10.
 *
 * `{ kind: 'percent', value: '12.5', description }` or
 * `{ kind: 'fixed', value: '20', description }`. The value is what the operator
 * typed: a percentage, or an amount in the invoice currency. It is turned into
 * basis points or minor units here, once.
 *
 * At most three, only on a draft, never more than the subtotal — the first two
 * refused with a sentence, the third by capping (see `applyDiscounts`). The
 * database enforces the three as well, through a unique slot 1–3.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ invoiceId: string }> };

interface DiscountBody {
  kind?: unknown;
  value?: unknown;
  description?: unknown;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSuperAdmin('billing', 'u');

    const { invoiceId } = await context.params;
    if (!isUuid(invoiceId)) return apiFailure('not_found', 'Invoice not found.', 404);

    const body = await readJsonBody<DiscountBody>(request);
    const text =
      typeof body?.value === 'number'
        ? String(body.value)
        : typeof body?.value === 'string'
          ? body.value.trim()
          : '';

    if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) {
      return apiFailure('invalid_body', 'Enter the discount as a number, e.g. 10 or 12.5.', 400);
    }

    // Percent → basis points; fixed → minor units. Both are "× 100".
    const value = toPaise(text);
    const problem = discountProblem(body?.kind, value, body?.description);
    if (problem !== null) return apiFailure('invalid_body', problem, 400);

    const outcome = await addInvoiceDiscount(
      invoiceId,
      {
        kind: body?.kind === 'fixed' ? 'fixed' : 'percent',
        value,
        description: String(body?.description ?? ''),
      },
      actor.email,
    );

    if (!outcome.ok) {
      return apiFailure(outcome.code, outcome.message, outcome.code === 'not_found' ? 404 : 409);
    }

    return apiSuccess({ invoice: await getPlatformInvoiceDetail(invoiceId) });
  } catch (error) {
    return handleApiError(error);
  }
}
