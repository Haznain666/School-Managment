import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { REPLY_MAX } from '@/lib/feedback';
import { addFeedbackReply, getFeedbackTicket } from '@/lib/feedback-queries';
import { notify, platformOwnerEmail } from '@/lib/notifications';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { getSchoolBranding } from '@/lib/school-tenant';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

/**
 * POST /api/school/feedback/[ticketId]/replies — the school's side of the
 * conversation.
 *
 * The ticket is fetched with the session's own `locationId`, so a ticket id
 * belonging to another school resolves to null and answers 404 rather than
 * accepting a reply onto somebody else's bug report. That check is the whole
 * guard and it is deliberately not a separate `if`: there is no code path here
 * that reads a ticket without its tenant.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  body?: unknown;
}

export const POST = withSchoolAuth<{ params: Promise<{ ticketId: string }> }>(
  async (request, auth, context) => {
    try {
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

      const ticket = await getFeedbackTicket(ticketId, auth.locationId);
      if (ticket === null) {
        return apiFailure('not_found', 'That feedback no longer exists.', 404);
      }

      const [me, branding] = await Promise.all([
        getSchoolUserByUid(auth.locationId, auth.uid),
        getSchoolBranding(auth.locationId),
      ]);

      const authorName = me?.name ?? 'A school administrator';
      const schoolName = branding?.name ?? 'A school';

      const reply = await addFeedbackReply({
        ticketId,
        authorKind: 'school',
        authorSchoolUserId: me?.id ?? null,
        authorName,
        body: message,
      });

      await notify({
        audience: 'super_admin',
        locationId: auth.locationId,
        kind: 'feedback_reply',
        title: `Reply on "${ticket.title}"`,
        body: `${schoolName} — ${authorName} replied.`,
        href: `/super-admin/feedback/${ticketId}`,
        email: platformOwnerEmail(),
        emailSubject: `Reply from ${schoolName}: ${ticket.title}`,
        emailText: `${authorName} at ${schoolName} replied to their feedback.\n\n${message}\n`,
      });

      return apiSuccess({ id: reply.id }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ADMIN_PORTAL_ROLES },
);
