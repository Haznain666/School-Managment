import type { NextRequest } from 'next/server';

import { attachmentResponse } from '@/app/api/school/feedback/attachment-response';
import { apiFailure, handleApiError } from '@/lib/api-response';
import { getFeedbackAttachment } from '@/lib/feedback-queries';
import { downloadObject } from '@/lib/storage';
import { requireSuperAdmin } from '@/lib/super-admin-guard';

/**
 * GET /api/super-admin/feedback/attachments/[attachmentId] — download one file.
 *
 * Cross-tenant, like everything else on this surface: the operator reading a
 * bug report needs the screenshot that came with it, whichever school sent it.
 * The headers are shared with the school route rather than restated, because
 * they are the security posture of the endpoint and two copies drift — see
 * `attachment-response.ts`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ attachmentId: string }> },
) {
  try {
    await requireSuperAdmin();

    const { attachmentId } = await context.params;

    const attachment = await getFeedbackAttachment(attachmentId);
    if (attachment === null) {
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
}
