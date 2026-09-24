import type { NextRequest } from 'next/server';

import { apiSuccess, handleApiError } from '@/lib/api-response';
import type { InvoiceDisplayStatus } from '@/lib/platform-billing';
import { listPlatformInvoices } from '@/lib/platform-billing-queries';
import { resolveLocationId } from '@/lib/schools';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * GET /api/super-admin/billing/invoices — every invoice, Sprint 35 §5.
 *
 * `?schoolId=` `?status=draft|due|overdue|paid|carried_forward` `?month=YYYY-MM`.
 * There is no "partial" status and no filter for one (E6).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES: readonly InvoiceDisplayStatus[] = ['draft', 'due', 'overdue', 'paid', 'carried_forward'];

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin('billing', 'r');

    const url = new URL(request.url);
    const schoolId = url.searchParams.get('schoolId');
    const status = url.searchParams.get('status');
    const month = url.searchParams.get('month');

    const locationId = schoolId !== null && isUuid(schoolId) ? await resolveLocationId(schoolId) : null;

    const invoices = await listPlatformInvoices({
      ...(locationId === null ? {} : { locationId }),
      ...(status !== null && (STATUSES as readonly string[]).includes(status)
        ? { status: status as InvoiceDisplayStatus }
        : {}),
      ...(month !== null && /^\d{4}-\d{2}$/.test(month) ? { month } : {}),
    });

    return apiSuccess({ invoices });
  } catch (error) {
    return handleApiError(error);
  }
}
