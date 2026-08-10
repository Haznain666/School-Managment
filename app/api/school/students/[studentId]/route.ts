import { and, eq } from 'drizzle-orm';

import {
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
import { db } from '@/lib/drizzle';
import { isValidCnic } from '@/lib/national-id';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/students/[studentId]
 *
 * `studentId` here is the `student_profiles.id` UUID, not the printed
 * admission number — the number is the school's identifier for a person, the
 * UUID is the platform's identifier for a row.
 *
 * GET   the full profile, with guardians and enrolment history
 * PATCH the personal details
 *
 * The admission number and the link to the directory row are not updatable:
 * one is referenced by everything the school prints, the other is the record's
 * identity. Changing which class the student is in is an enrolment change, and
 * belongs to the enrolment tables rather than here.
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
  { permission: 'admissions.read' },
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
       * does on enrolment.
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
  { permission: 'admissions.write' },
);
