import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, handleApiError } from '@/lib/api-response';
import { getFeedbackAttachment } from '@/lib/feedback-queries';
import { downloadObject } from '@/lib/storage';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

import { attachmentResponse } from '../../attachment-response';

/**
 * GET /api/school/feedback/attachments/[attachmentId] — download one file.
 *
 * ── Why the file is served rather than linked ────────────────────────────
 * `school-assets` is a public bucket, so a stored public URL is a permanent
 * credential-free link to the object. A feedback screenshot is a picture of a
 * school's own data — a fee register, a roll — and once that URL exists it
 * works for anybody who ever sees it, including after the ticket is deleted.
 *
 * So the path is never published, and this route is the only way to the bytes.
 * The tenant on the attachment's ticket is compared with the tenant on the
 * verified session, which is what stops one school's administrator opening
 * another school's evidence with a forwarded link.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth<{ params: Promise<{ attachmentId: string }> }>(
  async (_request, auth, context) => {
    try {
      const { attachmentId } = await context.params;

      const attachment = await getFeedbackAttachment(attachmentId);

      // One 404 for "no such row" and for "not yours". Telling the second case
      // apart from the first confirms the id exists, which is the one fact a
      // guessing caller does not already have.
      if (attachment === null || attachment.locationId !== auth.locationId) {
        return apiFailure('not_found', 'That attachment no longer exists.', 404);
      }

      const object = await downloadObject(attachment.storagePath);
      if (object === null) {
        return apiFailure('not_found', 'That file is no longer stored.', 404);
      }

      return attachmentResponse(object, attachment.fileName, attachment.contentType);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ADMIN_PORTAL_ROLES },
);
