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
  isIdDocumentType,
  FIRST_GUARDIAN_RELATIONSHIPS,
  SINGLETON_RELATIONSHIPS,
  type BloodGroup,
  type FeeClearanceStatus,
  type Gender,
  type GuardianRelationship,
  type IdDocumentType,
} from '@/db/schema';

import { isValidCnic, normalizeCnic } from './national-id';

import { batch, type Database } from './drizzle';
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
 * placement — is worse than a failed enrolment, so the four inserts go out
 * through `batch()`, which runs them in one Postgres transaction.
 *
 * `batch()` builds every statement in one expression, so none of them can be
 * handed a key another one returned. The primary keys are therefore minted here
 * with `randomUUID()` rather than read back from `RETURNING`, which is what lets
 * the four inserts be written as a single list in the first place.
 *
 * The student ID is issued just before that transaction and is therefore not
 * covered by it: if the inserts fail, that number is spent and the next
 * enrolment skips it. Gaps in the sequence are harmless; duplicate IDs would not
 * be, and the counter's own atomicity is what prevents those.
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
  /** How they are related, in the school's words. Only when `other`. */
  relationshipOther: string | null;
  /** E.164, already normalised by `parseGuardians`. */
  phone: string;
  email: string | null;
  /** Canonical `42101-1234567-1`, or null. See `normalizeCnic`. */
  cnic: string | null;
  occupation: string | null;
  isPrimaryContact: boolean;
}

export interface StudentInput {
  name: string;
  dateOfBirth: string | null;
  gender: Gender | null;
  bFormCnic: string | null;
  /** Which document `bFormCnic` is. Null whenever there is no number. */
  idDocumentType: IdDocumentType | null;
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
  /**
   * Keep the school's own admission number instead of issuing one.
   *
   * Set only by the bulk import, and only when the operator mapped a column
   * for it. See where it is used, below, for why renumbering a migrated roll
   * is destructive.
   */
  existingStudentId?: string | undefined;
  /**
   * Whether this admission is already paid for.
   *
   * Defaults to `outstanding`, which is the rule for a new admission: the child
   * is enrolled, but the enrolment is unconfirmed and the guardians' portal
   * welcome waits on the money. See `lib/enrolment-fee-gate.ts`.
   *
   * The bulk import passes `cleared`, and that is not an exception to the rule
   * but a different case entirely: those children are already at the school and
   * have been for years. Marking a migrated roll outstanding would invent a
   * debt for eight hundred families and hold back every welcome behind a
   * challan nobody is ever going to raise.
   */
  feeStatus?: FeeClearanceStatus | undefined;
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

  /*
   * The document and its number are validated as one thing, because neither is
   * meaningful alone. A number with no document is what the old single field
   * recorded and is the ambiguity this replaces; a CNIC is refused unless it is
   * in the one national format, while a B-Form is taken as typed — see
   * `lib/national-id.ts`.
   *
   * Enforced here and not only in the form: the form is one caller of this
   * route, and a malformed CNIC written by any other would be indistinguishable
   * in the roll from a real one.
   */
  const bFormCnic = readOptionalString(body['bFormCnic']);
  const idDocumentTypeRaw = readOptionalString(body['idDocumentType']);
  let idDocumentType: IdDocumentType | null = null;

  if (bFormCnic !== null) {
    if (!isIdDocumentType(idDocumentTypeRaw)) {
      throw new EnrollmentError(
        'invalid_body',
        'Choose whether that number is a CNIC / Smart Card or a B-Form.',
      );
    }

    if (idDocumentTypeRaw === 'cnic' && !isValidCnic(bFormCnic)) {
      throw new EnrollmentError(
        'invalid_body',
        'A CNIC / Smart Card number is 13 digits, as 42101-1234567-1.',
      );
    }

    idDocumentType = idDocumentTypeRaw;
  }

  return {
    name,
    dateOfBirth: readDate(body['dateOfBirth'], 'Date of birth'),
    gender,
    bFormCnic,
    idDocumentType,
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
 * the list when none is. The school needs a single number to write to, and
 * leaving that ambiguous would make the notification path guess.
 *
 * ── The three relationship rules are enforced here, not only on the form ──
 * The first guardian may not be `other`; `father` and `mother` may each be
 * claimed once; and `other` must carry a relation in words. The enrolment form
 * removes the impossible options from its dropdown, which is a courtesy to the
 * clerk and no protection at all — this function is what a script, a stale tab
 * or a second entry point has to get past.
 *
 * ── And the CNIC is canonicalised here ───────────────────────────────────
 * `normalizeCnic` or nothing. A guardian's CNIC decides which children are
 * siblings (`lib/siblings.ts`), and a column holding `4210112345671` beside
 * `42101-1234567-1` reads as two people. Thirteen digits in any punctuation
 * become the one spelling; anything else becomes null, because a half-recorded
 * identity number is worse than an absent one — it can match another half.
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

    if (
      index === 0 &&
      !(FIRST_GUARDIAN_RELATIONSHIPS as readonly string[]).includes(relationship)
    ) {
      throw new EnrollmentError(
        'invalid_body',
        'The first guardian must be the student’s father, mother or sibling.',
      );
    }

    const relationshipOther = readOptionalString(guardian['relationshipOther']);
    if (relationship === 'other' && relationshipOther === null) {
      throw new EnrollmentError(
        'invalid_body',
        `Say how guardian ${index + 1} is related to this student.`,
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
      // Kept only where it means something. A relation typed, then changed to
      // Father, must not be stored against Father.
      relationshipOther: relationship === 'other' ? relationshipOther : null,
      phone,
      email: readOptionalString(guardian['email']),
      cnic: normalizeCnic(readOptionalString(guardian['cnic'])),
      occupation: readOptionalString(guardian['occupation']),
      isPrimaryContact: guardian['isPrimaryContact'] === true,
    };
  });

