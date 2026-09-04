import { and, eq } from 'drizzle-orm';

import {
  schoolUsers,
  studentProfiles,
  isBloodGroup,
  isGender,
  isIdDocumentType,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  getStudentDetail,
  listEnrollmentHistory,
  listGuardians,
} from '@/lib/admissions-queries';
import { batch, db } from '@/lib/drizzle';
import { countPaymentsForStudent } from '@/lib/fee-queries';
import { isValidCnic } from '@/lib/national-id';
import { applyDeparture } from '@/lib/student-departure';
import {
  familyIdsBeforeDeparture,
  reconcileSiblingGrantsFor,
} from '@/lib/sibling-discounts';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/students/[studentId]
 *
 * `studentId` here is the `student_profiles.id` UUID, not the printed
 * admission number — the number is the school's identifier for a person, the
 * UUID is the platform's identifier for a row.
 *
 * GET    the full profile, with guardians and enrollment history
 * PATCH  the personal details
 * DELETE the whole record, when the school has never taken money for it
 *
 * The admission number and the link to the directory row are not updatable:
 * one is referenced by everything the school prints, the other is the record's
 * identity. Changing which class the student is in is an enrollment change, and
 * belongs to the enrollment tables rather than here.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ studentId: string }> };


const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { studentId } = await context.params;
      if (!isUuid(studentId)) return apiFailure('not_found', 'Student not found.', 404);

      const student = await getStudentDetail(auth.locationId, studentId);
      if (student === null) return apiFailure('not_found', 'Student not found.', 404);

      if (auth.branchId !== null && student.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      const [guardians, enrollments] = await Promise.all([
        listGuardians(auth.locationId, studentId),
        listEnrollmentHistory(auth.locationId, studentId),
      ]);

      return apiSuccess({ student, guardians, enrollments });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.read' },
);

interface UpdateStudentBody {
  dateOfBirth?: unknown;
  gender?: unknown;
  bFormCnic?: unknown;
  idDocumentType?: unknown;
  bloodGroup?: unknown;
  nationality?: unknown;
  religion?: unknown;
  previousSchool?: unknown;
  medicalNotes?: unknown;
  photoUrl?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { studentId } = await context.params;
      if (!isUuid(studentId)) return apiFailure('not_found', 'Student not found.', 404);

      const existing = await getStudentDetail(auth.locationId, studentId);
      if (existing === null) return apiFailure('not_found', 'Student not found.', 404);

