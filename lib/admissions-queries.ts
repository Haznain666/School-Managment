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
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import {
  academicYears,
  admissionApplications,
  branches,
  feeChallans,
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
  OPEN_CHALLAN_STATUSES,
  type AcademicYear,
  type ApplicationStatus,
  type CurriculumLevel,
  type EnrollmentStatus,
  type FeeClearanceStatus,
  type GuardianRelationship,
} from '@/db/schema';

import { db } from './drizzle';
import {
  isStudentFeeStatus,
  studentFeeStatusFrom,
  type StudentFeeStatus,
} from './student-fee-status';

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
  /** The staff record who owns this class. Decides who may set its promotions. */
  classTeacherId: string | null;
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
  /**
   * The campus this grade belongs to.
   *
   * Grades are per branch, so a two-campus school has two rows both labelled
   * "Class 5" — and any screen that lists them school-wide, such as assigning
   * grades to a period schedule, is unusable without knowing which is which.
   */
  branchName: string | null;
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
      branchName: branches.name,
    })
    .from(grades)
    .leftJoin(branches, eq(branches.id, grades.branchId))
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
      classTeacherId: sections.classTeacherId,
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
      classTeacherId: sections.classTeacherId,
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
  /**
   * The primary guardian's number, in storage form (`+923211234567`).
   *
   * ── It used to be the student's own directory row, and that was a bug ──
   * This column read `school_users.phone` of the *student*, which
   * `studentDirectoryPhone` fills with the sentinel `student:GVS-2025-0011`
   * because the directory column is `NOT NULL` and a seven-year-old has no
   * phone. So the whole Guardian phone column of the directory printed student
   * ids, and the free-text search matched a sentinel or nothing.
   *
   * It is now the guardian flagged `is_primary_contact`, falling back to the
   * earliest recorded guardian for the rows written before that flag was
   * always set. Formatted for reading by `formatPhoneForDisplay` at the point
   * it is rendered — storage stays canonical.
   */
  guardianPhone: string | null;
  enrollmentDate: string;
  status: EnrollmentStatus;
  rollNumber: string | null;
  /** The fee chip: one word for what this child owes. See `lib/student-fee-status.ts`. */
  feeStatus: StudentFeeStatus;
}

/**
 * The columns the student directory may be ordered by.
 *
 * A whitelist rather than a column name off the wire: the sort arrives in a
 * query string, and the only safe thing to do with a column name from a
 * stranger is to match it against a list of ones we chose.
 */
export const STUDENT_SORT_COLUMNS = [
  'name',
  'studentId',
  'grade',
  'section',
  'enrollmentDate',
  'status',
] as const;

export type StudentSortColumn = (typeof STUDENT_SORT_COLUMNS)[number];

export interface ListStudentsFilters {
  branchId?: string | undefined;
  gradeId?: string | undefined;
  sectionId?: string | undefined;
  academicYearId?: string | undefined;
  status?: string | undefined;
  /**
   * The fee chip, as a filter. Unknown values are dropped rather than
   * rejected, exactly as `status` above is — it arrives in a query string.
   */
  feeStatus?: string | undefined;
  search?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
  /** `name` for the directory, `recent` for "who joined last". */
  orderBy?: 'name' | 'recent' | undefined;
  /**
   * Which column the directory is sorted by, when the reader has clicked one.
   * Takes precedence over `orderBy`, which stays for the callers that want a
   * fixed order and do not offer the reader a choice.
   */
  sort?: StudentSortColumn | undefined;
  direction?: 'asc' | 'desc' | undefined;
  /**
   * BR4 — narrows a scoped principal to their own campuses and classes.
   *
   * Applied *in addition to* whatever the caller filtered on, never instead of
   * it: a head who filters to Class 5 outside their division must get nothing,
   * not Class 5. An empty array is therefore honoured as "matches nothing"
   * rather than treated as absent — an unassigned head sees an empty list, and
   * `describeScope()` is what tells them why.
   */
  scope?: { branchIds: string[] | null; gradeIds: string[] | null } | undefined;
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

  /*
   * The primary guardian's number, one row per student.
   *
   * A joined subquery rather than a correlated sub-select or a second pass:
   * the directory is paginated and sorted in the database, and anything
   * per-row would run once per student on a screen somebody is waiting on.
   *
   * `array_agg(... order by ...)` is the ordered-aggregate form of "first by
   * this ranking" — the guardian flagged primary, then the earliest recorded.
   * There is no operator for an ordered aggregate, which is the only reason
   * this is a raw template; no JavaScript value is interpolated into it.
   */
  const primaryGuardian = db
    .select({
      studentProfileId: studentGuardians.studentProfileId,
      phone: sql<string>`(array_agg(${studentGuardians.phone} order by ${studentGuardians.isPrimaryContact} desc, ${studentGuardians.createdAt} asc))[1]`.as(
        'phone',
      ),
    })
    .from(studentGuardians)
    .where(eq(studentGuardians.locationId, locationId))
    .groupBy(studentGuardians.studentProfileId)
    .as('primary_guardian');

