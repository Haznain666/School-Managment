import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';

import {
  academicYears,
  branches,
  grades,
  schoolUsers,
  schools,
  sections,
  studentEnrollments,
  studentGuardians,
  studentProfiles,
  isBloodGroup,
  isGender,
  isGuardianRelationship,
  type BloodGroup,
  type Gender,
  type GuardianRelationship,
} from '@/db/schema';

import type { Database } from './drizzle';
import { syncAdmissionContacts, triggerAdmissionWelcomeWorkflow } from './ghl-admissions';
import { InvalidPhoneError, normalizePhone } from './phone';
import { generateStudentId } from './student-id';
import { readOptionalString, readString, isUuid } from './validation';

/**
 * Enrolling a student — the one place it happens.
 *
 * Two routes need it: `POST /api/school/students` (an admin typing a child in
 * directly) and `POST /api/school/applications/[id]/convert` (an accepted
 * public application becoming a real student). They differ only in where the
 * details come from, so the writes live here rather than being copied.
 *
 * ── On atomicity ─────────────────────────────────────────────────────────
 * A half-enrolled child — a directory row with no profile, or a profile with no
 * placement — is worse than a failed enrolment, so the four inserts go out as
 * one `db.batch()`, which Neon runs as a single transaction.
 *
 * Batched statements cannot read each other's output, so the primary keys are
 * minted here with `randomUUID()` instead of being read back from `RETURNING`.
 * That is what makes a single transaction possible over the HTTP driver, which
 * has no interactive transactions at all.
 *
 * The student ID is issued just before the batch and is therefore not covered
 * by it: if the batch fails, that number is spent and the next enrolment skips
 * it. Gaps in the sequence are harmless; duplicate IDs would not be, and the
 * counter's own atomicity is what prevents those.
 */

export class EnrollmentError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'EnrollmentError';
    this.code = code;
    this.status = status;
  }
}

/** Most a single enrolment may record. Matches the enrolment form's limit. */
export const MAX_GUARDIANS = 3;

export interface GuardianInput {
  name: string;
  relationship: GuardianRelationship;
  /** E.164, already normalised by `parseGuardians`. */
  phone: string;
  email: string | null;
  cnic: string | null;
  occupation: string | null;
  isPrimaryContact: boolean;
}

export interface StudentInput {
  name: string;
  dateOfBirth: string | null;
  gender: Gender | null;
  bFormCnic: string | null;
  bloodGroup: BloodGroup | null;
  nationality: string;
  religion: string | null;
  previousSchool: string | null;
  medicalNotes: string | null;
  photoUrl: string | null;
}

export interface PlacementInput {
  branchId: string;
  gradeId: string;
  sectionId: string;
  /** Omitted means "the school's active academic year". */
  academicYearId: string | null;
  rollNumber: string | null;
  /** `YYYY-MM-DD`. Omitted means today. */
  enrollmentDate: string | null;
}

export interface EnrollStudentParams {
  /** Tenant key — always from verified session claims. */
  locationId: string;
  /** Firebase uid of the admin doing the enrolling, for the audit trail. */
  actorUid: string;
  student: StudentInput;
  guardians: readonly GuardianInput[];
  placement: PlacementInput;
}

export interface EnrolledGuardian {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  isPrimaryContact: boolean;
}

export interface EnrollStudentResult {
  studentProfileId: string;
  /** The printed admission number, e.g. `GVS-2025-0001`. */
  studentId: string;
  schoolUserId: string;
  enrollmentId: string;
  academicYearId: string;
  guardians: EnrolledGuardian[];
  /** For the GHL sync that runs after the writes land. */
  schoolName: string;
}

// -----------------------------------------------------------------------------
// Request parsing — shared by the enrolment route and the enrolment form
// -----------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readDate(value: unknown, field: string): string | null {
  const text = readString(value);
  if (text === '') return null;

  if (!ISO_DATE.test(text) || Number.isNaN(Date.parse(text))) {
    throw new EnrollmentError('invalid_body', `${field} must be a valid date.`);
  }

  return text;
}

