import { NextResponse, type NextRequest } from 'next/server';

import { apiFailure, handleApiError } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { invoiceBelongsTo } from '@/lib/platform-billing-queries';
import { buildInvoiceDocument, pdfResponseHeaders } from '@/lib/platform-invoice-documents';
import { isUuid } from '@/lib/validation';

/**
 * GET /api/school/billing/invoices/[invoiceId]/pdf — Sprint 35, §6.
 *
 * The school administrator downloading a SchoolHub invoice, which is the one
 * thing they must be able to do while their school is blocked — so this is one
 * of the routes that opts back in with `allowWhenBlocked`. Every other school
 * route refuses a blocked school.
 *
 * `school_admin` only: the platform's invoice is between SchoolHub and the
 * school's owner, not something a teacher or an accountant is shown. The tenant
 * comes from the verified session and nowhere else, and the invoice must belong
 * to it — an id from another school is a 404, not a 403, so it says nothing
 * about whether that id exists. Drafts are never served: a school sees what it
 * was sent.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ invoiceId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request: NextRequest, auth, context) => {
    try {
      const { invoiceId } = await context.params;
      if (!isUuid(invoiceId) || !(await invoiceBelongsTo(invoiceId, auth.locationId))) {
        return apiFailure('not_found', 'Invoice not found.', 404);
      }

      const document = await buildInvoiceDocument(invoiceId);
      if (document === null) return apiFailure('not_found', 'Invoice not found.', 404);

      return new NextResponse(Buffer.from(document.pdf), {
        headers: pdfResponseHeaders(document.filename, 'attachment'),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ['school_admin'], allowWhenBlocked: true },
);
