import type { NextRequest } from 'next/server';

import {
  FEEDBACK_STATUS_LABELS,
  isFeedbackDecisionStatus,
  type FeedbackStatus,
} from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  deleteFeedbackTicket,
  getFeedbackTicket,
  setFeedbackStatus,
} from '@/lib/feedback-queries';
import { notify } from '@/lib/notifications';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * PATCH  /api/super-admin/feedback/[ticketId] — set the decision.
 * DELETE /api/super-admin/feedback/[ticketId] — remove it and its files.
 *
 * Both are platform-only. Neither is offered to a school: a school may write
 * feedback and reply to it, and may not decide about it or make it disappear —
 * a ticket a school could delete is a bug report that vanishes the week before
 * anybody looks at it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PatchBody {
  status?: unknown;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ ticketId: string }> },
) {
  try {
    await requireSuperAdmin();

    const { ticketId } = await context.params;
    const payload = await readJsonBody<PatchBody>(request);

    /*
     * Only the three *decisions* are settable. `read` is set by opening the
     * ticket and `unread` is what it was born as — offering either here would
     * let an operator put a ticket back into a state meaning "nobody has looked
     * at this", which would then be untrue and would re-notify the school about
     * a decision that had been unmade.
     */
    if (!isFeedbackDecisionStatus(payload?.status)) {
      return apiFailure(
        'invalid_body',
        'Choose Work in progress, Future development or Resolved.',
        400,
      );
    }

    const status: FeedbackStatus = payload.status;

    const changed = await setFeedbackStatus(ticketId, status);

    /*
     * Null means the ticket already held this status — a second click, or two
     * operators agreeing. That is not an error and it must not send a second
     * "your feedback is now Resolved" email saying nothing new. The ticket is
     * re-read so the caller still gets the current state back.
     */
    if (changed === null) {
      const current = await getFeedbackTicket(ticketId);
      if (current === null) {
        return apiFailure('not_found', 'That feedback no longer exists.', 404);
      }
      return apiSuccess({ status: current.status, changed: false });
    }

    /*
     * Told to the person who wrote it, not to the school at large: this is the
     * answer to something they asked. `submittedBy` is null once their account
     * is gone, in which case there is nobody to put a bell entry in front of —
     * the email still goes, because the address on the ticket is a snapshot and
     * is very often still a working mailbox at that school.
     */
    await notify({
      audience: 'school_user',
      locationId: changed.locationId,
      schoolUserId: changed.submittedBy,
      kind: 'feedback_status',
      title: `Your feedback is now ${FEEDBACK_STATUS_LABELS[status]}`,
      body: changed.title,
      href: `/dashboard/feedback/${changed.id}`,
      email: changed.submittedByEmail === '' ? null : changed.submittedByEmail,
      emailSubject: `${FEEDBACK_STATUS_LABELS[status]}: ${changed.title}`,
      emailText:
        `Your feedback "${changed.title}" has been marked ` +
        `${FEEDBACK_STATUS_LABELS[status]}.\n\n` +
        'Open it in your school portal to read any reply.\n',
    });

    return apiSuccess({ status, changed: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ ticketId: string }> },
) {
  try {
    await requireSuperAdmin();

    const { ticketId } = await context.params;

    /*
     * No notification on deletion, deliberately. "Your feedback has been
     * deleted" is a message that answers nothing and reads as a rebuke; a
     * school that wants a decision communicated gets one of the three statuses,
     * which is what those are for. Deletion is for duplicates and for tests.
     */
    const deleted = await deleteFeedbackTicket(ticketId);

    if (!deleted) {
      return apiFailure('not_found', 'That feedback no longer exists.', 404);
    }

    return apiSuccess({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