/** Narrows an untrusted student payload, throwing `EnrollmentError` on rubbish. */
export function parseStudentInput(body: Record<string, unknown>): StudentInput {
  const name = readString(body['name']);
  if (name === '') {
    throw new EnrollmentError('invalid_body', 'The student’s full name is required.');
  }

  const gender = readOptionalString(body['gender']);
  if (gender !== null && !isGender(gender)) {
    throw new EnrollmentError('invalid_body', 'Select a valid gender.');
  }

  const bloodGroup = readOptionalString(body['bloodGroup']);
  if (bloodGroup !== null && !isBloodGroup(bloodGroup)) {
    throw new EnrollmentError('invalid_body', 'Select a valid blood group.');
  }

  const nationality = readString(body['nationality']);

  return {
    name,
    dateOfBirth: readDate(body['dateOfBirth'], 'Date of birth'),
    gender,
    bFormCnic: readOptionalString(body['bFormCnic']),
    bloodGroup,
    nationality: nationality === '' ? 'Pakistani' : nationality,
    religion: readOptionalString(body['religion']),
    previousSchool: readOptionalString(body['previousSchool']),
    medicalNotes: readOptionalString(body['medicalNotes']),
    photoUrl: readOptionalString(body['photoUrl']),
  };
}

/**
 * Narrows an untrusted guardian array.
 *
 * Exactly one guardian ends up primary: the first one flagged, or the first in
 * the list when none is. The school needs a single number to WhatsApp, and
 * leaving that ambiguous would make the notification path guess.
 */
export function parseGuardians(value: unknown): GuardianInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new EnrollmentError('invalid_body', 'At least one guardian is required.');
  }

  if (value.length > MAX_GUARDIANS) {
    throw new EnrollmentError(
      'invalid_body',
      `A student may have at most ${MAX_GUARDIANS} guardians.`,
    );
  }

  const parsed: GuardianInput[] = value.map((entry: unknown, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new EnrollmentError('invalid_body', `Guardian ${index + 1} is malformed.`);
    }

    const guardian = entry as Record<string, unknown>;

    const name = readString(guardian['name']);
    if (name === '') {
      throw new EnrollmentError(
        'invalid_body',
        `Guardian ${index + 1} needs a full name.`,
      );
    }

    const relationship = readString(guardian['relationship']);
    if (!isGuardianRelationship(relationship)) {
      throw new EnrollmentError(
        'invalid_body',
        `Select a valid relationship for guardian ${index + 1}.`,
      );
    }

    let phone: string;
    try {
      phone = normalizePhone(readString(guardian['phone']));
    } catch (error) {
      if (error instanceof InvalidPhoneError) {
        throw new EnrollmentError(
          'invalid_phone',
          `Guardian ${index + 1} needs a valid Pakistani mobile number, for example 0300-1234567.`,
        );
      }
      throw error;
    }

    return {
      name,
      relationship,
      phone,
      email: readOptionalString(guardian['email']),
      cnic: readOptionalString(guardian['cnic']),
      occupation: readOptionalString(guardian['occupation']),
      isPrimaryContact: guardian['isPrimaryContact'] === true,
    };
  });

  const primaryIndex = parsed.findIndex((guardian) => guardian.isPrimaryContact);
  const chosen = primaryIndex === -1 ? 0 : primaryIndex;

  return parsed.map((guardian, index) => ({
    ...guardian,
    isPrimaryContact: index === chosen,
  }));
}

