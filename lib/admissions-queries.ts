import 'server-only';

import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  notExists,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import {
  academicYearBranches,
  academicYears,
  admissionApplications,
  branches,
  feeChallans,
  grades,
  schoolUsers,
  sections,
  studentDocuments,
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

import { ownedBy, type BranchOption } from './branch-scope';
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
  /** Enrollments filed against this year — what blocks deletion. */
  studentCount: number;
  /**
   * The campuses this session runs at. **Empty means every campus.**
   *
   * That is every academic year at every school on the day `0036` lands, and it
   * is the reading the whole feature rests on — see `academic_year_branches`.
   * A screen showing this must say "All campuses" for an empty array rather
   * than an empty cell, which would read as a year nobody runs.
   */
  campuses: BranchOption[];
}

/**
 * The predicate for a year against a campus scope.
 *
 * ── Never an INNER JOIN, for the reason `sharedOrOwnedBy` exists ─────────
 * A year with no rows in `academic_year_branches` is school-wide, which today
 * is every year at every school. Joining the table and filtering on
 * `branch_id` would return **nothing at all** for a branch-bound reader, and an
 * empty academic-year list does not read as "the filter is wrong" — it reads as
 * a school whose calendar was never set up, on the screen a clerk goes to when
 * they cannot enroll anybody. That is `sharedOrOwnedBy`'s trap one table over,
 * and it costs a school its whole calendar rather than one subject list.
 *
 * `undefined` — no condition at all — when the scope reaches every campus, so
 * the unscoped query keeps exactly the shape it had before this sprint.
 */
function yearRunsAt(branchIds: string[] | null): SQL | undefined {
  if (branchIds === null) return undefined;

  const attached = notExists(
    db
      .select({ one: sql`1` })
      .from(academicYearBranches)
      .where(eq(academicYearBranches.academicYearId, academicYears.id)),
  );

  // An empty scope reaches no campus, so only the school-wide years remain.
  // Widening it to "everything" here is the direction that leaks, and it looks
  // entirely normal on screen — see `ownedBy` in `lib/branch-scope.ts`.
  if (branchIds.length === 0) return attached;

  return or(
    attached,
    exists(
      db
        .select({ one: sql`1` })
        .from(academicYearBranches)
        .where(
          and(
            eq(academicYearBranches.academicYearId, academicYears.id),
            inArray(academicYearBranches.branchId, branchIds),
          ),
        ),
    ),
  );
}

/**
 * The school's academic years, newest first, with the campuses each runs at.
 *
 * The campuses come back in a **second statement** rather than a third join.
 * The first already fans out across `student_enrollments` to count them, and
 * adding another one-to-many to that would multiply the count by the number of
 * campuses — a two-campus year reporting twice its enrollments, on the figure
 * that decides whether the year can be deleted. Two statements over at most a
 * few dozen rows is not the place to save a round trip.
 */
export async function listAcademicYears(
  locationId: string,
  branchIds: string[] | null = null,
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
    .where(and(eq(academicYears.locationId, locationId), yearRunsAt(branchIds)))
    .groupBy(academicYears.id)
    .orderBy(desc(academicYears.startYear), desc(academicYears.startMonth));

  const campuses = await listCampusesByYear(locationId);

  return rows.map((row) => ({ ...row, campuses: campuses.get(row.id) ?? [] }));
}

/**
 * Every year-to-campus attachment at this school, keyed by year.
 *
 * Deliberately unfiltered by scope: this answers "which campuses does this year
 * run at", and a branch-bound reader looking at a year that runs at three
 * campuses should see all three named. The scope decides which *years* they
 * see — `yearRunsAt` — not which facts about a year they are told. Hiding the
 * other two campuses would produce a Campus column that quietly disagrees with
 * the same year seen from the group view.
 */
async function listCampusesByYear(
  locationId: string,
): Promise<Map<string, BranchOption[]>> {
  const rows = await db
    .select({
      academicYearId: academicYearBranches.academicYearId,
      branchId: academicYearBranches.branchId,
      branchName: branches.name,
    })
    .from(academicYearBranches)
    .innerJoin(branches, eq(branches.id, academicYearBranches.branchId))
    .where(eq(academicYearBranches.locationId, locationId))
    .orderBy(asc(branches.name));

  const byYear = new Map<string, BranchOption[]>();
  for (const row of rows) {
    const list = byYear.get(row.academicYearId) ?? [];
    list.push({ id: row.branchId, name: row.branchName });
    byYear.set(row.academicYearId, list);
  }

  return byYear;
}