  /*
   * Every open voucher this school holds, counted once per student.
   *
   * `current_date` rather than a JavaScript `Date`: the comparison happens in
   * the database, so nothing has to cross the driver, and "past its due date"
   * is decided in one clock rather than in the reader's browser and the
   * server's process at once.
   *
   * A student who owes nothing has no row here at all, which is what the
   * `Cleared` filter matches on.
   */
  const openVouchers = db
    .select({
      studentProfileId: feeChallans.studentProfileId,
      openCount: count().as('open_count'),
      overdueCount:
        sql<number>`count(*) filter (where ${feeChallans.dueDate} < current_date)`
          .mapWith(Number)
          .as('overdue_count'),
      admissionCount:
        sql<number>`count(*) filter (where ${feeChallans.challanKind} = 'admission')`
          .mapWith(Number)
          .as('admission_count'),
    })
    .from(feeChallans)
    .where(
      and(
        eq(feeChallans.locationId, locationId),
        inArray(feeChallans.status, [...OPEN_CHALLAN_STATUSES]),
      ),
    )
    .groupBy(feeChallans.studentProfileId)
    .as('open_vouchers');

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
  // BR4. `inArray` with an empty list is `false` in Drizzle, which is exactly
  // the reading wanted: an unassigned head matches no row.
  if (filters.scope?.branchIds != null) {
    conditions.push(inArray(grades.branchId, filters.scope.branchIds));
  }
  if (filters.scope?.gradeIds != null) {
    conditions.push(inArray(sections.gradeId, filters.scope.gradeIds));
  }

  /*
   * The fee chip, as a filter, expressed in the same ranking the chip uses.
   *
   * Each branch matches exactly the students whose chip reads that word —
   * `Overdue` excludes the ones whose chip says `Admission unpaid`, because a
   * filter that returned rows the reader can see contradict it is worse than
   * no filter. `lib/student-fee-status.ts` holds the ranking; this is the SQL
   * of it, and the two are meant to be read side by side.
   */
  if (isStudentFeeStatus(filters.feeStatus)) {
    switch (filters.feeStatus) {
      case 'admission_unpaid':
        conditions.push(gte(openVouchers.admissionCount, 1));
        break;
      case 'overdue':
        conditions.push(gte(openVouchers.overdueCount, 1));
        conditions.push(eq(openVouchers.admissionCount, 0));
        break;
      case 'due':
        conditions.push(gte(openVouchers.openCount, 1));
        conditions.push(eq(openVouchers.overdueCount, 0));
        conditions.push(eq(openVouchers.admissionCount, 0));
        break;
      case 'cleared':
        // No grouped row at all: nothing of this student's is open.
        conditions.push(isNull(openVouchers.studentProfileId));
        break;
    }
  }