/** Narrows an untrusted placement payload. Existence checks happen later. */
export function parsePlacement(body: Record<string, unknown>): PlacementInput {
  const branchId = readString(body['branchId']);
  const gradeId = readString(body['gradeId']);
  const sectionId = readString(body['sectionId']);

  if (!isUuid(branchId)) {
    throw new EnrollmentError('invalid_body', 'Select a branch.');
  }
  if (!isUuid(gradeId)) {
    throw new EnrollmentError('invalid_body', 'Select a grade.');
  }
  if (!isUuid(sectionId)) {
    throw new EnrollmentError('invalid_body', 'Select a section.');
  }

  const academicYearId = readOptionalString(body['academicYearId']);
  if (academicYearId !== null && !isUuid(academicYearId)) {
    throw new EnrollmentError('invalid_body', 'Select a valid academic year.');
  }

  return {
    branchId,
    gradeId,
    sectionId,
    academicYearId,
    rollNumber: readOptionalString(body['rollNumber']),
    enrollmentDate: readDate(body['enrollmentDate'], 'Enrolment date'),
  };
}

// -----------------------------------------------------------------------------
// Placement resolution
// -----------------------------------------------------------------------------

export interface ResolvedPlacement {
  branchId: string;
  gradeId: string;
  sectionId: string;
  academicYearId: string;
  gradeName: string;
  sectionName: string;
  academicYearName: string;
}

/** The school's active academic year, or null when none is set. */
export async function getActiveAcademicYearId(
  db: Database,
  locationId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: academicYears.id })
    .from(academicYears)
    .where(
      and(eq(academicYears.locationId, locationId), eq(academicYears.isActive, true)),
    )
    .limit(1);

  return rows[0]?.id ?? null;
}

/**
 * Proves that branch, grade, section and year all belong to this school and to
 * each other.
 *
 * Foreign keys alone would not: every id here is a UUID supplied by the caller,
 * and a section id belonging to another school satisfies the constraint
 * perfectly well. This is the check that keeps a placement inside its tenant.
 */
