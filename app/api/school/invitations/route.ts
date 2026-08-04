import { and, desc, eq, gt, isNull } from 'drizzle-orm';

import { branches, schoolInvitations } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { db } from '@/lib/drizzle';

/* WHATSAPP_DISABLED_START */
// WhatsApp auth temporarily disabled - re-enable when Meta template approved
//
// Imports used only by the disabled POST handler below. Restore them together
// with it, not before — an unused import is a lint error waiting to happen.
//
// import { randomBytes } from 'node:crypto';
// import { inviteExpiryFromNow, schools } from '@/db/schema';
// import { readJsonBody } from '@/lib/api-response';
// import { buildInviteUrl } from '@/lib/invite-links';
// import { InviteDeliveryError, sendInvite } from '@/lib/invite-sender';
// import { isUuid, readOptionalString, readString } from '@/lib/validation';
// import { BRANCH_REQUIRED_ROLES, isUserRole } from '@/types/school-auth';
/* WHATSAPP_DISABLED_END */

/**
 * /api/school/invitations
 *
 * GET  pending WhatsApp invitations (not yet accepted, not yet expired)
 * POST WhatsApp auth temporarily disabled - re-enable when Meta template approved
 *
 * Creating an invitation here delivered it over WhatsApp. Invitations are now
 * sent by email through `/api/school/users/invite`, which posts through the
 * school's own GHL sub-account, so this POST answers 503 rather than sending.
 *
 * GET still works and acceptance is untouched: invitations created before the
 * switch remain listable and `/invite/[token]` can still complete them. What is
 * disabled is creating new ones, not honouring the ones already out.
 *
 * The original handler is intact between the WHATSAPP_DISABLED markers below.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* WHATSAPP_DISABLED_START */
// WhatsApp auth temporarily disabled - re-enable when Meta template approved
//
// /** Loose E.164-ish check: 7–15 digits, optional leading +. */
// function isPlausiblePhone(phone: string): boolean {
//   return /^\+?[0-9\s-]{7,20}$/.test(phone) && phone.replace(/\D/g, '').length >= 7;
// }
/* WHATSAPP_DISABLED_END */

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const rows = await db
        .select({
          id: schoolInvitations.id,
          name: schoolInvitations.name,
          phone: schoolInvitations.phone,
          email: schoolInvitations.email,
          role: schoolInvitations.role,
          branchId: schoolInvitations.branchId,
          branchName: branches.name,
          whatsappSent: schoolInvitations.whatsappSent,
          emailSent: schoolInvitations.emailSent,
          expiresAt: schoolInvitations.expiresAt,
          createdAt: schoolInvitations.createdAt,
        })
        .from(schoolInvitations)
        .leftJoin(branches, eq(branches.id, schoolInvitations.branchId))
        .where(
          and(
            eq(schoolInvitations.locationId, auth.locationId),
            isNull(schoolInvitations.acceptedAt),
            gt(schoolInvitations.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(schoolInvitations.createdAt));

      return apiSuccess({ invitations: rows });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'users.write' },
);

export const POST = withSchoolAuth(
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
// interface CreateInviteBody {
//   name?: unknown;
//   phone?: unknown;
//   email?: unknown;
//   role?: unknown;
//   branchId?: unknown;
// }
//
// export const POST = withSchoolAuth(
//   async (request, auth) => {
//     try {
//       const body = await readJsonBody<CreateInviteBody>(request);
//       if (body === null) {
//         return apiFailure('invalid_body', 'Expected a JSON body.', 400);
//       }
//
//       const name = readString(body.name);
//       const phone = readString(body.phone);
//       const email = readOptionalString(body.email);
//
//       if (name === '') {
//         return apiFailure('invalid_body', 'Name is required.', 400);
//       }
//       if (!isPlausiblePhone(phone)) {
//         return apiFailure('invalid_body', 'Enter a valid phone number.', 400);
//       }
//       if (!isUserRole(body.role)) {
//         return apiFailure('invalid_body', 'Select a valid role.', 400);
//       }
//
//       const branchId = typeof body.branchId === 'string' ? body.branchId : null;
//
//       if (BRANCH_REQUIRED_ROLES.includes(body.role) && branchId === null) {
//         return apiFailure('invalid_body', 'This role requires a branch.', 400);
//       }
//
//       if (branchId !== null) {
//         if (!isUuid(branchId)) {
//           return apiFailure('invalid_body', 'That branch does not exist.', 400);
//         }
//
//         const owned = await db
//           .select({ id: branches.id })
//           .from(branches)
//           .where(and(eq(branches.id, branchId), eq(branches.locationId, auth.locationId)))
//           .limit(1);
//
//         if (owned[0] === undefined) {
//           return apiFailure('invalid_body', 'That branch does not exist.', 400);
//         }
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
//       const token = randomBytes(32).toString('hex');
//       const inviteUrl = buildInviteUrl(token, school.slug);
//
//       let delivery;
//       try {
//         delivery = await sendInvite({
//           locationId: auth.locationId,
//           invitation: { name, phone, email, role: body.role },
//           school: { name: school.name },
//           inviteUrl,
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
//       const inserted = await db
//         .insert(schoolInvitations)
//         .values({
//           locationId: auth.locationId,
//           name,
//           phone,
//           email,
//           role: body.role,
//           branchId,
//           invitedByUid: auth.uid,
//           token,
//           whatsappSent: delivery.whatsappSent,
//           emailSent: delivery.emailSent,
//           whatsappMessageId: delivery.whatsappMessageId,
//           expiresAt: inviteExpiryFromNow(),
//         })
//         .returning({
//           id: schoolInvitations.id,
//           name: schoolInvitations.name,
//           phone: schoolInvitations.phone,
//           role: schoolInvitations.role,
//           expiresAt: schoolInvitations.expiresAt,
//           whatsappSent: schoolInvitations.whatsappSent,
//           emailSent: schoolInvitations.emailSent,
//         });
//
//       return apiSuccess(
//         { invitation: inserted[0], delivery: { failures: delivery.failures } },
//         201,
//       );
//     } catch (error) {
//       return handleApiError(error);
//     }
//   },
//   { permission: 'users.write' },
// );
/* WHATSAPP_DISABLED_END */
