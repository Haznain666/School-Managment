import 'server-only';

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import {
  academicYears,
  admissionApplications,
  branches,
  grades,
  schoolUsers,
  sections,
  studentEnrollments,
  studentGuardians,
  studentProfiles,
  gradeLabel,
  isApplicationStatus,
  isEnrollmentStatus,
  OPEN_APPLICATION_STATUSES,
  type AcademicYear,
  type ApplicationStatus,
  type CurriculumLevel,
  type EnrollmentStatus,
  type GuardianRelationship,
} from '@/db/schema';

import { db } from './drizzle';

/**
 * Tenant-scoped reads for the Admissions module.
 *
 * Same contract as `lib/school-queries.ts`: every function takes `locationId`
 * first and filters on it, and that value must have come from verified session
 * claims. Nothing here may be called with an id out of a request body.
 */

// -----------------------------------------------------------------------------
// Academic years
// -----------------------------------------------------------------------------

export interface AcademicYearRow {
  id: string;
  name: string;
  startMonth: number;
  startYear: number;
  endMonth: number;
  endYear: number;
  isActive: boolean;
  /** Enrolments filed against this year — what blocks deletion. */
  studentCount: number;
}

export async function listAcademicYears(
  locationId: string,
): Promise<AcademicYearRow[]> {
  const rows = await db
    .select({
      id: academicYears.id,
      name: academicYears.name,
      startMonth: academicYears.startMonth,
      startYear: academicYears.startYear,
      endMonth: academicYears.endMonth,
      endYear: academicYears.endYear,
      isActive: academicYears.isActive,
      studentCount: count(studentEnrollments.id),
    })
    .from(academicYears)
    .leftJoin(
      studentEnrollments,
      eq(studentEnrollments.academicYearId, academicYears.id),
    )
    .where(eq(academicYears.locationId, locationId))
    .groupBy(academicYears.id)
    .orderBy(desc(academicYears.startYear), desc(academicYears.startMonth));

  return rows;
}

export async function getAcademicYear(
  locationId: string,
  yearId: string,
): Promise<AcademicYear | null> {
  const rows = await db
    .select()
    .from(academicYears)
    .where(and(eq(academicYears.locationId, locationId), eq(academicYears.id, yearId)))
    .limit(1);

  return rows[0] ?? null;
}

export async function getActiveAcademicYear(
  locationId: string,
): Promise<AcademicYear | null> {
  const rows = await db
    .select()
    .from(academicYears)
    .where(
      and(eq(academicYears.locationId, locationId), eq(academicYears.isActive, true)),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** True when any enrolment still points at this year. */
export async function academicYearHasEnrollments(
  locationId: string,
  yearId: string,
): Promise<boolean> {
  const rows = await db
    .select({ value: count() })
    .from(studentEnrollments)
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.academicYearId, yearId),
      ),
    );

  return (rows[0]?.value ?? 0) > 0;
}

// -----------------------------------------------------------------------------
// Branches
// -----------------------------------------------------------------------------

export interface AdmissionsBranch {
  id: string;
  name: string;
  curriculumLevel: CurriculumLevel;
}

/**
 * Active campuses with the curriculum each teaches.
 *
 * `listBranchOptions` in `lib/school-queries.ts` deliberately does not carry the
 * curriculum — it feeds pickers that do not care. Grade seeding does: the
 * curriculum decides which ladder a branch gets.
 */
export async function listAdmissionsBranches(
  locationId: string,
): Promise<AdmissionsBranch[]> {
  return db
    .select({
      id: branches.id,
      name: branches.name,
      curriculumLevel: branches.curriculumLevel,
    })
    .from(branches)
    .where(and(eq(branches.locationId, locationId), eq(branches.isActive, true)))
    .orderBy(asc(branches.name));
}

// -----------------------------------------------------------------------------
// Grades and sections
// -----------------------------------------------------------------------------