  for (const relationship of SINGLETON_RELATIONSHIPS) {
    if (parsed.filter((guardian) => guardian.relationship === relationship).length > 1) {
      throw new EnrollmentError(
        'invalid_body',
        `Only one guardian can be recorded as the student’s ${relationship}.`,
      );
    }
  }

  // Two cards carrying one CNIC is one person entered twice, and would leave
  // the student with two guardian rows that every family query then has to
  // de-duplicate.
  const cnics = parsed
    .map((guardian) => guardian.cnic)
    .filter((value): value is string => value !== null);
  if (new Set(cnics).size !== cnics.length) {
    throw new EnrollmentError(
      'invalid_body',
      'Two guardians share a CNIC. One person cannot be recorded twice on the same student.',
    );
  }

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
 * The student's own directory row needs a phone, and students rarely have one.
 *
 * ── It used to borrow the guardian's, and that had to stop ───────────────
 * The old rule was "use the primary guardian's number, unless somebody at this
 * school already holds it, in which case use a sentinel". `school_users` is
 * unique on (location, phone), so the effect was that the *child's* row
 * claimed the father's mobile — and the father's own parent-portal account,
 * created later when the admission fee cleared, then collided with it. The
 * upsert would have landed on the child's row: it would have written the
 * father's email onto his daughter's directory entry and linked him to an
 * account that was never his.
 *
 * So the sentinel is now unconditional. A number belongs to the person who
 * answers it, and nothing in the product ever looked a student up by their
 * guardian's phone — the number a school actually rings is on
 * `student_guardians`, where it always was.
 *
 * The sentinel is deliberately not phone-shaped: `normalizePhone` can never
 * produce it, so it cannot be used to request a passcode and cannot shadow a
 * real number at the login lookup.
 */
function studentDirectoryPhone(studentId: string): string {
  return `student:${studentId}`;
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
  const feeStatus: FeeClearanceStatus = params.feeStatus ?? 'outstanding';

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

  /*
   * A school migrating its roll keeps its own admission numbers.
   *
   * `existingStudentId` is set only by the bulk import, and only when the
   * operator mapped an admission-number column. Issuing fresh numbers there
   * would be silently destructive: every fee receipt, certificate, mark sheet
   * and filing cabinet at that school is filed under the old number, and a
   * migration that renumbers eight hundred children breaks the link to all of
   * it on day one.
   *
   * The counter is deliberately *not* advanced past a supplied number. The two
   * sequences are the school's and ours, they need not be compatible — a
   * school's existing numbers are usually not in our `STS-2026-0001` shape at
   * all — and the uniqueness that matters is enforced by
   * `student_profiles_location_id_student_id_idx`, which the import checks
   * against before it writes.
   */
  const studentId =
    params.existingStudentId ??
    (await generateStudentId(db, locationId, resolved.academicYearId, school.schoolCode));

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
    relationshipOther: guardian.relationshipOther,
    occupation: guardian.occupation,
    isPrimaryContact: guardian.isPrimaryContact,
  }));

  const [firstGuardianRow, ...restGuardianRows] = guardianRows;
  if (firstGuardianRow === undefined) {
    throw new EnrollmentError('invalid_body', 'At least one guardian is required.');
  }

  try {
    await batch(db, (tx) => [
      tx.insert(schoolUsers).values({
        id: schoolUserId,
        locationId,
        name: student.name,
        phone: studentDirectoryPhone(studentId),
        role: 'student',
        branchId: resolved.branchId,
        isActive: true,
        invitedByUid: actorUid,
        joinedAt: new Date(),
      }),
      tx.insert(studentProfiles).values({
        id: studentProfileId,
        locationId,
        schoolUserId,
        studentId,
        dateOfBirth: student.dateOfBirth,
        gender: student.gender,
        bFormCnic: student.bFormCnic,
        idDocumentType: student.idDocumentType,
        bloodGroup: student.bloodGroup,
        nationality: student.nationality,
        religion: student.religion,
        previousSchool: student.previousSchool,
        medicalNotes: student.medicalNotes,
        photoUrl: student.photoUrl,
      }),
      tx.insert(studentEnrollments).values({
        id: enrollmentId,
        locationId,
        studentProfileId,
        sectionId: resolved.sectionId,
        academicYearId: resolved.academicYearId,
        rollNumber: placement.rollNumber,
        enrollmentDate: placement.enrollmentDate ?? todayIso(),
        status: 'active',
        feeStatus,
        feeClearedAt: feeStatus === 'cleared' ? new Date() : null,
      }),
      tx.insert(studentGuardians).values([firstGuardianRow, ...restGuardianRows]),
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
    // the school corresponds with.
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