  const search = (filters.search ?? '').trim();
  if (search !== '') {
    const pattern = `%${search}%`;
    const patterns = [
      ilike(schoolUsers.name, pattern),
      ilike(studentProfiles.studentId, pattern),
      // The guardian's number, and never `school_users.phone` — the student's
      // own directory row carries the `student:<admission number>` sentinel
      // there, so that comparison could only ever match a sentinel.
      ilike(primaryGuardian.phone, pattern),
    ];

    /*
     * A number typed the way a clerk says it, matched against the way it is
     * stored. `0321 123 4567` and `+923211234567` are the same number and
     * share no substring, so the digits are re-expressed in the stored trunk
     * form before the comparison. Four digits is the floor: below that this is
     * a name fragment rather than a number, and `%92%` would match everyone.
     */
    const digits = search.replace(/\D/g, '');
    if (digits.length >= 4) {
      const stored = digits.startsWith('0') ? `92${digits.slice(1)}` : digits;
      patterns.push(ilike(primaryGuardian.phone, `%${stored}%`));
    }

    const matches = or(...patterns);
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
      guardianPhone: primaryGuardian.phone,
      enrollmentDate: studentEnrollments.enrollmentDate,
      status: studentEnrollments.status,
      rollNumber: studentEnrollments.rollNumber,
      openVoucherCount: openVouchers.openCount,
      overdueVoucherCount: openVouchers.overdueCount,
      admissionVoucherCount: openVouchers.admissionCount,
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
    .leftJoin(branches, eq(branches.id, grades.branchId))
    .leftJoin(primaryGuardian, eq(primaryGuardian.studentProfileId, studentProfiles.id))
    .leftJoin(openVouchers, eq(openVouchers.studentProfileId, studentProfiles.id));

  const order = filters.direction === 'desc' ? desc : asc;
  const sortColumn =
    filters.sort === undefined
      ? null
      : {
          name: schoolUsers.name,
          studentId: studentProfiles.studentId,
          grade: grades.name,
          section: sections.name,
          enrollmentDate: studentEnrollments.enrollmentDate,
          status: studentEnrollments.status,
        }[filters.sort];

  const [rows, totals] = await Promise.all([
    baseQuery
      .where(where)
      .orderBy(
        sortColumn !== null
          ? order(sortColumn)
          : filters.orderBy === 'recent'
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
      // The same two joins as the page query, because both the search and the
      // fee filter read them: a total that counted rows the page cannot show
      // would page the reader off the end of the list.
      .leftJoin(
        primaryGuardian,
        eq(primaryGuardian.studentProfileId, studentProfiles.id),
      )
      .leftJoin(openVouchers, eq(openVouchers.studentProfileId, studentProfiles.id))
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
    feeStatus: studentFeeStatusFrom({
      open: row.openVoucherCount ?? 0,
      overdue: row.overdueVoucherCount ?? 0,
      admission: row.admissionVoucherCount ?? 0,
    }),
  }));

  return { students, total: totals[0]?.value ?? 0, page, limit };
}

export interface GuardianRow {
  id: string;
  name: string;
  relationship: GuardianRelationship;
  /** The school's own words, when `relationship` is `other`. */
  relationshipOther: string | null;
  phone: string;
  email: string | null;
  cnic: string | null;
  occupation: string | null;
  isPrimaryContact: boolean;
  ghlContactId: string | null;
  schoolUserId: string | null;
  /** When the parent portal welcome was queued. Null = still owed one. */
  welcomeEmailSentAt: Date | null;
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
      relationshipOther: studentGuardians.relationshipOther,
      phone: studentGuardians.phone,
      email: studentGuardians.email,
      cnic: studentGuardians.cnic,
      occupation: studentGuardians.occupation,
      isPrimaryContact: studentGuardians.isPrimaryContact,
      ghlContactId: studentGuardians.ghlContactId,
      schoolUserId: studentGuardians.schoolUserId,
      welcomeEmailSentAt: studentGuardians.welcomeEmailSentAt,
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
  /**
   * `outstanding` until the admission fee is settled, then `cleared`.
   *
   * Separate from `status` on purpose — see the column comment in
   * `db/schema/student-enrollments.ts`. A student is `active` from the moment
   * they are admitted; this says whether that admission has been confirmed.
   */
  feeStatus: FeeClearanceStatus;
  feeClearedAt: Date | null;
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
      feeStatus: studentEnrollments.feeStatus,
      feeClearedAt: studentEnrollments.feeClearedAt,
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
    feeStatus: row.feeStatus,
    feeClearedAt: row.feeClearedAt,
  }));
}

export interface StudentDetail {
  studentProfileId: string;
  studentId: string;
  schoolUserId: string;
  name: string;
  phone: string;
  email: string | null;
  isActive: boolean;
  branchId: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  bFormCnic: string | null;
  idDocumentType: string | null;
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
      idDocumentType: studentProfiles.idDocumentType,
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
  /** The school's own words, when `relationship` is `other`. */
  relationshipOther: string | null;
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
      relationshipOther: studentGuardians.relationshipOther,
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

/** The columns the admissions inbox may be ordered by. */
export const APPLICATION_SORT_COLUMNS = [
  'studentName',
  'guardianName',
  'grade',
  'branch',
  'submittedAt',
] as const;

export type ApplicationSortColumn = (typeof APPLICATION_SORT_COLUMNS)[number];

export interface ListApplicationsFilters {
  status?: string | undefined;
  branchId?: string | undefined;
  academicYearId?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  sort?: ApplicationSortColumn | undefined;
  direction?: 'asc' | 'desc' | undefined;
}

/** The filters a page of the inbox and its count both apply. */
function applicationConditions(
  locationId: string,
  filters: ListApplicationsFilters,
): SQL[] {
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

  return conditions;
}

/** How many applications the same filters match. */
export async function countApplications(
  locationId: string,
  filters: ListApplicationsFilters,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(admissionApplications)
    .where(and(...applicationConditions(locationId, filters)));

  return row?.value ?? 0;
}

export async function listApplications(
  locationId: string,
  filters: ListApplicationsFilters,
): Promise<ApplicationRow[]> {
  const conditions = applicationConditions(locationId, filters);

  const order = filters.direction === 'asc' ? asc : desc;
  const sortColumn = {
    studentName: admissionApplications.studentName,
    guardianName: admissionApplications.guardianName,
    grade: grades.name,
    branch: branches.name,
    submittedAt: admissionApplications.submittedAt,
  }[filters.sort ?? 'submittedAt'];

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
    .orderBy(order(sortColumn))
    .limit(Math.min(Math.max(filters.limit ?? 100, 1), 200))
    .offset(filters.offset ?? 0);

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
