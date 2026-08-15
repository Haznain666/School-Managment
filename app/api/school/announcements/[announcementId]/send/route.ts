import { getAnnouncement, sendAnnouncement } from '@/lib/announcement-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/announcements/[announcementId]/send
 *
 * Puts the announcement on the notice board and queues its email run.
 *
 * Behind `comms.send` rather than `comms.write`, because this is the
 * irreversible half: a notice appears in front of every parent it is addressed
 * to, and an email that has left the outbox cannot be recalled.
 *
 * The response reports what was *queued*, never what was delivered. `STATE.md`
 * §5k is why nothing here waits for SMTP — one message measured at ~103
 * seconds, and a campaign to four hundred families cannot run inside a request
 * at any speed. A screen that said "Sent" when it meant "queued" would be a
 * worse lie than the spinner the outbox replaced.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ announcementId: string }>;
}

export const POST = withSchoolAuth<Params>(
  async (_request, auth, context) => {
    try {
      const { announcementId } = await context.params;
      if (!isUuid(announcementId)) {
        return apiFailure('not_found', 'That announcement was not found.', 404);
      }

      const existing = await getAnnouncement(auth.locationId, announcementId);
      if (existing === null) {
        return apiFailure('not_found', 'That announcement was not found.', 404);
      }
      if (existing.status === 'sent') {
        // Refused rather than repeated: sending twice would queue a second
        // email to everybody who already has one.
        return apiFailure('conflict', 'This has already been sent.', 409);
      }

      const outcome = await sendAnnouncement(auth.locationId, announcementId);
      if (outcome === null) {
        return apiFailure('server_error', 'The announcement could not be sent.', 500);
      }

      return apiSuccess(outcome);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'comms.send' },
);