export interface SectionRow {
  id: string;
  gradeId: string;
  academicYearId: string;
  name: string;
  capacity: number | null;
  isActive: boolean;
  /** Active enrolments in this section. */
  studentCount: number;
}

export interface GradeRow {
  id: string;
  branchId: string;
  name: string;
  displayName: string | null;
  /** What to print: the override when set, otherwise the canonical name. */
  label: string;
  curriculumLevel: CurriculumLevel;
  sortOrder: number;
  isActive: boolean;
}

export async function listGrades(
  locationId: string,
  branchId?: string | undefined,
): Promise<GradeRow[]> {
  const conditions: SQL[] = [eq(grades.locationId, locationId)];
  if (branchId !== undefined && branchId !== '') {
    conditions.push(eq(grades.branchId, branchId));
  }

  const rows = await db
    .select({
      id: grades.id,
      branchId: grades.branchId,
      name: grades.name,
      displayName: grades.displayName,
      curriculumLevel: grades.curriculumLevel,
      sortOrder: grades.sortOrder,
      isActive: grades.isActive,
    })
    .from(grades)
    .where(and(...conditions))
    .orderBy(asc(grades.branchId), asc(grades.sortOrder));

  return rows.map((row) => ({ ...row, label: gradeLabel(row) }));
}

export async function listSections(
  locationId: string,
  filters: { gradeId?: string | undefined; academicYearId?: string | undefined },
): Promise<SectionRow[]> {
  const conditions: SQL[] = [eq(sections.locationId, locationId)];
  if (filters.gradeId !== undefined && filters.gradeId !== '') {
    conditions.push(eq(sections.gradeId, filters.gradeId));
  }
  if (filters.academicYearId !== undefined && filters.academicYearId !== '') {
    conditions.push(eq(sections.academicYearId, filters.academicYearId));
  }

  const rows = await db
    .select({
      id: sections.id,
      gradeId: sections.gradeId,
      academicYearId: sections.academicYearId,
      name: sections.name,
      capacity: sections.capacity,
      isActive: sections.isActive,
      // Only active enrolments count against capacity: a withdrawn student is
      // not occupying a seat.
      studentCount: sql<number>`count(${studentEnrollments.id}) filter (where ${studentEnrollments.status} = 'active')`.mapWith(
        Number,
      ),
    })
    .from(sections)
    .leftJoin(studentEnrollments, eq(studentEnrollments.sectionId, sections.id))
    .where(and(...conditions))
    .groupBy(sections.id)
    .orderBy(asc(sections.name));

  return rows;
}

export async function getSectionById(
  locationId: string,
  sectionId: string,
): Promise<SectionRow | null> {
  const rows = await listSectionsWhere(
    and(eq(sections.locationId, locationId), eq(sections.id, sectionId)),
  );
  return rows[0] ?? null;
}

async function listSectionsWhere(where: SQL | undefined): Promise<SectionRow[]> {
  return db
    .select({
      id: sections.id,
      gradeId: sections.gradeId,
      academicYearId: sections.academicYearId,
      name: sections.name,
      capacity: sections.capacity,
      isActive: sections.isActive,
      studentCount: sql<number>`count(${studentEnrollments.id}) filter (where ${studentEnrollments.status} = 'active')`.mapWith(
        Number,
      ),
    })
    .from(sections)
    .leftJoin(studentEnrollments, eq(studentEnrollments.sectionId, sections.id))
    .where(where)
    .groupBy(sections.id)
    .orderBy(asc(sections.name));
}

/** True when any enrolment still points at this section. */
export async function sectionHasEnrollments(
  locationId: string,
  sectionId: string,
): Promise<boolean> {
  const rows = await db
    .select({ value: count() })
    .from(studentEnrollments)
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.sectionId, sectionId),
      ),
    );

  return (rows[0]?.value ?? 0) > 0;
}

// -----------------------------------------------------------------------------
// Students
// -----------------------------------------------------------------------------

