import { and, eq } from 'drizzle-orm';

import { schoolInvitations } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { db } from '@/lib/drizzle';
import { isUuid } from '@/lib/validation';

/**
 * DELETE /api/school/invitations/[inviteRef]/cancel
 *
 * Expires the invitation immediately rather than deleting the row, so the
 * record of who invited whom survives and the token stops working at once.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ inviteRef: string }> };

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { inviteRef } = await context.params;
      if (!isUuid(inviteRef)) {
        return apiFailure('not_found', 'Invitation not found.', 404);
      }

      const updated = await db
        .update(schoolInvitations)
        .set({ expiresAt: new Date() })
        .where(
          and(
            eq(schoolInvitations.id, inviteRef),
            eq(schoolInvitations.locationId, auth.locationId),
          ),
        )
        .returning({ id: schoolInvitations.id, expiresAt: schoolInvitations.expiresAt });

      const invitation = updated[0];
      if (invitation === undefined) {
        return apiFailure('not_found', 'Invitation not found.', 404);
      }

      return apiSuccess({ invitation, cancelled: true });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);
