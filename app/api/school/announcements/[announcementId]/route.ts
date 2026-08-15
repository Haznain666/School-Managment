import {
  deleteAnnouncement,
  getAnnouncement,
  parseAnnouncementInput,
  updateAnnouncement,
} from '@/lib/announcement-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/announcements/[announcementId]
 *
 * GET    one announcement
 * PATCH  edit one that has not been sent
 * DELETE discard one that has not been sent
 *
 * A sent announcement is deliberately immutable. People have already read it,
 * some of them in an email that cannot be recalled, and a notice board that
 * quietly disagreed with the email a parent is holding is worse than a second
 * notice correcting the first. The same reasoning makes it undeletable: the
 * delivery log is the record that answers "did we tell the parents".
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ announcementId: string }>;
}

export const GET = withSchoolAuth<Params>(
  async (_request, auth, context) => {
    try {
      const { announcementId } = await context.params;
      if (!isUuid(announcementId)) {
        return apiFailure('not_found', 'That announcement was not found.', 404);
      }

      const announcement = await getAnnouncement(auth.locationId, announcementId);
      if (announcement === null) {
        return apiFailure('not_found', 'That announcement was not found.', 404);
      }

      return apiSuccess({ announcement });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'comms.read' },
);

export const PATCH = withSchoolAuth<Params>(
  async (request, auth, context) => {
    try {
      const { announcementId } = await context.params;
      if (!isUuid(announcementId)) {
        return apiFailure('not_found', 'That announcement was not found.', 404);
      }

      const body = await readJsonBody<Record<string, unknown>>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const input = parseAnnouncementInput(body);
      if (typeof input === 'string') {
        return apiFailure('invalid_body', input, 400);
      }

      const updated = await updateAnnouncement(auth.locationId, announcementId, input);
      if (!updated) {
        // Either it is not this school's, or it has been sent. Both are refused
        // the same way on purpose: telling an unauthorised caller which of the
        // two it was would confirm that the announcement exists.
        const existing = await getAnnouncement(auth.locationId, announcementId);
        return existing?.status === 'sent'
          ? apiFailure(
              'conflict',
              'This has already been sent, so it can no longer be edited. Send a follow-up instead.',
              409,
            )
          : apiFailure('not_found', 'That announcement was not found.', 404);
      }

      return apiSuccess({ announcementId });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'comms.write' },
);

export const DELETE = withSchoolAuth<Params>(
  async (_request, auth, context) => {
    try {
      const { announcementId } = await context.params;
      if (!isUuid(announcementId)) {
        return apiFailure('not_found', 'That announcement was not found.', 404);
      }

      const deleted = await deleteAnnouncement(auth.locationId, announcementId);
      if (!deleted) {
        const existing = await getAnnouncement(auth.locationId, announcementId);
        return existing?.status === 'sent'
          ? apiFailure(
              'conflict',
              'This has been sent. It stays as the record of what the school told people.',
              409,
            )
          : apiFailure('not_found', 'That announcement was not found.', 404);
      }

      return apiSuccess({ announcementId });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'comms.write' },
);