export interface StudentListRow {
  studentProfileId: string;
  studentId: string;
  name: string;
  photoUrl: string | null;
  gradeName: string;
  sectionName: string;
  branchId: string | null;
  branchName: string | null;
  academicYearName: string;
  guardianPhone: string | null;
  enrollmentDate: string;
  status: EnrollmentStatus;
  rollNumber: string | null;
}

export interface ListStudentsFilters {
  branchId?: string | undefined;
  gradeId?: string | undefined;
  sectionId?: string | undefined;
  academicYearId?: string | undefined;
  status?: string | undefined;
  search?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
  /** `name` for the directory, `recent` for "who joined last". */
  orderBy?: 'name' | 'recent' | undefined;
}

export interface ListStudentsResult {
  students: StudentListRow[];
  total: number;
  page: number;
  limit: number;
}

/**
 * The enrolled-student directory.
 *
 * Driven from `student_enrollments` rather than `student_profiles`: the list is
 * "who is in which class this year", and a student with no enrolment for the
 * selected year genuinely does not belong on it.
 */
export async function listStudents(
  locationId: string,
  filters: ListStudentsFilters,
): Promise<ListStudentsResult> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);

  const conditions: SQL[] = [eq(studentEnrollments.locationId, locationId)];

  if (filters.academicYearId !== undefined && filters.academicYearId !== '') {
    conditions.push(eq(studentEnrollments.academicYearId, filters.academicYearId));
  }
  if (filters.sectionId !== undefined && filters.sectionId !== '') {
    conditions.push(eq(studentEnrollments.sectionId, filters.sectionId));
  }
  if (filters.gradeId !== undefined && filters.gradeId !== '') {
    conditions.push(eq(sections.gradeId, filters.gradeId));
  }
  if (filters.branchId !== undefined && filters.branchId !== '') {
    conditions.push(eq(grades.branchId, filters.branchId));
  }
  // Unknown status values are dropped rather than rejected: the filter comes
  // from a query string, and a stale bookmark should show everything, not 400.
  if (isEnrollmentStatus(filters.status)) {
    conditions.push(eq(studentEnrollments.status, filters.status));
  }

  const search = (filters.search ?? '').trim();
  if (search !== '') {
    const pattern = `%${search}%`;
    const matches = or(
      ilike(schoolUsers.name, pattern),
      ilike(studentProfiles.studentId, pattern),
      ilike(schoolUsers.phone, pattern),
    );
    if (matches !== undefined) conditions.push(matches);
  }

  const where = and(...conditions);

  const baseQuery = db
    .select({
      studentProfileId: studentProfiles.id,
      studentId: studentProfiles.studentId,
      name: schoolUsers.name,
      photoUrl: studentProfiles.photoUrl,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
      branchId: grades.branchId,
      branchName: branches.name,
      academicYearName: academicYears.name,
      guardianPhone: schoolUsers.phone,
      enrollmentDate: studentEnrollments.enrollmentDate,
      status: studentEnrollments.status,
      rollNumber: studentEnrollments.rollNumber,
    })
    .from(studentEnrollments)
    .innerJoin(
      studentProfiles,
      eq(studentProfiles.id, studentEnrollments.studentProfileId),
    )
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(academicYears, eq(academicYears.id, studentEnrollments.academicYearId))
    .leftJoin(branches, eq(branches.id, grades.branchId));

  const [rows, totals] = await Promise.all([
    baseQuery
      .where(where)
      .orderBy(
        filters.orderBy === 'recent'
          ? desc(studentEnrollments.createdAt)
          : asc(schoolUsers.name),
      )
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ value: count() })
      .from(studentEnrollments)
      .innerJoin(
        studentProfiles,
        eq(studentProfiles.id, studentEnrollments.studentProfileId),
      )
      .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
      .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .where(where),
  ]);

  const students: StudentListRow[] = rows.map((row) => ({
    studentProfileId: row.studentProfileId,
    studentId: row.studentId,
    name: row.name,
    photoUrl: row.photoUrl,
    gradeName: gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
    sectionName: row.sectionName,
    branchId: row.branchId,
    branchName: row.branchName,
    academicYearName: row.academicYearName,
    guardianPhone: row.guardianPhone,
    enrollmentDate: row.enrollmentDate,
    status: row.status,
    rollNumber: row.rollNumber,
  }));

  return { students, total: totals[0]?.value ?? 0, page, limit };
}

