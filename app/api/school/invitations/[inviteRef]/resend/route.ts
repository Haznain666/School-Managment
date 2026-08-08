import { and, eq } from 'drizzle-orm';

import { inviteExpiryFromNow, schoolInvitations, schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { db } from '@/lib/drizzle';
import { buildInviteUrl } from '@/lib/invite-links';
import { InviteDeliveryError, sendInvite } from '@/lib/invite-sender';
import { isUuid } from '@/lib/validation';
import { isUserRole } from '@/types/school-auth';

/**
 * POST /api/school/invitations/[inviteRef]/resend
 *
 * Extends the deadline and sends the same link again. The token is deliberately
 * unchanged, so a link someone already received but has not used yet starts
 * working again rather than being silently invalidated.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ inviteRef: string }> };

export const POST = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { inviteRef } = await context.params;
      if (!isUuid(inviteRef)) {
        return apiFailure('not_found', 'Invitation not found.', 404);
      }

      const rows = await db
        .select()
        .from(schoolInvitations)
        .where(
          and(
            eq(schoolInvitations.id, inviteRef),
            // Tenant check: an invitation from another school is not visible.
            eq(schoolInvitations.locationId, auth.locationId),
          ),
        )
        .limit(1);

      const invitation = rows[0];
      if (invitation === undefined) {
        return apiFailure('not_found', 'Invitation not found.', 404);
      }
      if (invitation.acceptedAt !== null) {
        return apiFailure('already_used', 'That invitation was already accepted.', 409);
      }
      if (!isUserRole(invitation.role)) {
        return apiFailure('invalid_invite', 'That invitation is no longer valid.', 409);
      }

      const schoolRows = await db
        .select({ name: schools.name, slug: schools.slug })
        .from(schools)
        .where(eq(schools.locationId, auth.locationId))
        .limit(1);

      const school = schoolRows[0];
      if (school === undefined) {
        return apiFailure('not_found', 'School not found.', 404);
      }

      let delivery;
      try {
        delivery = await sendInvite({
          locationId: auth.locationId,
          invitation: {
            name: invitation.name,
            phone: invitation.phone,
            email: invitation.email,
            role: invitation.role,
          },
          school: { name: school.name },
          inviteUrl: buildInviteUrl(invitation.token, school.slug),
        });
      } catch (error) {
        if (error instanceof InviteDeliveryError) {
          return apiFailure(
            'delivery_failed',
            `The invitation could not be delivered. ${error.failures.join(' ')}`.trim(),
            502,
          );
        }
        throw error;
      }

      const updated = await db
        .update(schoolInvitations)
        .set({
          expiresAt: inviteExpiryFromNow(),
          whatsappSent: delivery.whatsappSent,
          // The column predates the outbox and now records that the message
          // was queued rather than accepted by an SMTP server. Renaming it
          // would cost a migration for a distinction the schema cannot make
          // anyway — where it surfaces, the UI says "Email queued".
          emailSent: delivery.emailQueued,
          whatsappMessageId: delivery.whatsappMessageId,
        })
        .where(
          and(
            eq(schoolInvitations.id, inviteRef),
            eq(schoolInvitations.locationId, auth.locationId),
          ),
        )
        .returning({
          id: schoolInvitations.id,
          expiresAt: schoolInvitations.expiresAt,
          whatsappSent: schoolInvitations.whatsappSent,
          emailSent: schoolInvitations.emailSent,
        });

      return apiSuccess({
        invitation: updated[0],
        delivery: { failures: delivery.failures },
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);
