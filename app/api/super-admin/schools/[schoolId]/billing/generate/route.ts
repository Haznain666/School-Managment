import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { monthLabel } from '@/lib/platform-billing';
import { billedMonthFor, generateInvoiceForSchool } from '@/lib/platform-billing-queries';
import { resolveLocationId } from '@/lib/schools';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/super-admin/schools/[schoolId]/billing/generate — "Generate now".
 *
 * The same function the monthly sweep calls, for the same month it would bill
 * — last month, in arrears (Q1) — so pressing this is exactly what the 1st will
 * do, and it is how QA exercises the generator without waiting for a calendar.
 * Idempotent: a second press finds the invoice and says so.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string }> };

const REASONS = {
  not_live: 'This school is in Sandbox. Switch it to Live before invoicing it.',
  no_billable_days: 'There is nothing billable last month — the school went live, or its trial ended, after it.',
  missing_rate: 'Set a USD → PKR rate: the billing and invoice currencies differ.',
  not_found: 'School not found.',
} as const;

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSuperAdmin('billing', 'c');

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) return apiFailure('not_found', 'School not found.', 404);

    const locationId = await resolveLocationId(schoolId);
    if (locationId === null) return apiFailure('not_found', 'School not found.', 404);

    const period = billedMonthFor(new Date());
    const outcome = await generateInvoiceForSchool(locationId, period.start, actor.email);

    if (outcome.status === 'created' || outcome.status === 'exists') {
      return apiSuccess({
        status: outcome.status,
        invoiceId: outcome.invoiceId,
        period: monthLabel(period.start),
      });
    }

    return apiFailure(outcome.status, REASONS[outcome.status], outcome.status === 'not_found' ? 404 : 409);
  } catch (error) {
    return handleApiError(error);
  }
}