/** The campuses one year runs at. Empty means school-wide. */
export async function listAcademicYearCampuses(
  locationId: string,
  academicYearId: string,
): Promise<BranchOption[]> {
  return (await listCampusesByYear(locationId)).get(academicYearId) ?? [];
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

/**
 * The span a session covers, as a condition Postgres evaluates.
 *
 * `make_date(start_year, start_month, 1) <= current_date` and strictly before
 * the first day of the month *after* the end month, so a session ending in July
 * is still current on the 31st of July. There is no operator for `make_date`,
 * which is what the ``sql`` template is reserved for — and no JavaScript value
 * reaches the driver through it, which is what CLAUDE.md's rule about raw
 * templates is actually about.
 *
 * ── One clock, and it is the database's ─────────────────────────────────
 * `current_date`, not `new Date()`. A Node process on a Hostinger box in one
 * timezone, a Supabase instance in another and a clerk's laptop in a third are
 * three clocks, and "which session are we in" answered differently by two of
 * them is an enrollment filed under the wrong year on the first of the month.
 * The database is the only one of the three that every reader shares.
 */
const YEAR_CONTAINS_TODAY = sql`make_date(${academicYears.startYear}, ${academicYears.startMonth}, 1) <= current_date
    AND current_date < (make_date(${academicYears.endYear}, ${academicYears.endMonth}, 1) + interval '1 month')`;

/**
 * The year everything defaults to — Sprint 19b, item 14c.
 *
 * ── A marked year always wins ───────────────────────────────────────────
 * The flag is a decision somebody made, and the calendar is a guess about what
 * they would have decided. A school that has deliberately kept last year active
 * while it finishes its results must not have that quietly overturned on the
 * 1st of August by a query — so `is_active` sorts first and the calendar only
 * ever answers when nothing is marked at all.
 *
 * Before this, "nothing is marked" resolved to `null`, and null closed the
 * public application form, emptied the dashboard counts and refused every
 * enrollment with "no active academic year". A school that has just created its
 * calendar in a run and not yet pressed *Set as active* is in exactly that
 * state, which is the state item 14b's run form leaves them in most often.
 *
 * `limit(1)` over a deterministic order rather than a filter, because two years
 * can overlap — an April–March session and an August–July one at two campuses
 * of the same group both contain today in May. The earlier-starting one wins,
 * which is arbitrary but stable; a campus-specific answer is what
 * `academic_year_branches` is for and what the year picker offers.
 */
export async function getActiveAcademicYear(
  locationId: string,
): Promise<AcademicYear | null> {
  const rows = await db
    .select()
    .from(academicYears)
    .where(
      and(
        eq(academicYears.locationId, locationId),
        or(eq(academicYears.isActive, true), YEAR_CONTAINS_TODAY),
      ),
    )
    .orderBy(
      desc(academicYears.isActive),
      asc(academicYears.startYear),
      asc(academicYears.startMonth),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Whether a year is active *because somebody said so*, rather than by calendar.
 *
 * The academic-year screen needs the difference: a year that is current only
 * because today falls inside it is offered a *Set as active* button, and one
 * carrying the flag is not. Collapsing the two would hide the button on a year
 * nobody has ever confirmed.
 */
export async function getMarkedActiveAcademicYear(
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

/** True when any enrollment still points at this year. */
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
  /** Active enrollments in this section. */
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

/**
 * The class ladder, optionally narrowed to a campus scope.
 *
 * ── `branchIds`, not `branchId` ─────────────────────────────────────────
 * Sprint 19a: a person can hold several campuses, and `claims.branchId` answers
 * for exactly one of them. `ownedBy` is the right helper here and
 * `sharedOrOwnedBy` is not — `grades.branch_id` is NOT NULL and names the
 * campus that owns the row outright, so a null would be a data fault rather
 * than "shared", and admitting one would put another campus's classes into a
 * branch-bound reader's list. The two helpers are one identifier apart and give
 * opposite answers; see `lib/branch-scope.ts`.
 *
 * The single-campus form is kept for the callers that genuinely have one id in
 * hand — a grade picker inside one campus's own setup screen — and it is a
 * convenience over the same predicate, not a second rule.
 */
export async function listGrades(
  locationId: string,
  branchId?: string | undefined,
  branchIds?: string[] | null | undefined,
): Promise<GradeRow[]> {
  const conditions: SQL[] = [eq(grades.locationId, locationId)];
  if (branchId !== undefined && branchId !== '') {
    conditions.push(eq(grades.branchId, branchId));
  }
  const scoped = ownedBy(grades.branchId, branchIds ?? null);
  if (scoped !== undefined) conditions.push(scoped);

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
      // Only active enrollments count against capacity: a withdrawn student is
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

export interface CopySectionsResult {
  created: number;
  /** Sections the receiving year already had. Skipped, never an error. */
  skipped: number;
}

/**
 * Clone one year's classes into the next — Sprint 19b, item 15b.
 *
 * ── The task the promotion screen was actually asking for ───────────────
 * "Goes to" on `/dashboard/admissions/promote` reads every section of the
 * *receiving* year, and a school that has not built next year's classes yet has
 * none — so the dropdown was empty and said nothing about why. The honest fix
 * is not a better empty message; it is this button, because building twelve
 * grades' worth of sections by hand before you can promote anybody is the work
 * the operator had actually sat down to avoid.
 *
 * ── Active sections only ────────────────────────────────────────────────
 * A section deactivated this year is a class the school has stopped running,
 * and carrying it forward would quietly restart it in a year where nobody
 * decided to.
 *
 * ── The class teacher is not copied, and that is deliberate ─────────────
 * `class_teacher_id` decides who may enter that class's marks and set its
 * promotions. Who teaches 5-A *next* year is a decision the school has not made
 * in June, and copying this year's answer would hand next year's marks entry to
 * whoever happened to hold it — silently, on a screen nobody revisits. Capacity
 * *is* copied: a room holds what it holds.
 *
 * ── Idempotent by the unique index, not by a pre-check ──────────────────
 * `(grade_id, academic_year_id, name)` already refuses a duplicate, so pressing
 * the button twice creates nothing the second time and reports it as skipped.
 * Checking first would be a check two clerks could both pass.
 */
export async function copySectionsIntoYear(
  locationId: string,
  params: {
    fromAcademicYearId: string;
    toAcademicYearId: string;
    /** The campus scope this caller may write into. Null = every campus. */
    branchIds: string[] | null;
  },
): Promise<CopySectionsResult> {
  const source = await db
    .select({
      gradeId: sections.gradeId,
      name: sections.name,
      capacity: sections.capacity,
    })
    .from(sections)
    .innerJoin(
      grades,
      and(eq(grades.id, sections.gradeId), eq(grades.locationId, locationId)),
    )
    .where(
      and(
        eq(sections.locationId, locationId),
        eq(sections.academicYearId, params.fromAcademicYearId),
        eq(sections.isActive, true),
        // `ownedBy`, not `sharedOrOwnedBy`: `grades.branch_id` is NOT NULL and
        // names the campus that owns the class outright.
        ownedBy(grades.branchId, params.branchIds),
      ),
    );

  if (source.length === 0) return { created: 0, skipped: 0 };

  const inserted = await db
    .insert(sections)
    .values(
      source.map((row) => ({
        // Tenant from the verified session, never from the body.
        locationId,
        gradeId: row.gradeId,
        academicYearId: params.toAcademicYearId,
        name: row.name,
        capacity: row.capacity,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: sections.id });

  return { created: inserted.length, skipped: source.length - inserted.length };
}

/** True when any enrollment still points at this section. */
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
// Student documents — Sprint 19b, item 16
// -----------------------------------------------------------------------------

export interface StudentDocumentRow {
  id: string;
  title: string;
  downloadUrl: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}

/**
 * The paperwork held against one child, oldest first.
 *
 * Oldest first, unlike almost every other list in this product, and it is a
 * decision rather than an oversight: these are chips in a row on a profile
 * card, and a card whose chips *reorder* every time somebody adds one is a card
 * an operator has to re-read from scratch. Newest-first is right for a feed and
 * wrong for a stable set.
 *
 * `storage_path` is deliberately not returned. Nothing on a screen needs it,
 * and the delete route re-reads the row by id anyway — a path shipped to a
 * browser is a path a browser can be persuaded to send back.
 */
export async function listStudentDocuments(
  locationId: string,
  studentProfileId: string,
): Promise<StudentDocumentRow[]> {
  return db
    .select({
      id: studentDocuments.id,
      title: studentDocuments.title,
      downloadUrl: studentDocuments.downloadUrl,
      contentType: studentDocuments.contentType,
      sizeBytes: studentDocuments.sizeBytes,
      createdAt: studentDocuments.createdAt,
    })
    .from(studentDocuments)
    .where(
      and(
        eq(studentDocuments.locationId, locationId),
        eq(studentDocuments.studentProfileId, studentProfileId),
      ),
    )
    .orderBy(asc(studentDocuments.createdAt));
}

/**
 * How many documents this child already has — the ten-per-student ceiling.
 *
 * A count rather than the length of the list above, because the upload route
 * needs the number and not the rows, and a route that fetches ten titles and
 * ten URLs to compare one integer is a route that gets slower as the feature is
 * used.
 */
export async function countStudentDocuments(
  locationId: string,
  studentProfileId: string,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(studentDocuments)
    .where(
      and(
        eq(studentDocuments.locationId, locationId),
        eq(studentDocuments.studentProfileId, studentProfileId),
      ),
    );

  return rows[0]?.value ?? 0;
}

/** One document, read back by id and re-checked against its tenant and child. */
export async function getStudentDocument(
  locationId: string,
  studentProfileId: string,
  documentId: string,
): Promise<{ id: string; title: string; storagePath: string } | null> {
  const rows = await db
    .select({
      id: studentDocuments.id,
      title: studentDocuments.title,
      storagePath: studentDocuments.storagePath,
    })
    .from(studentDocuments)
    .where(
      and(
        eq(studentDocuments.locationId, locationId),
        eq(studentDocuments.studentProfileId, studentProfileId),
        eq(studentDocuments.id, documentId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
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
 * "who is in which class this year", and a student with no enrollment for the
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
      /*
       * Aliased `guardian_phone`, not `phone`, and that is load-bearing.
       *
       * Drizzle emits a raw-`sql` subquery column by its alias *unqualified* —
       * `"phone"`, not `"primary_guardian"."phone"`. `school_users` is joined
       * on the same statement and has a `phone` of its own, so the alias
       * `phone` made the whole listing fail to parse with
       * `column reference "phone" is ambiguous` (42702) — a 500 on the
       * all-students screen, every time. A name no other joined table carries
       * resolves unambiguously without qualifying anything.
       */
      phone: sql<string>`(array_agg(${studentGuardians.phone} order by ${studentGuardians.isPrimaryContact} desc, ${studentGuardians.createdAt} asc))[1]`.as(
        'guardian_phone',
      ),
    })
    .from(studentGuardians)
    .where(eq(studentGuardians.locationId, locationId))
    .groupBy(studentGuardians.studentProfileId)
    .as('primary_guardian');

  /*
   * The joined subquery's column, written out qualified.
   *
   * Drizzle emits a raw-`sql` subquery column by its bare alias, and this
   * statement also joins `school_users`, which has a `phone`. Unqualified, the
   * SELECT failed to parse (`column reference "phone" is ambiguous`, 42702) and
   * the WHERE below would have silently bound to `school_users.phone` — the
   * `student:<admission number>` sentinel this column exists to stop matching.
   * A qualified reference to a joined relation is valid in both clauses, which
   * a select-list alias would not be in the WHERE.
   *
   * No JavaScript value is interpolated here; the search pattern is bound by
   * `ilike` as a parameter, as CLAUDE.md requires.
   */
  const guardianPhoneColumn = sql<string>`"primary_guardian"."guardian_phone"`;

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
      ilike(guardianPhoneColumn, pattern),
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
      patterns.push(ilike(guardianPhoneColumn, `%${stored}%`));
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
      guardianPhone: guardianPhoneColumn,
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
  branchIds: string[] | null = null,
): Promise<AdmissionsOverview> {
  const activeYear = await getActiveAcademicYear(locationId);

  /*
   * The campus boundary — Sprint 19a, item 11.
   *
   * Three of the four counts reach a campus through `grades.branch_id`, which
   * is where every student-side query in this module already goes; the fourth
   * reads `admission_applications.branch_id` directly. `null` is every campus,
   * which is what every caller before this sprint got.
   *
   * **`newThisMonth` is deliberately not narrowed**, and the tile says so. A
   * `student_profiles` row is created before the child is placed in a section,
   * so there is no campus on it and no join that would find one — a record
   * typed at 10am and enrolled at 11am belongs to no campus in between.
   * Narrowing it by guesswork would under-count the one figure the admissions
   * desk is measured on.
   */
  const byCampus = branchIds === null ? undefined : inArray(grades.branchId, branchIds);

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
          .innerJoin(
            sections,
            and(
              eq(sections.id, studentEnrollments.sectionId),
              eq(sections.locationId, locationId),
            ),
          )
          .innerJoin(
            grades,
            and(eq(grades.id, sections.gradeId), eq(grades.locationId, locationId)),
          )
          .where(
            and(
              eq(studentEnrollments.locationId, locationId),
              eq(studentEnrollments.academicYearId, activeYear.id),
              eq(studentEnrollments.status, 'active'),
              byCampus,
            ),
          ),
    db
      .select({ value: count() })
      .from(admissionApplications)
      .where(
        and(
          eq(admissionApplications.locationId, locationId),
          inArray(admissionApplications.status, [...OPEN_APPLICATION_STATUSES]),
          branchIds === null
            ? undefined
            : inArray(admissionApplications.branchId, branchIds),
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
      // The same `scope` shape BR4 uses, so a campus selection and a
      // principal's assignment narrow this list through one code path.
      scope: { branchIds, gradeIds: null },
    }),
    listApplications(locationId, {
      status: 'pending',
      limit: 5,
      ...(branchIds === null || branchIds.length !== 1
        ? {}
        : { branchId: branchIds[0] }),
    }),
    activeYear === null
      ? Promise.resolve([])
      : listSectionsWhere(
          and(
            eq(sections.locationId, locationId),
            eq(sections.academicYearId, activeYear.id),
            eq(sections.isActive, true),
            branchIds === null
              ? undefined
              : inArray(
                  sections.gradeId,
                  db
                    .select({ id: grades.id })
                    .from(grades)
                    .where(
                      and(
                        eq(grades.locationId, locationId),
                        inArray(grades.branchId, branchIds),
                      ),
                    ),
                ),
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

/** Active enrollments in the school's active year — the dashboard headline. */
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

/**
 * The campus a student is enrolled at, for a given academic year.
 *
 * ── Why this exists, and what it fixed (Sprint 19a, D1) ──────────────────
 * `fee_challans` carries no campus; it carries a student, and a student reaches
 * a campus through their section's grade. Everything on the fee side already
 * made that hop — and the *ledger* did not. `postTransaction` was called for a
 * fee payment with no `branchId`, so every fee-payment posting since Sprint
 * 13.5 has `branch_id = NULL`.
 *
 * The result was two charts on the owner's dashboard disagreeing about the same
 * PKR 20,000: **Collection by campus** attributed it to Defence Branch, because
 * it resolves the campus through the student; **Income against expense by
 * campus** attributed it to *No campus*, because it groups on the column
 * nobody had filled in. The ledger was not wrong — it was never told.
 *
 * ── One definition, used on both sides ───────────────────────────────────
 * This is the scalar form. `campusOfStudent` in `lib/dashboard-queries.ts` is
 * the set-valued form of the same hop, and `feePaymentCampusFor` there is the
 * same hop again as a repair for rows written before this existed. All three
 * must answer the same question the same way or the charts drift apart again,
 * which is the whole defect.
 *
 * ── The year is the *voucher's*, not today's ─────────────────────────────
 * A payment taken this month against last year's voucher belongs to the campus
 * the child was at *then*. Resolving it against the current year would move
 * historical money to wherever the child has since transferred, and a ledger
 * whose past changes when a student moves is not a ledger.
 *
 * Migration `0019` constrains a student to one active enrollment per year, so
 * this is a single row rather than a pick among several — the same reading
 * `searchStudents` relies on.
 *
 * ── Null is a legal answer and must not refuse anything ──────────────────
 * A student with no active enrollment for that year — withdrawn, or paying an
 * admission fee before placement — has no campus, and that is not a reason to
 * refuse their money. The posting is made school-wide, exactly as every
 * posting was before this.
 */
export async function campusForStudent(
  locationId: string,
  studentProfileId: string,
  academicYearId: string,
): Promise<string | null> {
  const rows = await db
    .select({ branchId: grades.branchId })
    .from(studentEnrollments)
    .innerJoin(
      sections,
      and(
        eq(sections.id, studentEnrollments.sectionId),
        eq(sections.locationId, locationId),
      ),
    )
    .innerJoin(
      grades,
      and(eq(grades.id, sections.gradeId), eq(grades.locationId, locationId)),
    )
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
        eq(studentEnrollments.academicYearId, academicYearId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .limit(1);

  return rows[0]?.branchId ?? null;
}