export interface GuardianRow {
  id: string;
  name: string;
  relationship: GuardianRelationship;
  phone: string;
  email: string | null;
  cnic: string | null;
  occupation: string | null;
  isPrimaryContact: boolean;
  ghlContactId: string | null;
  schoolUserId: string | null;
}

export async function listGuardians(
  locationId: string,
  studentProfileId: string,
): Promise<GuardianRow[]> {
  return db
    .select({
      id: studentGuardians.id,
      name: studentGuardians.name,
      relationship: studentGuardians.relationship,
      phone: studentGuardians.phone,
      email: studentGuardians.email,
      cnic: studentGuardians.cnic,
      occupation: studentGuardians.occupation,
      isPrimaryContact: studentGuardians.isPrimaryContact,
      ghlContactId: studentGuardians.ghlContactId,
      schoolUserId: studentGuardians.schoolUserId,
    })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.studentProfileId, studentProfileId),
      ),
    )
    .orderBy(desc(studentGuardians.isPrimaryContact), asc(studentGuardians.name));
}

export interface EnrollmentRow {
  id: string;
  academicYearId: string;
  academicYearName: string;
  gradeName: string;
  sectionName: string;
  branchName: string | null;
  rollNumber: string | null;
  enrollmentDate: string;
  status: EnrollmentStatus;
  isActiveYear: boolean;
}

export async function listEnrollmentHistory(
  locationId: string,
  studentProfileId: string,
): Promise<EnrollmentRow[]> {
  const rows = await db
    .select({
      id: studentEnrollments.id,
      academicYearId: studentEnrollments.academicYearId,
      academicYearName: academicYears.name,
      startYear: academicYears.startYear,
      isActiveYear: academicYears.isActive,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
      branchName: branches.name,
      rollNumber: studentEnrollments.rollNumber,
      enrollmentDate: studentEnrollments.enrollmentDate,
      status: studentEnrollments.status,
    })
    .from(studentEnrollments)
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(academicYears, eq(academicYears.id, studentEnrollments.academicYearId))
    .leftJoin(branches, eq(branches.id, grades.branchId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
      ),
    )
    .orderBy(desc(academicYears.startYear));

  return rows.map((row) => ({
    id: row.id,
    academicYearId: row.academicYearId,
    academicYearName: row.academicYearName,
    gradeName: gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
    sectionName: row.sectionName,
    branchName: row.branchName,
    rollNumber: row.rollNumber,
    enrollmentDate: row.enrollmentDate,
    status: row.status,
    isActiveYear: row.isActiveYear,
  }));
}

export interface StudentDetail {
  studentProfileId: string;
  studentId: string;
  schoolUserId: string;
  name: string;
  /** Null for an account created from an email address alone. */
  phone: string | null;
  email: string | null;
  isActive: boolean;
  branchId: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  bFormCnic: string | null;
  bloodGroup: string | null;
  nationality: string;
  religion: string | null;
  previousSchool: string | null;
  medicalNotes: string | null;
  photoUrl: string | null;
  ghlContactId: string | null;
  createdAt: Date;
}