export async function resolvePlacement(
  db: Database,
  locationId: string,
  placement: PlacementInput,
): Promise<ResolvedPlacement> {
  const academicYearId =
    placement.academicYearId ?? (await getActiveAcademicYearId(db, locationId));

  if (academicYearId === null) {
    throw new EnrollmentError(
      'no_active_year',
      'Set an active academic year before enrolling students.',
      409,
    );
  }

  const rows = await db
    .select({
      sectionId: sections.id,
      sectionName: sections.name,
      gradeId: grades.id,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      branchId: grades.branchId,
      yearName: academicYears.name,
    })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(academicYears, eq(academicYears.id, sections.academicYearId))
    .where(
      and(
        eq(sections.id, placement.sectionId),
        eq(sections.locationId, locationId),
        eq(sections.gradeId, placement.gradeId),
        eq(sections.academicYearId, academicYearId),
        eq(grades.locationId, locationId),
        eq(grades.branchId, placement.branchId),
        eq(academicYears.locationId, locationId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    throw new EnrollmentError(
      'invalid_placement',
      'That branch, grade, section and academic year do not go together. Re-pick the section.',
    );
  }

  const branchRows = await db
    .select({ id: branches.id })
    .from(branches)
    .where(
      and(
        eq(branches.id, placement.branchId),
        eq(branches.locationId, locationId),
        eq(branches.isActive, true),
      ),
    )
    .limit(1);

  if (branchRows[0] === undefined) {
    throw new EnrollmentError('invalid_placement', 'That branch is not available.');
  }

  return {
    branchId: placement.branchId,
    gradeId: row.gradeId,
    sectionId: row.sectionId,
    academicYearId,
    gradeName:
      row.gradeDisplayName === null || row.gradeDisplayName === ''
        ? row.gradeName
        : row.gradeDisplayName,
    sectionName: row.sectionName,
    academicYearName: row.yearName,
  };
}

// -----------------------------------------------------------------------------
// The write
// -----------------------------------------------------------------------------

/**
 * The student's own directory row needs a phone, and students rarely have one —
 * so it borrows the primary guardian's. When that number already belongs to
 * somebody at this school (a sibling's record, or the parent's own login) the
 * unique index would reject it, so a sentinel derived from the admission number
 * is stored instead.
 *
 * The sentinel is deliberately not phone-shaped: `normalizePhone` can never
 * produce it, so it cannot be used to request a passcode and cannot shadow a
 * real number at the login lookup.
 */
function studentDirectoryPhone(guardianPhone: string, studentId: string, taken: boolean): string {
  return taken ? `student:${studentId}` : guardianPhone;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Creates the directory row, profile, enrolment and guardians for one student.
 *
 * Does not touch GHL — the caller runs the sync afterwards, so a CRM outage
 * cannot roll back an admission.
 */
export async function enrollStudent(
  db: Database,
  params: EnrollStudentParams,
): Promise<EnrollStudentResult> {
  const { locationId, actorUid, student, guardians, placement } = params;

  if (guardians.length === 0) {
    throw new EnrollmentError('invalid_body', 'At least one guardian is required.');
  }

  const resolved = await resolvePlacement(db, locationId, placement);

  const schoolRows = await db
    .select({ name: schools.name, schoolCode: schools.schoolCode })
    .from(schools)
    .where(and(eq(schools.locationId, locationId), eq(schools.isActive, true)))
    .limit(1);

  const school = schoolRows[0];
  if (school === undefined) {
    throw new EnrollmentError('no_school', 'This school is not available.', 404);
  }

  if (school.schoolCode === null || school.schoolCode === '') {
    throw new EnrollmentError(
      'no_school_code',
      'This school has no school code set, so student IDs cannot be issued. Ask the platform administrator to add one.',
      409,
    );
  }

  const primaryGuardian = guardians.find((guardian) => guardian.isPrimaryContact) ?? guardians[0];
  if (primaryGuardian === undefined) {
    throw new EnrollmentError('invalid_body', 'At least one guardian is required.');
  }

  // Anyone already at this school on a guardian's number gets linked to the
  // child rather than duplicated — that link is what the parent portal reads.
  const guardianPhones = [...new Set(guardians.map((guardian) => guardian.phone))];

  const existingByPhone = await db
    .select({ id: schoolUsers.id, phone: schoolUsers.phone })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        inArray(schoolUsers.phone, guardianPhones),
      ),
    );

  const userIdByPhone = new Map(existingByPhone.map((row) => [row.phone, row.id]));

  const studentId = await generateStudentId(
    db,
    locationId,
    resolved.academicYearId,
    school.schoolCode,
  );

  const schoolUserId = randomUUID();
  const studentProfileId = randomUUID();
  const enrollmentId = randomUUID();

  const guardianRows = guardians.map((guardian) => ({
    id: randomUUID(),
    locationId,
    studentProfileId,
    schoolUserId: userIdByPhone.get(guardian.phone) ?? null,
    name: guardian.name,
    relationship: guardian.relationship,
    phone: guardian.phone,
    email: guardian.email,
    cnic: guardian.cnic,
    occupation: guardian.occupation,
    isPrimaryContact: guardian.isPrimaryContact,
  }));

  const [firstGuardianRow, ...restGuardianRows] = guardianRows;
  if (firstGuardianRow === undefined) {
    throw new EnrollmentError('invalid_body', 'At least one guardian is required.');
  }

  try {
    await db.batch([
      db.insert(schoolUsers).values({
        id: schoolUserId,
        locationId,
        name: student.name,
        phone: studentDirectoryPhone(
          primaryGuardian.phone,
          studentId,
          userIdByPhone.has(primaryGuardian.phone),
        ),
        role: 'student',
        branchId: resolved.branchId,
        isActive: true,
        invitedByUid: actorUid,
        joinedAt: new Date(),
      }),
      db.insert(studentProfiles).values({
        id: studentProfileId,
        locationId,
        schoolUserId,
        studentId,
        dateOfBirth: student.dateOfBirth,
        gender: student.gender,
        bFormCnic: student.bFormCnic,
        bloodGroup: student.bloodGroup,
        nationality: student.nationality,
        religion: student.religion,
        previousSchool: student.previousSchool,
        medicalNotes: student.medicalNotes,
        photoUrl: student.photoUrl,
      }),
      db.insert(studentEnrollments).values({
        id: enrollmentId,
        locationId,
        studentProfileId,
        sectionId: resolved.sectionId,
        academicYearId: resolved.academicYearId,
        rollNumber: placement.rollNumber,
        enrollmentDate: placement.enrollmentDate ?? todayIso(),
        status: 'active',
      }),
      db.insert(studentGuardians).values([firstGuardianRow, ...restGuardianRows]),
    ]);
  } catch (error) {
    console.error('[enrollment] enrolment write failed:', error);
    throw new EnrollmentError(
      'enrollment_failed',
      'Could not complete the enrolment. Please check the details and try again.',
      409,
    );
  }

  return {
    studentProfileId,
    studentId,
    schoolUserId,
    enrollmentId,
    academicYearId: resolved.academicYearId,
    schoolName: school.name,
    guardians: guardianRows.map((guardian) => ({
      id: guardian.id,
      name: guardian.name,
      phone: guardian.phone,
      email: guardian.email,
      isPrimaryContact: guardian.isPrimaryContact,
    })),
  };
}

// -----------------------------------------------------------------------------
// Post-enrolment CRM sync
// -----------------------------------------------------------------------------

export interface EnrollmentSyncResult {
  studentContactId: string | null;
  guardianContactIds: Record<string, string>;
}

/**
 * Mirrors a finished enrolment into GHL and stores the contact ids.
 *
 * Runs *after* `enrollStudent` has committed, and never throws: the child is
 * already admitted, and a CRM that is down must not turn that into an error the
 * admissions clerk has to act on. Whatever fails here can be replayed from the
 * student's profile page.
 */
export async function syncEnrollmentToGhl(
  db: Database,
  locationId: string,
  enrolled: Pick<
    EnrollStudentResult,
    'studentProfileId' | 'studentId' | 'schoolName' | 'guardians'
  >,
  studentName: string,
): Promise<EnrollmentSyncResult> {
  const primary =
    enrolled.guardians.find((guardian) => guardian.isPrimaryContact) ??
    enrolled.guardians[0];

  try {
    const sync = await syncAdmissionContacts(db, locationId, {
      schoolName: enrolled.schoolName,
      student: {
        name: studentName,
        studentId: enrolled.studentId,
        phone: primary?.phone,
      },
      guardians: enrolled.guardians.map((guardian) => ({
        id: guardian.id,
        name: guardian.name,
        phone: guardian.phone,
        email: guardian.email ?? undefined,
      })),
    });

    const writes: Array<Promise<unknown>> = [];

    if (sync.studentContactId !== null) {
      writes.push(
        db
          .update(studentProfiles)
          .set({ ghlContactId: sync.studentContactId, updatedAt: new Date() })
          .where(
            and(
              eq(studentProfiles.id, enrolled.studentProfileId),
              eq(studentProfiles.locationId, locationId),
            ),
          ),
      );
    }

    for (const [guardianId, contactId] of Object.entries(sync.guardianContactIds)) {
      writes.push(
        db
          .update(studentGuardians)
          .set({ ghlContactId: contactId })
          .where(
            and(
              eq(studentGuardians.id, guardianId),
              eq(studentGuardians.locationId, locationId),
            ),
          ),
      );
    }

    await Promise.all(writes);

    // The welcome workflow goes to the guardian, not the child: they are who
    // reads the WhatsApp.
    const primaryContactId =
      primary === undefined ? undefined : sync.guardianContactIds[primary.id];

    if (primaryContactId !== undefined) {
      await triggerAdmissionWelcomeWorkflow(locationId, primaryContactId);
    }

    return sync;
  } catch (error) {
    console.warn(
      `[enrollment] GHL sync failed for ${enrolled.studentId} at ${locationId}:`,
      error,
    );
    return { studentContactId: null, guardianContactIds: {} };
  }
}