      if (auth.branchId !== null && existing.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      const body = await readJsonBody<UpdateStudentBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const updates: Partial<typeof studentProfiles.$inferInsert> = {};

      if (body.dateOfBirth !== undefined) {
        const value = readOptionalString(body.dateOfBirth);
        if (value !== null && (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value)))) {
          return apiFailure('invalid_body', 'Date of birth must be a valid date.', 400);
        }
        updates.dateOfBirth = value;
      }

      if (body.gender !== undefined) {
        const value = readOptionalString(body.gender);
        if (value !== null && !isGender(value)) {
          return apiFailure('invalid_body', 'Select a valid gender.', 400);
        }
        updates.gender = value;
      }

      if (body.bloodGroup !== undefined) {
        const value = readOptionalString(body.bloodGroup);
        if (value !== null && !isBloodGroup(value)) {
          return apiFailure('invalid_body', 'Select a valid blood group.', 400);
        }
        updates.bloodGroup = value;
      }

      if (body.nationality !== undefined) {
        const value = readString(body.nationality);
        if (value === '') {
          return apiFailure('invalid_body', 'Nationality cannot be empty.', 400);
        }
        updates.nationality = value;
      }

      /*
       * The number and the document it is are edited together or not at all.
       * Letting one move without the other is how a record ends up claiming a
       * B-Form number is a CNIC: a clerk corrects the digits, the stale type
       * stays, and nothing on screen says so. So a request that touches either
       * has to carry both, and both are re-validated as `parseStudentInput`
       * does on enrollment.
       */
      if (body.bFormCnic !== undefined || body.idDocumentType !== undefined) {
        const number = readOptionalString(body.bFormCnic);
        const documentType = readOptionalString(body.idDocumentType);

        if (number === null) {
          // No number, no document — a type left behind on a cleared field
          // would describe nothing.
          updates.bFormCnic = null;
          updates.idDocumentType = null;
        } else {
          if (!isIdDocumentType(documentType)) {
            return apiFailure(
              'invalid_body',
              'Choose whether that number is a CNIC / Smart Card or a B-Form.',
              400,
            );
          }

          if (documentType === 'cnic' && !isValidCnic(number)) {
            return apiFailure(
              'invalid_body',
              'A CNIC / Smart Card number is 13 digits, as 42101-1234567-1.',
              400,
            );
          }

          updates.bFormCnic = number;
          updates.idDocumentType = documentType;
        }
      }

      if (body.religion !== undefined) updates.religion = readOptionalString(body.religion);
      if (body.previousSchool !== undefined) {
        updates.previousSchool = readOptionalString(body.previousSchool);
      }
      if (body.medicalNotes !== undefined) {
        updates.medicalNotes = readOptionalString(body.medicalNotes);
      }
      if (body.photoUrl !== undefined) updates.photoUrl = readOptionalString(body.photoUrl);

      if (Object.keys(updates).length === 0) {
        return apiFailure('invalid_body', 'No fields to update.', 400);
      }

      updates.updatedAt = new Date();

      const updated = await db
        .update(studentProfiles)
        .set(updates)
        .where(
          and(
            eq(studentProfiles.id, studentId),
            eq(studentProfiles.locationId, auth.locationId),
          ),
        )
        .returning({ id: studentProfiles.id });

      if (updated[0] === undefined) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      return apiSuccess({ student: await getStudentDetail(auth.locationId, studentId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.update' },
);

/**
 * Removes a student record entirely.
 *
 * ── What it takes with it, and what it refuses to ────────────────────────
 * The delete lands on `student_profiles` and on the directory row that owns it,
 * and the foreign keys do the rest: guardians, enrollment history, concessions,
 * credits and vouchers all cascade from the profile. Two statements rather than
 * one because the cascade only runs *downhill* — `student_profiles` references
 * `school_users`, not the other way about, so deleting the profile on its own
 * leaves a directory entry behind holding the child's name, the
 * `student:<admission number>` sentinel phone, and the unique index that would
 * then refuse to re-admit them under the same number.
 *
 * ── Money received is not deletable ──────────────────────────────────────
 * A student with any `fee_payments` row against any of their vouchers is
 * refused, with the count in the message. A receipt is a fact about what the
 * school took across a desk; it is answered for in the ledger, in a bank
 * reconciliation and to the parent who holds the counterfoil, and no button in
 * an admissions screen should be able to make it stop having happened.
 *
 * That refusal is also the answer to the case this endpoint gets reached for
 * most often. Deleting is not an undo for a wrong enrollment — **withdrawing
 * is**, and it keeps the history that a transfer certificate is written from.
 * The message says so rather than only saying no.
 */
interface DeleteBody {
  disablePortals?: unknown;
}

export const DELETE = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { studentId } = await context.params;
      if (!isUuid(studentId)) return apiFailure('not_found', 'Student not found.', 404);

      const existing = await getStudentDetail(auth.locationId, studentId);
      if (existing === null) return apiFailure('not_found', 'Student not found.', 404);

      // A branch-scoped actor is told the same thing about a student outside
      // their branch as about one who does not exist, exactly as GET and PATCH
      // above do: 404 is what stops the endpoint being a roll enumerator.
      if (auth.branchId !== null && existing.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Student not found.', 404);
      }

      const received = await countPaymentsForStudent(auth.locationId, studentId);
      if (received > 0) {
        return apiFailure(
          'payments_received',
          `${existing.name} has ${String(received)} payment${
            received === 1 ? '' : 's'
          } recorded against their vouchers, and money the school has received ` +
            'cannot be erased. Withdraw the student instead — the record stays, ' +
            'and so does the fee history.',
          409,
        );
      }

      /*
       * Sprint 20, item 9b. Who this child was family with, read **before**
       * they go.
       *
       * `student_guardians` cascades with the profile, so the moment the delete
       * commits there is nothing left to match a family on and the siblings are
       * unrecoverable. Reading first and reconciling after is the only order
       * that works, and the sweep would otherwise take up to fifteen minutes to
       * notice — during which a parent could be told a figure that is about to
       * change.
       */
      const family = await familyIdsBeforeDeparture(auth.locationId, studentId);

      /*
       * Sprint 25. The three-option dialog's answer, and it has to run **here**
       * — before the delete — for two reasons that both bite.
       *
       * `student_guardians` cascades with the profile, so a moment from now
       * there is nothing left to read the family from. And `chat_conversations`
       * references the profile with `set null`, so the link that says which
       * threads concern this child disappears at the same instant.
       *
       * `requireNoActiveEnrollment: false` because the pupil is still `active`
       * right now: their enrollment rows have not been removed yet and cannot
       * be, for exactly the reason above. A delete is an unambiguous departure.
       *
       * `studentSchoolUserId: null` because the pupil's own account is deleted
       * outright two statements below. Deactivating a row that is about to be
       * removed would report an act that leaves no trace.
       *
       * The default is **not** to disable. A clerk who never saw the dialog —
       * a script, an older client — gets the conservative half, which loses
       * nobody their login.
       */
      const body = await readJsonBody<DeleteBody>(request);
      const disablePortals = body?.disablePortals === true;

      const departure = await applyDeparture({
        locationId: auth.locationId,
        studentProfileId: studentId,
        studentSchoolUserId: null,
        disablePortals,
        reason: `${existing.name} was removed from the school on ${new Date().toISOString().slice(0, 10)}.`,
        requireNoActiveEnrollment: false,
      });

      await batch(db, (tx) => [
        tx
          .delete(studentProfiles)
          .where(
            and(
              eq(studentProfiles.id, studentId),
              eq(studentProfiles.locationId, auth.locationId),
            ),
          ),
        tx
          .delete(schoolUsers)
          .where(
            and(
              eq(schoolUsers.id, existing.schoolUserId),
              eq(schoolUsers.locationId, auth.locationId),
            ),
          ),
      ]);

      /*
       * Awaited but never fatal — `reconcileSiblingGrantsFor` swallows its own
       * failures. The student is already gone; a sibling discount that did not
       * close is picked up by the sweep, and refusing the response over it
       * would tell the operator the deletion failed when it did not.
       */
      const closed = await reconcileSiblingGrantsFor({
        locationId: auth.locationId,
        studentProfileIds: family,
        actorUid: auth.uid,
      });

      return apiSuccess({
        deleted: true,
        studentId: existing.studentId,
        siblingDiscountsClosed: closed,
        portalsDisabled: departure.deactivated,
        keptWithOtherChildren: departure.keptWithOtherChildren,
        conversationsFrozen: departure.conversationsFrozen,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.delete' },
);