export async function getStudentDetail(
  locationId: string,
  studentProfileId: string,
): Promise<StudentDetail | null> {
  const rows = await db
    .select({
      studentProfileId: studentProfiles.id,
      studentId: studentProfiles.studentId,
      schoolUserId: studentProfiles.schoolUserId,
      name: schoolUsers.name,
      phone: schoolUsers.phone,
      email: schoolUsers.email,
      isActive: schoolUsers.isActive,
      branchId: schoolUsers.branchId,
      dateOfBirth: studentProfiles.dateOfBirth,
      gender: studentProfiles.gender,
      bFormCnic: studentProfiles.bFormCnic,
      bloodGroup: studentProfiles.bloodGroup,
      nationality: studentProfiles.nationality,
      religion: studentProfiles.religion,
      previousSchool: studentProfiles.previousSchool,
      medicalNotes: studentProfiles.medicalNotes,
      photoUrl: studentProfiles.photoUrl,
      ghlContactId: studentProfiles.ghlContactId,
      createdAt: studentProfiles.createdAt,
    })
    .from(studentProfiles)
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .where(
      and(
        eq(studentProfiles.locationId, locationId),
        eq(studentProfiles.id, studentProfileId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** The student's own record, addressed by their portal account. */
export async function getStudentBySchoolUserId(
  locationId: string,
  schoolUserId: string,
): Promise<StudentDetail | null> {
  const rows = await db
    .select({ id: studentProfiles.id })
    .from(studentProfiles)
    .where(
      and(
        eq(studentProfiles.locationId, locationId),
        eq(studentProfiles.schoolUserId, schoolUserId),
      ),
    )
    .limit(1);

  const profile = rows[0];
  return profile === undefined ? null : getStudentDetail(locationId, profile.id);
}

export interface CurrentEnrollment {
  gradeName: string;
  sectionName: string;
  academicYearName: string;
  rollNumber: string | null;
  status: EnrollmentStatus;
  branchName: string | null;
}

/** A student's placement in one year — the active year unless told otherwise. */
export async function getCurrentEnrollment(
  locationId: string,
  studentProfileId: string,
  academicYearId: string,
): Promise<CurrentEnrollment | null> {
  const rows = await db
    .select({
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
      academicYearName: academicYears.name,
      rollNumber: studentEnrollments.rollNumber,
      status: studentEnrollments.status,
      branchName: branches.name,
    })
    .from(studentEnrollments)
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(academicYears, eq(academicYears.id, studentEnrollments.academicYearId))
    .leftJoin(branches, eq(branches.id, grades.branchId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
        eq(studentEnrollments.academicYearId, academicYearId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  return {
    gradeName: gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
    sectionName: row.sectionName,
    academicYearName: row.academicYearName,
    rollNumber: row.rollNumber,
    status: row.status,
    branchName: row.branchName,
  };
}

export interface ChildSummary {
  studentProfileId: string;
  studentId: string;
  name: string;
  photoUrl: string | null;
  relationship: GuardianRelationship;
  enrollment: CurrentEnrollment | null;
}

/**
 * The children a signed-in parent may see.
 *
 * The link is `student_guardians.school_user_id`: a guardian row that has been
 * matched to a portal account. A parent with no matched row sees nothing, which
 * is the correct answer — not an error.
 */
export async function listChildrenForGuardian(
  locationId: string,
  schoolUserId: string,
  academicYearId: string | null,
): Promise<ChildSummary[]> {
  const rows = await db
    .select({
      studentProfileId: studentProfiles.id,
      studentId: studentProfiles.studentId,
      name: schoolUsers.name,
      photoUrl: studentProfiles.photoUrl,
      relationship: studentGuardians.relationship,
    })
    .from(studentGuardians)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentGuardians.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.schoolUserId, schoolUserId),
      ),
    )
    .orderBy(asc(schoolUsers.name));

  if (academicYearId === null) {
    return rows.map((row) => ({ ...row, enrollment: null }));
  }

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      enrollment: await getCurrentEnrollment(
        locationId,
        row.studentProfileId,
        academicYearId,
      ),
    })),
  );
}

// -----------------------------------------------------------------------------
// Applications
// -----------------------------------------------------------------------------

