import { isAnnouncementStatus } from '@/db/schema';
import { resolveAudience } from '@/lib/announcement-audience';
import {
  createAnnouncement,
  listAnnouncements,
  parseAnnouncementInput,
} from '@/lib/announcement-queries';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getSchoolUserByUid } from '@/lib/school-queries';

/**
 * /api/school/announcements
 *
 * GET  every announcement this school has written, drafts included
 * POST write a new one
 *
 * Writing is separate from sending. A draft reaches nobody, which is what lets
 * a coordinator holding `comms.write` prepare a notice that a head holding
 * `comms.send` releases — the two permissions are split in
 * `lib/permissions.ts` for exactly this.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const status = url.searchParams.get('status');

      return apiSuccess({
        announcements: await listAnnouncements(auth.locationId, {
          status: isAnnouncementStatus(status) ? status : undefined,
        }),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'comms.read' },
);

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<Record<string, unknown>>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const input = parseAnnouncementInput(body);
      if (typeof input === 'string') {
        return apiFailure('invalid_body', input, 400);
      }

      const author = await getSchoolUserByUid(auth.locationId, auth.uid);

      const id = await createAnnouncement(auth.locationId, input, author?.id ?? null);
      if (id === null) {
        return apiFailure('server_error', 'The announcement could not be saved.', 500);
      }

      // The count is resolved through the tenant-filtered audience query, which
      // is also what re-reads the branch id that arrived in the body: the
      // foreign key is not scoped by tenant, so Postgres alone would let this
      // school's announcement point at another school's campus.
      const members = await resolveAudience(auth.locationId, input.audience, input.branchId);

      return apiSuccess({ announcementId: id, reaches: members.length }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'comms.write' },
);
