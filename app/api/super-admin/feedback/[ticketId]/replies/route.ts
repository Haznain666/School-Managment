import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { REPLY_MAX } from '@/lib/feedback';
import { addFeedbackReply, getFeedbackTicket } from '@/lib/feedback-queries';
import { notify } from '@/lib/notifications';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * POST /api/super-admin/feedback/[ticketId]/replies — the vendor's answer.
 *
 * A reply notifies the school exactly as a status change does. Without that,
 * the most useful thing an operator can write — "we cannot reproduce this, what
 * browser were you on?" — sits on a screen nobody has a reason to revisit, and
 * the conversation dies on the first question.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  body?: unknown;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ ticketId: string }> },
) {
  try {
    const session = await requireSuperAdmin();

    const { ticketId } = await context.params;

    const payload = await readJsonBody<Body>(request);
    const message = typeof payload?.body === 'string' ? payload.body.trim() : '';

    if (message === '') {
      return apiFailure('invalid_body', 'Write a reply first.', 400);
    }

    if (message.length > REPLY_MAX) {
      return apiFailure(
        'invalid_body',
        `A reply must be ${REPLY_MAX} characters or fewer.`,
        400,
      );
    }

    const ticket = await getFeedbackTicket(ticketId);
    if (ticket === null) {
      return apiFailure('not_found', 'That feedback no longer exists.', 404);
    }

    /*
     * "SMS Platform Support" rather than the operator's own address. The name
     * is printed to the school on every reply, and a school that learns one
     * person's private mailbox will use it — which routes the next report past
     * this table and into an inbox with no ticket, no status and no record.
     */
    const reply = await addFeedbackReply({
      ticketId,
      authorKind: 'super_admin',
      authorSchoolUserId: null,
      authorName: 'SMS Platform Support',
      body: message,
    });

    await notify({
      audience: 'school_user',
      locationId: ticket.locationId,
      schoolUserId: ticket.submittedBy,
      kind: 'feedback_reply',
      title: `Reply on "${ticket.title}"`,
      body: message.length > 140 ? `${message.slice(0, 137)}…` : message,
      href: `/dashboard/feedback/${ticketId}`,
      email: ticket.submittedByEmail === '' ? null : ticket.submittedByEmail,
      emailSubject: `Re: ${ticket.title}`,
      emailText: `${message}\n\nOpen your school portal to reply.\n`,
    });

    console.info(`[feedback] ${session.email} replied to ${ticketId}`);

    return apiSuccess({ id: reply.id }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
