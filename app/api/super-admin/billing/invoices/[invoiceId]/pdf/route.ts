import { NextResponse, type NextRequest } from 'next/server';

import { apiFailure, handleApiError } from '@/lib/api-response';
import { buildInvoiceDocument, pdfResponseHeaders } from '@/lib/platform-invoice-documents';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * GET /api/super-admin/billing/invoices/[invoiceId]/pdf — E12.
 *
 * The same document the email attaches and a blocked school's administrator
 * downloads; `lib/platform-invoice-documents.ts` builds all three. A draft can
 * be downloaded here, and only here, so the operator can read it before
 * finalizing.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ invoiceId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin('billing', 'r');

    const { invoiceId } = await context.params;
    if (!isUuid(invoiceId)) return apiFailure('not_found', 'Invoice not found.', 404);

    const document = await buildInvoiceDocument(invoiceId);
    if (document === null) return apiFailure('not_found', 'Invoice not found.', 404);

    const inline = new URL(request.url).searchParams.get('inline') === '1';
    return new NextResponse(Buffer.from(document.pdf), {
      headers: pdfResponseHeaders(document.filename, inline ? 'inline' : 'attachment'),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
