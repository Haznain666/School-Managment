import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { sendEmail, smtpConfigured } from '@/lib/email-sender';
import { emailRejectionReason, normaliseEmailAddress } from '@/lib/email-validation';
import { monthLabel } from '@/lib/platform-billing';
import { getPlatformInvoiceDetail, recordInvoiceEmail } from '@/lib/platform-billing-queries';
import { buildInvoiceDocument, invoiceEmailText } from '@/lib/platform-invoice-documents';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/super-admin/billing/invoices/[invoiceId]/email — E11.
 *
 * `{ to }`. Sends the invoice with its PDF attached, **now**, and says whether
 * it went. Not through the outbox: that queue holds text, and the one message
 * with a file in it is sent by an operator watching the button (see
 * `sendEmail`'s note on attachments).
 *
 * Every attempt is logged, sent or failed, with who pressed it. A successful
 * send to an address other than the remembered one makes it the remembered
 * one, so the next send defaults to wherever the last one went. A finalized
 * invoice can be re-sent to anyone at any time; a draft cannot be sent at all.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ invoiceId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSuperAdmin('billing', 'u');

    const { invoiceId } = await context.params;
    if (!isUuid(invoiceId)) return apiFailure('not_found', 'Invoice not found.', 404);

    const body = await readJsonBody<{ to?: unknown }>(request);
    const raw = typeof body?.to === 'string' ? body.to.trim() : '';
    if (raw === '') return apiFailure('invalid_body', 'Enter the address to send it to.', 400);

    const problem = emailRejectionReason(raw);
    if (problem !== null) return apiFailure('invalid_body', problem, 400);
    const to = normaliseEmailAddress(raw);

    const document = await buildInvoiceDocument(invoiceId);
    if (document === null) return apiFailure('not_found', 'Invoice not found.', 404);

    if (document.invoice.status === 'draft') {
      return apiFailure('not_finalized', 'Finalize the invoice before sending it.', 409);
    }

    if (!smtpConfigured()) {
      return apiFailure('smtp_unconfigured', 'Outgoing email is not configured on this deployment.', 503);
    }

    const invoice = document.invoice;
    let status: 'sent' | 'failed' = 'sent';
    let failure: string | null = null;

    try {
      await sendEmail(
        to,
        `SchoolHub invoice ${invoice.invoiceNumber} — ${monthLabel(invoice.periodStart)}`,
        invoiceEmailText(invoice),
        [{ filename: document.filename, content: document.pdf, contentType: 'application/pdf' }],
      );
    } catch (error) {
      status = 'failed';
      failure = error instanceof Error ? error.message.slice(0, 300) : 'The mail server refused it.';
      console.error(`[billing] invoice ${invoice.invoiceNumber} to ${to} failed:`, error);
    }

    await recordInvoiceEmail({
      invoiceId,
      locationId: invoice.locationId,
      to,
      status,
      error: failure,
      sentBy: actor.email,
    });

    if (status === 'failed') {
      return apiFailure('send_failed', `The email could not be sent: ${failure ?? 'unknown error'}`, 502);
    }

    return apiSuccess({ sentTo: to, invoice: await getPlatformInvoiceDetail(invoiceId) });
  } catch (error) {
    return handleApiError(error);
  }
}
