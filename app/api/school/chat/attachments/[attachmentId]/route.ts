import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, handleApiError } from '@/lib/api-response';
import { attachmentResponse } from '@/lib/attachment-response';
import { attachmentForDownload } from '@/lib/chat-attachments';
import { isParticipant } from '@/lib/chat-queries';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { downloadObject } from '@/lib/storage';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/chat/attachments/[id] — the file, through a proxy.
 *
 * ── Never a public URL, and the difference is not cosmetic ───────────────
 * `student_documents` caches a public download URL on the row;
 * `feedback_attachments` stores only a path and serves through a route. This
 * follows feedback, deliberately.
 *
 * `attachmentResponse` sets `Content-Disposition: attachment` and
 * `X-Content-Type-Options: nosniff`, and `lib/attachment-response.ts` explains
 * that `inline` on a PDF would let an uploaded file execute on the portal's own
 * origin. It also sets `Cache-Control: private, no-store`, which matters here
 * more than anywhere else in the product: prerendered pages on this deployment
 * ship a year-long `s-maxage`, and a file somebody sent a fourteen-year-old
 * does not belong in a CDN.
 *
 * ── An attachment id is not a capability ─────────────────────────────────
 * Holding the id proves nothing. Membership of the conversation the attachment
 * hangs off is re-resolved on this request, from `school_users`, exactly as the
 * transcript route does — and a non-participant is told 404 rather than 403,
 * because whether a file exists is itself something they should not learn.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ attachmentId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { attachmentId } = await context.params;

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) return apiFailure('not_found', 'Not found.', 404);

      const attachment = await attachmentForDownload(auth.locationId, attachmentId);
      if (attachment === null) return apiFailure('not_found', 'Not found.', 404);

      if (!(await isParticipant(auth.locationId, attachment.conversationId, me.id))) {
        return apiFailure('not_found', 'Not found.', 404);
      }

      const object = await downloadObject(attachment.storagePath);
      if (object === null) {
        // The row survived and the object did not. Saying so is more useful
        // than a 404 that reads as "you cannot see this".
        return apiFailure('not_found', 'That file is no longer stored.', 404);
      }

      return attachmentResponse(object, attachment.fileName, attachment.contentType);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES },
);
