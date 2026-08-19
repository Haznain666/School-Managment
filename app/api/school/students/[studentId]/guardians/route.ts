import { and, eq, ne } from 'drizzle-orm';

import {
  schoolUsers,
  studentEnrollments,
  studentGuardians,
  isGuardianRelationship,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getStudentDetail, listGuardians } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { createGuardianGHLContact } from '@/lib/ghl-admissions';
import { MAX_GUARDIANS } from '@/lib/enrollment';
import { provisionGuardianPortalAccess } from '@/lib/parent-portal-access';
import { InvalidPhoneError, normalizePhone } from '@/lib/phone';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/students/[studentId]/guardians
 *
 * GET  everyone the school may contact about this child
 * POST add another
 *
 * A new guardian is mirrored into GHL immediately, but a failed mirror does not
 * fail the request — the row is the record, the CRM contact is a copy of it.
 *
 * ── The welcome, and the one condition on it ─────────────────────────────
 * A guardian with an email address is given a parent portal account and a
 * welcome carrying the link to set a password. That used to happen nowhere at
 * all, which is why every guardian in the system read "No portal account".
 *
 * It is held back for exactly one case: a student whose admission fee has not
 * cleared yet. Those guardians are welcomed by `lib/enrolment-fee-gate.ts` the
 * moment the money lands. A guardian added to a student already on the roll —
 * a second parent, a grandmother — is welcomed here and now, because there is
 * nothing left for them to wait for.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ studentId: string }> };

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { studentId } = await context.params;
      if (!isUuid(studentId)) return apiFailure('not_found', 'Student not found.', 404);

      const student = await getStudentDetail(auth.locationId, studentId);
      if (student === null) return apiFailure('not_found', 'Student not found.', 404);

      return apiSuccess({ guardians: await listGuardians(auth.locationId, studentId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  {
    permission: 'admissions.read',
  },
);

interface CreateGuardianBody {
  name?: unknown;
  relationship?: unknown;
  phone?: unknown;
  email?: unknown;
  cnic?: unknown;
  occupation?: unknown;
  isPrimaryContact?: unknown;
}

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { studentId } = await context.params;
      if (!isUuid(studentId)) return apiFailure('not_found', 'Student not found.', 404);

      const student = await getStudentDetail(auth.locationId, studentId);
      if (student === null) return apiFailure('not_found', 'Student not found.', 404);

      if (auth.branchId !== null && student.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      const body = await readJsonBody<CreateGuardianBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const name = readString(body.name);
      if (name === '') {
        return apiFailure('invalid_body', 'The guardian’s name is required.', 400);
      }

      const relationship = readString(body.relationship);
      if (!isGuardianRelationship(relationship)) {
        return apiFailure('invalid_body', 'Select a valid relationship.', 400);
      }

      let phone: string;
      try {
        phone = normalizePhone(readString(body.phone));
      } catch (error) {
        if (error instanceof InvalidPhoneError) {
          return apiFailure(
            'invalid_phone',
            'Enter a valid Pakistani mobile number, for example 0300-1234567.',
            400,
          );
        }
        throw error;
      }

      const existing = await listGuardians(auth.locationId, studentId);
      if (existing.length >= MAX_GUARDIANS) {
        return apiFailure(
          'too_many',
          `A student may have at most ${MAX_GUARDIANS} guardians.`,
          409,
        );
      }

      if (existing.some((guardian) => guardian.phone === phone)) {
        return apiFailure(
          'already_exists',
          'That number is already recorded as a guardian for this student.',
          409,
        );
      }

      // The first guardian on a record is always the primary contact — someone
      // has to be the number the school actually rings.
      const isPrimaryContact = existing.length === 0 || body.isPrimaryContact === true;

      // If this guardian already has a portal account at this school, link it:
      // that link is what makes the child appear in their parent portal.
      const accountRows = await db
        .select({ id: schoolUsers.id })
        .from(schoolUsers)
        .where(
          and(eq(schoolUsers.locationId, auth.locationId), eq(schoolUsers.phone, phone)),
        )
        .limit(1);

      const inserted = await db
        .insert(studentGuardians)
        .values({
          locationId: auth.locationId,
          studentProfileId: studentId,
          schoolUserId: accountRows[0]?.id ?? null,
          name,
          relationship,
          phone,
          email: readOptionalString(body.email),
          cnic: readOptionalString(body.cnic),
          occupation: readOptionalString(body.occupation),
          isPrimaryContact,
        })
        .returning({ id: studentGuardians.id });

      const guardian = inserted[0];
      if (guardian === undefined) {
        return apiFailure('write_failed', 'Could not add the guardian.', 500);
      }

      // Demote the incumbent afterwards, so a failure here leaves two primaries
      // rather than none — the notification path can resolve the first, but has
      // nothing to fall back on if there are zero.
      if (isPrimaryContact) {
        await db
          .update(studentGuardians)
          .set({ isPrimaryContact: false })
          .where(
            and(
              eq(studentGuardians.locationId, auth.locationId),
              eq(studentGuardians.studentProfileId, studentId),
              ne(studentGuardians.id, guardian.id),
            ),
          );
      }

      try {
        const contactId = await createGuardianGHLContact(db, auth.locationId, {
          name,
          phone,
          email: readOptionalString(body.email) ?? undefined,
        });

        await db
          .update(studentGuardians)
          .set({ ghlContactId: contactId })
          .where(
            and(
              eq(studentGuardians.id, guardian.id),
              eq(studentGuardians.locationId, auth.locationId),
            ),
          );
      } catch (error) {
        console.warn('[guardians] GHL sync failed for a new guardian:', error);
      }

      /*
       * The fee gate, read rather than assumed.
       *
       * `feeStatus` lives on the *active* enrolment. A student with none —
       * withdrawn, transferred out, or a profile with no placement yet — has
       * no admission to gate, so their guardians are welcomed immediately;
       * holding them back would leave the welcome waiting on a payment nobody
       * is going to make.
       */
      const enrolments = await db
        .select({ feeStatus: studentEnrollments.feeStatus })
        .from(studentEnrollments)
        .where(
          and(
            eq(studentEnrollments.locationId, auth.locationId),
            eq(studentEnrollments.studentProfileId, studentId),
            eq(studentEnrollments.status, 'active'),
          ),
        )
        .limit(1);

      const awaitingFee = enrolments[0]?.feeStatus === 'outstanding';

      const access = awaitingFee
        ? null
        : await provisionGuardianPortalAccess({
            locationId: auth.locationId,
            guardianId: guardian.id,
            actorUid: auth.uid,
          });

      return apiSuccess(
        {
          guardians: await listGuardians(auth.locationId, studentId),
          access:
            access === null
              ? {
                  emailQueued: false,
                  reason:
                    'This student’s admission fee has not been paid yet. The parent portal welcome goes out automatically once it clears.',
                }
              : { emailQueued: access.emailQueued, reason: access.reason },
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