export interface ApplicationRow {
  id: string;
  studentName: string;
  studentDob: string | null;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string | null;
  gradeName: string | null;
  branchName: string | null;
  status: ApplicationStatus;
  submittedAt: Date;
  convertedToStudentProfileId: string | null;
}

export interface ListApplicationsFilters {
  status?: string | undefined;
  branchId?: string | undefined;
  academicYearId?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
}

export async function listApplications(
  locationId: string,
  filters: ListApplicationsFilters,
): Promise<ApplicationRow[]> {
  const conditions: SQL[] = [eq(admissionApplications.locationId, locationId)];

  if (isApplicationStatus(filters.status)) {
    conditions.push(eq(admissionApplications.status, filters.status));
  }
  if (filters.branchId !== undefined && filters.branchId !== '') {
    conditions.push(eq(admissionApplications.branchId, filters.branchId));
  }
  if (filters.academicYearId !== undefined && filters.academicYearId !== '') {
    conditions.push(eq(admissionApplications.academicYearId, filters.academicYearId));
  }

  const search = (filters.search ?? '').trim();
  if (search !== '') {
    const pattern = `%${search}%`;
    const matches = or(
      ilike(admissionApplications.studentName, pattern),
      ilike(admissionApplications.guardianName, pattern),
      ilike(admissionApplications.guardianPhone, pattern),
    );
    if (matches !== undefined) conditions.push(matches);
  }

  const rows = await db
    .select({
      id: admissionApplications.id,
      studentName: admissionApplications.studentName,
      studentDob: admissionApplications.studentDob,
      guardianName: admissionApplications.guardianName,
      guardianPhone: admissionApplications.guardianPhone,
      guardianEmail: admissionApplications.guardianEmail,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      branchName: branches.name,
      status: admissionApplications.status,
      submittedAt: admissionApplications.submittedAt,
      convertedToStudentProfileId: admissionApplications.convertedToStudentProfileId,
    })
    .from(admissionApplications)
    .leftJoin(grades, eq(grades.id, admissionApplications.gradeId))
    .leftJoin(branches, eq(branches.id, admissionApplications.branchId))
    .where(and(...conditions))
    .orderBy(desc(admissionApplications.submittedAt))
    .limit(Math.min(Math.max(filters.limit ?? 100, 1), 200));

  return rows.map((row) => ({
    id: row.id,
    studentName: row.studentName,
    studentDob: row.studentDob,
    guardianName: row.guardianName,
    guardianPhone: row.guardianPhone,
    guardianEmail: row.guardianEmail,
    gradeName:
      row.gradeName === null
        ? null
        : gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
    branchName: row.branchName,
    status: row.status,
    submittedAt: row.submittedAt,
    convertedToStudentProfileId: row.convertedToStudentProfileId,
  }));
}

export interface ApplicationDetail extends ApplicationRow {
  studentGender: string | null;
  previousSchool: string | null;
  guardianRelationship: string;
  guardianCnic: string | null;
  notes: string | null;
  statusReason: string | null;
  reviewedAt: Date | null;
  branchId: string | null;
  gradeId: string | null;
  academicYearId: string | null;
  academicYearName: string | null;
}

