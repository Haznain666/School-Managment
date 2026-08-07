import { and, eq, inArray } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import {
  academicYears,
  admissionApplications,
  applicationReference,
  branches,
  grades,
  isGender,
  isGuardianRelationship,
  schoolModules,
  OPEN_APPLICATION_STATUSES,
} from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { verifyCaptcha } from '@/lib/admissions-captcha';
import { db } from '@/lib/drizzle';
import { createGuardianGHLContact } from '@/lib/ghl-admissions';
import { isWhatsAppEnabled } from '@/lib/channels';
import { sendEmail, smtpConfigured } from '@/lib/email-sender';
import { sendWhatsAppMessage } from '@/lib/ghl-client';
import { InvalidPhoneError, normalizePhone } from '@/lib/phone';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';
import { getSchoolBranding } from '@/lib/school-tenant';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * POST /api/admissions/apply — the public application form's endpoint.
 *
 * ── On being unauthenticated ─────────────────────────────────────────────
 * There is no session here, and there cannot be: an applicant is by definition
 * not yet anybody at this school. So the usual protection — `withSchoolAuth`
 * deriving the tenant from verified claims — is unavailable, and the tenant
 * comes instead from the header middleware stamped after resolving the
 * hostname. That is not a credential, but it is not client-controlled either:
 * middleware strips any incoming copy of the header before setting its own.
 *
 * Everything else is scoped by what this endpoint can reach. It writes exactly
 * one row, to `admission_applications`, filed under the resolved location, and
 * it cannot touch a student, a user or a fee. The branch and grade supplied are
 * checked to belong to that same school; a UUID borrowed from another tenant is
 * dropped rather than stored.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApplyBody {
  studentName?: unknown;
  studentDob?: unknown;
  studentGender?: unknown;
  previousSchool?: unknown;
  medicalNotes?: unknown;
  guardianName?: unknown;
  guardianRelationship?: unknown;
  guardianPhone?: unknown;
  guardianEmail?: unknown;
  guardianCnic?: unknown;
  branchId?: unknown;
  gradeId?: unknown;
  notes?: unknown;
  captchaAnswer?: unknown;
  captchaQuestion?: unknown;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Longest free-text field accepted, so a submission cannot be used as storage. */
const MAX_TEXT = 2000;

export async function POST(request: NextRequest) {
  try {
    const locationId = request.headers.get(SCHOOL_LOCATION_HEADER);
    if (locationId === null || locationId === '') {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const body = await readJsonBody<ApplyBody>(request);
    if (body === null) {
      return apiFailure('invalid_body', 'Expected a JSON body.', 400);
    }

    // Checked before anything is read from the database, so a script cannot use
    // the endpoint to probe which schools exist.
    if (
      !verifyCaptcha(readString(body.captchaQuestion), readString(body.captchaAnswer))
    ) {
      return apiFailure(
        'captcha_failed',
        'That answer was not correct. Please try the question again.',
        400,
      );
    }

    const [moduleRows, yearRows] = await Promise.all([
      db
        .select({ isEnabled: schoolModules.isEnabled })
        .from(schoolModules)
        .where(
          and(
            eq(schoolModules.locationId, locationId),
            eq(schoolModules.moduleKey, 'admissions'),
          ),
        )
        .limit(1),
      db
        .select({ id: academicYears.id })
        .from(academicYears)
        .where(
          and(eq(academicYears.locationId, locationId), eq(academicYears.isActive, true)),
        )
        .limit(1),
    ]);

    if (moduleRows[0]?.isEnabled !== true) {
      return apiFailure(
        'module_disabled',
        'Applications are not currently open at this school.',
        409,
      );
    }

    const academicYear = yearRows[0];
    if (academicYear === undefined) {
      return apiFailure('no_active_year', 'Admissions are not currently open.', 409);
    }

    const studentName = readString(body.studentName);
    if (studentName === '' || studentName.length > 120) {
      return apiFailure('invalid_body', 'Enter the student’s full name.', 400);
    }

    const guardianName = readString(body.guardianName);
    if (guardianName === '' || guardianName.length > 120) {
      return apiFailure('invalid_body', 'Enter the guardian’s full name.', 400);
    }

    const guardianRelationship = readString(body.guardianRelationship);
    if (!isGuardianRelationship(guardianRelationship)) {
      return apiFailure('invalid_body', 'Select your relationship to the student.', 400);
    }

    let guardianPhone: string;
    try {
      guardianPhone = normalizePhone(readString(body.guardianPhone));
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

    const studentDob = readOptionalString(body.studentDob);
    if (
      studentDob !== null &&
      (!ISO_DATE.test(studentDob) || Number.isNaN(Date.parse(studentDob)))
    ) {
      return apiFailure('invalid_body', 'Enter a valid date of birth.', 400);
    }

    const studentGender = readOptionalString(body.studentGender);
    if (studentGender !== null && !isGender(studentGender)) {
      return apiFailure('invalid_body', 'Select a valid gender.', 400);
    }

    const notes = readOptionalString(body.notes);
    const medicalNotes = readOptionalString(body.medicalNotes);
    if ((notes ?? '').length > MAX_TEXT || (medicalNotes ?? '').length > MAX_TEXT) {
      return apiFailure('invalid_body', 'Please shorten the notes.', 400);
    }

    // The same family applying twice while the first is still open is almost
    // always a double submit, not a second child.
    const duplicates = await db
      .select({ id: admissionApplications.id })
      .from(admissionApplications)
      .where(
        and(
          eq(admissionApplications.locationId, locationId),
          eq(admissionApplications.guardianPhone, guardianPhone),
          eq(admissionApplications.studentName, studentName),
          inArray(admissionApplications.status, [...OPEN_APPLICATION_STATUSES]),
        ),
      )
      .limit(1);

    const duplicate = duplicates[0];
    if (duplicate !== undefined) {
      return apiSuccess({
        success: true,
        duplicate: true,
        applicationId: applicationReference(duplicate.id),
        studentName,
        guardianName,
        guardianPhone,
      });
    }

    // Branch and grade are only stored once they are proven to belong to this
    // school — otherwise they are dropped, and an admin picks them at review.
    const branchIdInput = readOptionalString(body.branchId);
    let branchId: string | null = null;

    if (branchIdInput !== null && isUuid(branchIdInput)) {
      const branchRows = await db
        .select({ id: branches.id })
        .from(branches)
        .where(
          and(
            eq(branches.id, branchIdInput),
            eq(branches.locationId, locationId),
            eq(branches.isActive, true),
          ),
        )
        .limit(1);
      branchId = branchRows[0]?.id ?? null;
    }

    const gradeIdInput = readOptionalString(body.gradeId);
    let gradeId: string | null = null;

    if (gradeIdInput !== null && isUuid(gradeIdInput)) {
      const gradeRows = await db
        .select({ id: grades.id, branchId: grades.branchId })
        .from(grades)
        .where(and(eq(grades.id, gradeIdInput), eq(grades.locationId, locationId)))
        .limit(1);

      const grade = gradeRows[0];
      if (grade !== undefined && (branchId === null || grade.branchId === branchId)) {
        gradeId = grade.id;
        branchId = branchId ?? grade.branchId;
      }
    }

    const inserted = await db
      .insert(admissionApplications)
      .values({
        locationId,
        branchId,
        gradeId,
        academicYearId: academicYear.id,
        studentName,
        studentDob,
        studentGender,
        previousSchool: readOptionalString(body.previousSchool),
        guardianName,
        guardianRelationship,
        guardianPhone,
        guardianEmail: readOptionalString(body.guardianEmail),
        guardianCnic: readOptionalString(body.guardianCnic),
        // The medical note the applicant wrote is the only thing they have to
        // say about the child, so it is kept with their other remarks.
        notes:
          medicalNotes === null
            ? notes
            : [notes, `Medical notes: ${medicalNotes}`].filter((part) => part !== null).join('\n\n'),
      })
      .returning({ id: admissionApplications.id });

    const application = inserted[0];
    if (application === undefined) {
      return apiFailure('write_failed', 'Could not submit your application.', 500);
    }

    // A confirmation is nice to have and must never fail the submission — the
    // application is already filed by the time this runs.
    const guardianEmail = readOptionalString(body.guardianEmail);

    try {
      const branding = await getSchoolBranding(locationId);
      const schoolName = branding?.name ?? 'our school';
      const message =
        `Thank you for applying to ${schoolName}. We have received your application for ${studentName}. ` +
        `Your reference is ${applicationReference(application.id)}. Our admissions team will be in touch.`;

      // The GHL contact is created either way: it is the school's record of
      // an enquiry, not a side effect of messaging. Only the message itself
      // is behind the add-on.
      const contactId = await createGuardianGHLContact(db, locationId, {
        name: guardianName,
        phone: guardianPhone,
        email: guardianEmail ?? undefined,
      });

      if (await isWhatsAppEnabled(locationId)) {
        await sendWhatsAppMessage(db, locationId, contactId, message);
      }

      if (guardianEmail !== null && guardianEmail !== '' && smtpConfigured()) {
        await sendEmail(guardianEmail, `Application received — ${schoolName}`, message);
      }
    } catch (error) {
      console.warn('[apply] confirmation message could not be sent:', error);
    }

    return apiSuccess(
      {
        success: true,
        duplicate: false,
        applicationId: applicationReference(application.id),
        studentName,
        guardianName,
        guardianPhone,
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
