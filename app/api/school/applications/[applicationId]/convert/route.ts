import { and, eq } from 'drizzle-orm';

import {
  admissionApplications,
  grades,
  isGender,
  isGuardianRelationship,
  sections,
} from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getApplicationDetail } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import {
  enrollStudent,
  EnrollmentError,
  syncEnrollmentToGhl,
  type GuardianInput,
} from '@/lib/enrollment';
import { normalizeCnic } from '@/lib/national-id';
import { InvalidPhoneError, normalizePhone } from '@/lib/phone';
import { StudentIdError } from '@/lib/student-id';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * POST /api/school/applications/[applicationId]/convert
 *
 * Turns an accepted application into a real student.
 *
 * The application already carries the child's and guardian's details; all the
 * admin adds is the section — the one thing an applicant cannot choose for
 * themselves. Everything else runs through the same `enrollStudent` path as a
 * direct enrollment, so a converted student is indistinguishable from a typed-in
 * one.
 *
 * Only accepted applications convert, and only once: the application row
 * records which student it became, which is both the audit trail and the guard
 * against a double enrollment.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ applicationId: string }> };

interface ConvertBody {
  sectionId?: unknown;
  rollNumber?: unknown;
  enrollmentDate?: unknown;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { applicationId } = await context.params;
      if (!isUuid(applicationId)) {
        return apiFailure('not_found', 'Application not found.', 404);
      }

      const application = await getApplicationDetail(auth.locationId, applicationId);
      if (application === null) {
        return apiFailure('not_found', 'Application not found.', 404);
      }

      if (auth.branchId !== null && application.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Application not found.', 404);
      }

      if (application.status !== 'accepted') {
        return apiFailure(
          'not_accepted',
          'Only accepted applications can be converted into an enrollment.',
          409,
        );
      }

      if (application.convertedToStudentProfileId !== null) {
        return apiFailure(
          'already_converted',
          'This application has already been converted into an enrollment.',
          409,
        );
      }

      if (application.gradeId === null) {
        return apiFailure(
          'no_grade',
          'This application has no grade on it. Edit the application before converting it.',
          409,
        );
      }

      const body = await readJsonBody<ConvertBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const sectionId = readString(body.sectionId);
      if (!isUuid(sectionId)) {
        return apiFailure('invalid_body', 'Select a section for the student.', 400);
      }

      const enrollmentDate = readOptionalString(body.enrollmentDate);
      if (
        enrollmentDate !== null &&
        (!ISO_DATE.test(enrollmentDate) || Number.isNaN(Date.parse(enrollmentDate)))
      ) {
        return apiFailure('invalid_body', 'Enrollment date must be a valid date.', 400);
      }

      // The application names a grade but not a branch on a single-campus
      // school, so the branch is taken from the grade rather than trusted from
      // the application row.
      const gradeRows = await db
        .select({ branchId: grades.branchId })
        .from(grades)
        .where(
          and(
            eq(grades.id, application.gradeId),
            eq(grades.locationId, auth.locationId),
          ),
        )
        .limit(1);

      const grade = gradeRows[0];
      if (grade === undefined) {
        return apiFailure(
          'no_grade',
          'The grade on this application no longer exists. Edit the application before converting it.',
          409,
        );
      }

      // The section decides which academic year the student lands in, so it is
      // read from there rather than from the application's requested year.
      const sectionRows = await db
        .select({ academicYearId: sections.academicYearId })
        .from(sections)
        .where(
          and(eq(sections.id, sectionId), eq(sections.locationId, auth.locationId)),
        )
        .limit(1);

      const section = sectionRows[0];
      if (section === undefined) {
        return apiFailure('invalid_body', 'That section does not exist.', 400);
      }

      let guardianPhone: string;
      try {
        guardianPhone = normalizePhone(application.guardianPhone);
      } catch (error) {
        if (error instanceof InvalidPhoneError) {
          return apiFailure(
            'invalid_phone',
            'The guardian’s phone number on this application is not valid, so the student cannot be enrolled from it.',
            400,
          );
        }
        throw error;
      }

      /*
       * The one place the first-guardian rule does not apply.
       *
       * A first guardian entered by a clerk must be the student's father,
       * mother or sibling — "Other" is the absence of an answer and the form
       * refuses it. This guardian was not entered by a clerk: it is what the
       * applicant themselves wrote on the public form, weeks ago, and a
       * one-click conversion must not fail because they described themselves
       * as the child's guardian rather than as their father. The relationship
       * is corrected on the student's profile in one click if it is wrong;
       * refusing the conversion would instead lose the admission.
       */
      const guardian: GuardianInput = {
        name: application.guardianName,
        relationship: isGuardianRelationship(application.guardianRelationship)
          ? application.guardianRelationship
          : 'guardian',
        relationshipOther: null,
        phone: guardianPhone,
        email: application.guardianEmail,
        // Canonicalised, because this is the column the sibling lookup reads.
        // A public form's `4210112345671` must land in the same spelling an
        // admissions clerk would have produced.
        cnic: normalizeCnic(application.guardianCnic),
        occupation: null,
        // The public application form does not ask for an address, and
        // inventing one from the child's would put words in the applicant's
        // mouth. It is asked for on the guardian panel when somebody next opens
        // the profile — Sprint 19b, item 18.
        address: null,
        latitude: null,
        longitude: null,
        isPrimaryContact: true,
      };

      const enrolled = await enrollStudent(db, {
        locationId: auth.locationId,
        actorUid: auth.uid,
        student: {
          name: application.studentName,
          dateOfBirth: application.studentDob,
          gender: isGender(application.studentGender) ? application.studentGender : null,
          bFormCnic: null,
          idDocumentType: null,
          bloodGroup: null,
          nationality: 'Pakistani',
          religion: null,
          previousSchool: application.previousSchool,
          medicalNotes: application.notes,
          photoUrl: null,
        },
        guardians: [guardian],
        placement: {
          branchId: grade.branchId,
          gradeId: application.gradeId,
          sectionId,
          academicYearId: section.academicYearId,
          rollNumber: readOptionalString(body.rollNumber),
          enrollmentDate,
        },
      });

      // Written after the enrollment lands: an application marked converted with
      // no student behind it would be unrecoverable, whereas an enrolled student
      // whose application is not yet marked can simply be marked again.
      await db
        .update(admissionApplications)
        .set({ convertedToStudentProfileId: enrolled.studentProfileId })
        .where(
          and(
            eq(admissionApplications.id, applicationId),
            eq(admissionApplications.locationId, auth.locationId),
          ),
        );

      await syncEnrollmentToGhl(
        db,
        auth.locationId,
        enrolled,
        application.studentName,
      );

      return apiSuccess(
        {
          studentProfileId: enrolled.studentProfileId,
          studentId: enrolled.studentId,
        },
        201,
      );
    } catch (error) {
      if (error instanceof EnrollmentError) {
        return apiFailure(error.code, error.message, error.status);
      }
      if (error instanceof StudentIdError) {
        return apiFailure('student_id_failed', error.message, 409);
      }
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