export async function getApplicationDetail(
  locationId: string,
  applicationId: string,
): Promise<ApplicationDetail | null> {
  const rows = await db
    .select({
      id: admissionApplications.id,
      studentName: admissionApplications.studentName,
      studentDob: admissionApplications.studentDob,
      studentGender: admissionApplications.studentGender,
      previousSchool: admissionApplications.previousSchool,
      guardianName: admissionApplications.guardianName,
      guardianRelationship: admissionApplications.guardianRelationship,
      guardianPhone: admissionApplications.guardianPhone,
      guardianEmail: admissionApplications.guardianEmail,
      guardianCnic: admissionApplications.guardianCnic,
      notes: admissionApplications.notes,
      status: admissionApplications.status,
      statusReason: admissionApplications.statusReason,
      reviewedAt: admissionApplications.reviewedAt,
      submittedAt: admissionApplications.submittedAt,
      convertedToStudentProfileId: admissionApplications.convertedToStudentProfileId,
      branchId: admissionApplications.branchId,
      gradeId: admissionApplications.gradeId,
      academicYearId: admissionApplications.academicYearId,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      branchName: branches.name,
      academicYearName: academicYears.name,
    })
    .from(admissionApplications)
    .leftJoin(grades, eq(grades.id, admissionApplications.gradeId))
    .leftJoin(branches, eq(branches.id, admissionApplications.branchId))
    .leftJoin(academicYears, eq(academicYears.id, admissionApplications.academicYearId))
    .where(
      and(
        eq(admissionApplications.locationId, locationId),
        eq(admissionApplications.id, applicationId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  return {
    ...row,
    gradeName:
      row.gradeName === null
        ? null
        : gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
  };
}

// -----------------------------------------------------------------------------
// Overview
// -----------------------------------------------------------------------------

export interface AdmissionsOverview {
  activeYear: AcademicYear | null;
  studentsThisYear: number;
  pendingApplications: number;
  sectionsWithSpace: number;
  newThisMonth: number;
  recentEnrollments: StudentListRow[];
  pendingPreview: ApplicationRow[];
}

/** Midnight on the first of the current month, in the server's timezone. */
function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getAdmissionsOverview(
  locationId: string,
): Promise<AdmissionsOverview> {
  const activeYear = await getActiveAcademicYear(locationId);

  const [
    studentRows,
    pendingRows,
    newRows,
    recent,
    pendingPreview,
    sectionRows,
  ] = await Promise.all([
    activeYear === null
      ? Promise.resolve([{ value: 0 }])
      : db
          .select({ value: count() })
          .from(studentEnrollments)
          .where(
            and(
              eq(studentEnrollments.locationId, locationId),
              eq(studentEnrollments.academicYearId, activeYear.id),
              eq(studentEnrollments.status, 'active'),
            ),
          ),
    db
      .select({ value: count() })
      .from(admissionApplications)
      .where(
        and(
          eq(admissionApplications.locationId, locationId),
          inArray(admissionApplications.status, [...OPEN_APPLICATION_STATUSES]),
        ),
      ),
    db
      .select({ value: count() })
      .from(studentProfiles)
      .where(
        and(
          eq(studentProfiles.locationId, locationId),
          gte(studentProfiles.createdAt, startOfMonth()),
        ),
      ),
    listStudents(locationId, {
      academicYearId: activeYear?.id,
      limit: 10,
      page: 1,
      orderBy: 'recent',
    }),
    listApplications(locationId, { status: 'pending', limit: 5 }),
    activeYear === null
      ? Promise.resolve([])
      : listSectionsWhere(
          and(
            eq(sections.locationId, locationId),
            eq(sections.academicYearId, activeYear.id),
            eq(sections.isActive, true),
          ),
        ),
  ]);

  // A section with no capacity set is unlimited, so it always has space.
  const sectionsWithSpace = sectionRows.filter(
    (section) => section.capacity === null || section.studentCount < section.capacity,
  ).length;

  return {
    activeYear,
    studentsThisYear: studentRows[0]?.value ?? 0,
    pendingApplications: pendingRows[0]?.value ?? 0,
    sectionsWithSpace,
    newThisMonth: newRows[0]?.value ?? 0,
    recentEnrollments: recent.students,
    pendingPreview,
  };
}

/** Active enrolments in the school's active year — the dashboard headline. */
export async function countActiveStudents(locationId: string): Promise<number> {
  const activeYear = await getActiveAcademicYear(locationId);
  if (activeYear === null) return 0;

  const rows = await db
    .select({ value: count() })
    .from(studentEnrollments)
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.academicYearId, activeYear.id),
        eq(studentEnrollments.status, 'active'),
      ),
    );

  return rows[0]?.value ?? 0;
}
