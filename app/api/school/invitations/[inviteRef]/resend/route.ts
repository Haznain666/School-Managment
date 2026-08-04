import { apiFailure } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';

/* WHATSAPP_DISABLED_START */
// WhatsApp auth temporarily disabled - re-enable when Meta template approved
//
// Imports used only by the disabled handler below. Restore them with it.
//
// import { and, eq } from 'drizzle-orm';
// import { inviteExpiryFromNow, schoolInvitations, schools } from '@/db/schema';
// import { apiSuccess, handleApiError } from '@/lib/api-response';
// import { db } from '@/lib/drizzle';
// import { buildInviteUrl } from '@/lib/invite-links';
// import { InviteDeliveryError, sendInvite } from '@/lib/invite-sender';
// import { isUuid } from '@/lib/validation';
// import { isUserRole } from '@/types/school-auth';
/* WHATSAPP_DISABLED_END */

/**
 * POST /api/school/invitations/[inviteRef]/resend
 *
 * WhatsApp auth temporarily disabled - re-enable when Meta template approved
 *
 * Resending extended the deadline and pushed the same link out over WhatsApp
 * again. Invitations are now sent by email through `/api/school/users/invite`,
 * and inviting the same address twice there supersedes the pending invitation —
 * which is what "resend" means now.
 *
 * The original handler is intact between the WHATSAPP_DISABLED markers below.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ inviteRef: string }> };

export const POST = withSchoolAuth<RouteContext>(
  async () => {
    // WhatsApp auth temporarily disabled - re-enable when Meta template approved
    return apiFailure(
      'whatsapp_disabled',
      'WhatsApp invitations are temporarily unavailable. Invite this person by email instead.',
      503,
    );
  },
  { permission: 'users.write' },
);

/* WHATSAPP_DISABLED_START */
// WhatsApp auth temporarily disabled - re-enable when Meta template approved
//
// export const POST = withSchoolAuth<RouteContext>(
//   async (_request, auth, context) => {
//     try {
//       const { inviteRef } = await context.params;
//       if (!isUuid(inviteRef)) {
//         return apiFailure('not_found', 'Invitation not found.', 404);
//       }
//
//       const rows = await db
//         .select()
//         .from(schoolInvitations)
//         .where(
//           and(
//             eq(schoolInvitations.id, inviteRef),
//             // Tenant check: an invitation from another school is not visible.
//             eq(schoolInvitations.locationId, auth.locationId),
//           ),
//         )
//         .limit(1);
//
//       const invitation = rows[0];
//       if (invitation === undefined) {
//         return apiFailure('not_found', 'Invitation not found.', 404);
//       }
//       if (invitation.acceptedAt !== null) {
//         return apiFailure('already_used', 'That invitation was already accepted.', 409);
//       }
//       if (!isUserRole(invitation.role)) {
//         return apiFailure('invalid_invite', 'That invitation is no longer valid.', 409);
//       }
//
//       const schoolRows = await db
//         .select({ name: schools.name, slug: schools.slug })
//         .from(schools)
//         .where(eq(schools.locationId, auth.locationId))
//         .limit(1);
//
//       const school = schoolRows[0];
//       if (school === undefined) {
//         return apiFailure('not_found', 'School not found.', 404);
//       }
//
//       let delivery;
//       try {
//         delivery = await sendInvite({
//           locationId: auth.locationId,
//           invitation: {
//             name: invitation.name,
//             phone: invitation.phone,
//             email: invitation.email,
//             role: invitation.role,
//           },
//           school: { name: school.name },
//           inviteUrl: buildInviteUrl(invitation.token, school.slug),
//         });
//       } catch (error) {
//         if (error instanceof InviteDeliveryError) {
//           return apiFailure(
//             'delivery_failed',
//             `The invitation could not be delivered. ${error.failures.join(' ')}`.trim(),
//             502,
//           );
//         }
//         throw error;
//       }
//
//       const updated = await db
//         .update(schoolInvitations)
//         .set({
//           expiresAt: inviteExpiryFromNow(),
//           whatsappSent: delivery.whatsappSent,
//           emailSent: delivery.emailSent,
//           whatsappMessageId: delivery.whatsappMessageId,
//         })
//         .where(
//           and(
//             eq(schoolInvitations.id, inviteRef),
//             eq(schoolInvitations.locationId, auth.locationId),
//           ),
//         )
//         .returning({
//           id: schoolInvitations.id,
//           expiresAt: schoolInvitations.expiresAt,
//           whatsappSent: schoolInvitations.whatsappSent,
//           emailSent: schoolInvitations.emailSent,
//         });
//
//       return apiSuccess({
//         invitation: updated[0],
//         delivery: { failures: delivery.failures },
//       });
//     } catch (error) {
//       return handleApiError(error);
//     }
//   },
//   { permission: 'users.write' },
// );
/* WHATSAPP_DISABLED_END */
