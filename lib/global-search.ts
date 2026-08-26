import 'server-only';

import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';

import {
  admissionApplications,
  announcements,
  branches,
  feeChallans,
  grades,
  schoolUsers,
  schools,
  sections,
  staff,
  studentEnrollments,
  studentGuardians,
  studentProfiles,
  subjects,
} from '@/db/schema';

import { db } from './drizzle';
import { formatPkr } from './money';
import type { Permission } from './permissions';
import { HITS_PER_GROUP, likePattern, type SearchGroup, type SearchHit } from './search-types';

/**
 * Global search, one module, five scopes.
 *
 * ── Why every portal gets its own function ───────────────────────────────
 * The whole risk in a global search is that it is the one feature whose job is
 * to reach across everything, and the tenancy rules are the thing it must not
 * reach across. A single `search(query, viewer)` with a `viewer` shaped
 * differently per portal would put "may this person see a student" behind a
 * branch inside a shared function — and the branch that is wrong returns
 * results rather than an error, which is the failure nobody notices.
 *
 * So there are five entry points, each of which can be read start to finish and
 * checked against one question: what does this person already have a screen
 * for? Nothing here surfaces a record its caller could not already open by
 * navigating. A search that finds what a portal cannot show is a permissions
 * leak with a nice interface on it.
 *
 * ── ILIKE, not full text ─────────────────────────────────────────────────
 * A `tsvector` index is the right answer at a hundred thousand rows and the
 * wrong one here: it stems, and stemming is exactly wrong for the things people
 * actually search a school system for — an admission number, a challan number,
 * a section called "5-A". `ILIKE '%…%'` on the handful of columns that carry
 * names is unindexed and honest, and the largest table it touches is one
 * school's enrolments. Every query is capped, so the cost has a ceiling. When a
 * school arrives that this is slow for, the fix is a trigram index on the same
 * columns and not a rewrite.
 *
 * ── Every group is capped at `HITS_PER_GROUP + 1` ────────────────────────
 * One more than is shown, so "there are more of these" is known without a
 * second `count(*)` per category. Nine rows and eight displayed is the cheapest
 * possible way to render "showing the first 8".
 */

/** BR4: a principal's grade list, or null for the whole school. */
export interface SearchScope {
  gradeIds: readonly string[] | null;
}

const LIMIT = HITS_PER_GROUP + 1;

function group(
  key: string,
  label: string,
  icon: string,
  hits: SearchHit[],
  moreHref?: string,
): SearchGroup | null {
  if (hits.length === 0) return null;

  const truncated = hits.length > HITS_PER_GROUP;

  return {
    key,
    label,
    icon,
    hits: truncated ? hits.slice(0, HITS_PER_GROUP) : hits,
    truncated,
    ...(moreHref === undefined ? {} : { moreHref }),
  };
}

/**
 * A principal's grade filter, or `undefined` when nothing is narrowed.
 *
 * Every scoped query in this module narrows on the same column —
 * `sections.grade_id` — so this takes no column argument. The first cut did,
 * typed loosely enough to need an `as never` at each of its three call sites,
 * and a cast at a call site is how the wrong column eventually gets passed to a
 * function whose whole job is enforcing a boundary.
 *
 * `inArray` with an empty list is `false` in Drizzle, which is the reading
 * wanted and the dangerous bug avoided: an unassigned head matches no row
 * rather than every row. §5ba records why that inverse is the one to fear — it
 * hands a head the whole school and the screen looks entirely normal.
 */
function gradeScope(scope: SearchScope | undefined): SQL | undefined {
  if (scope?.gradeIds == null) return undefined;
  return inArray(sections.gradeId, [...scope.gradeIds]);
}

/** Appends the grade filter when there is one. */
function withScope(conditions: SQL[], scope: SearchScope | undefined): void {
  const condition = gradeScope(scope);
  if (condition !== undefined) conditions.push(condition);
}

/* -------------------------------------------------------------------------- */
/* The administrative portal                                                   */
/* -------------------------------------------------------------------------- */

export interface SchoolSearchInput {
  locationId: string;
  query: string;
  permissions: readonly Permission[];
  scope?: SearchScope;
}

/**
 * Students, by name, admission number or the guardian's phone.
 *
 * Reads through `student_enrollments` rather than `student_profiles`, so an
 * applicant converted but never enrolled does not appear as a student — they
 * appear under Applications, which is where they are. `DISTINCT ON` is not
 * needed because a student has one active enrolment per year by constraint
 * (migration `0019`).
 */
async function searchStudents(input: SchoolSearchInput): Promise<SearchHit[]> {
  const pattern = likePattern(input.query);

  const conditions: SQL[] = [eq(studentEnrollments.locationId, input.locationId)];
  withScope(conditions, input.scope);

  const matches = or(
    ilike(schoolUsers.name, pattern),
    ilike(studentProfiles.studentId, pattern),
    ilike(schoolUsers.phone, pattern),
  );
  if (matches !== undefined) conditions.push(matches);

  const rows = await db
    .select({
      id: studentProfiles.id,
      name: schoolUsers.name,
      studentId: studentProfiles.studentId,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
      status: studentEnrollments.status,
    })
    .from(studentEnrollments)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentEnrollments.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(and(...conditions))
    .orderBy(schoolUsers.name)
    .limit(LIMIT);

  return rows.map((row) => ({
    key: `student:${row.id}`,
    title: row.name,
    subtitle: `${row.studentId} · ${row.gradeDisplayName ?? row.gradeName} ${row.sectionName}`,
    href: `/dashboard/admissions/students/${row.id}`,
    page: 'Student detail',
    badge: row.status,
  }));
}

/**
 * Guardians, which are a category and not a footnote on a student.
 *
 * A parent phoning the office gives their own name, not their child's, and
 * before this the only way to find them was to already know which child they
 * belonged to. The hit leads to the student's record, because that is where a
 * guardian is shown — and the subtitle names the child so the clerk can tell
 * two Muhammad Aslams apart before clicking.
 */
async function searchGuardians(input: SchoolSearchInput): Promise<SearchHit[]> {
  const pattern = likePattern(input.query);

  const matches = or(
    ilike(studentGuardians.name, pattern),
    ilike(studentGuardians.phone, pattern),
    ilike(studentGuardians.cnic, pattern),
    ilike(studentGuardians.email, pattern),
  );
  if (matches === undefined) return [];

  const rows = await db
    .select({
      id: studentGuardians.id,
      name: studentGuardians.name,
      relationship: studentGuardians.relationship,
      phone: studentGuardians.phone,
      studentProfileId: studentGuardians.studentProfileId,
      childName: schoolUsers.name,
    })
    .from(studentGuardians)
    .innerJoin(
      studentProfiles,
      eq(studentProfiles.id, studentGuardians.studentProfileId),
    )
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .where(and(eq(studentGuardians.locationId, input.locationId), matches))
    .orderBy(studentGuardians.name)
    .limit(LIMIT);

  return rows.map((row) => ({
    key: `guardian:${row.id}`,
    title: row.name,
    subtitle: `${row.relationship} of ${row.childName} · ${row.phone}`,
    href: `/dashboard/admissions/students/${row.studentProfileId}`,
    page: 'Guardian on a student record',
  }));
}

async function searchStaff(input: SchoolSearchInput): Promise<SearchHit[]> {
  const pattern = likePattern(input.query);

  const matches = or(
    ilike(staff.firstName, pattern),
    ilike(staff.lastName, pattern),
    ilike(staff.employeeCode, pattern),
    ilike(staff.designation, pattern),
    ilike(staff.phone, pattern),
    ilike(staff.email, pattern),
    // The whole name, so "Ayesha Khan" finds a row whose two columns each hold
    // half of it. Neither single-column match would.
    sql`${staff.firstName} || ' ' || ${staff.lastName} ILIKE ${pattern}`,
  );
  if (matches === undefined) return [];

  const rows = await db
    .select({
      id: staff.id,
      firstName: staff.firstName,
      lastName: staff.lastName,
      employeeCode: staff.employeeCode,
      designation: staff.designation,
      status: staff.status,
      branchName: branches.name,
    })
    .from(staff)
    .leftJoin(branches, eq(branches.id, staff.branchId))
    .where(and(eq(staff.locationId, input.locationId), matches))
    .orderBy(staff.firstName)
    .limit(LIMIT);

  return rows.map((row) => ({
    key: `staff:${row.id}`,
    title: `${row.firstName} ${row.lastName}`,
    subtitle: [row.employeeCode, row.designation, row.branchName]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · '),
    href: `/dashboard/hr/staff/${row.id}`,
    page: 'Staff record',
    badge: row.status,
  }));
}

/**
 * Portal accounts.
 *
 * Students and parents are excluded rather than filtered out afterwards: they
 * have their own categories above, and a directory hit for the same person
 * under a third heading is noise that pushes a real answer off the screen.
 */
async function searchUsers(input: SchoolSearchInput): Promise<SearchHit[]> {
  const pattern = likePattern(input.query);

  const matches = or(
    ilike(schoolUsers.name, pattern),
    ilike(schoolUsers.email, pattern),
    ilike(schoolUsers.phone, pattern),
  );
  if (matches === undefined) return [];

  const rows = await db
    .select({
      id: schoolUsers.id,
      name: schoolUsers.name,
      email: schoolUsers.email,
      role: schoolUsers.role,
      isActive: schoolUsers.isActive,
    })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, input.locationId),
        sql`${schoolUsers.role} NOT IN ('student', 'parent')`,
        matches,
      ),
    )
    .orderBy(schoolUsers.name)
    .limit(LIMIT);

  return rows.map((row) => ({
    key: `user:${row.id}`,
    title: row.name,
    subtitle: [row.role, row.email]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · '),
    href: `/dashboard/users/${row.id}`,
    page: 'User detail',
    badge: row.isActive ? undefined : 'inactive',
  }));
}

async function searchClasses(input: SchoolSearchInput): Promise<SearchHit[]> {
  const pattern = likePattern(input.query);

  const conditions: SQL[] = [eq(sections.locationId, input.locationId)];
  withScope(conditions, input.scope);

  const matches = or(
    ilike(sections.name, pattern),
    ilike(grades.name, pattern),
    ilike(grades.displayName, pattern),
    sql`${grades.name} || ' ' || ${sections.name} ILIKE ${pattern}`,
    // "5-A" is how a school writes it and how nobody stores it.
    sql`${grades.name} || '-' || ${sections.name} ILIKE ${pattern}`,
  );
  if (matches !== undefined) conditions.push(matches);

  const rows = await db
    .select({
      id: sections.id,
      sectionName: sections.name,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      branchName: branches.name,
    })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .leftJoin(branches, eq(branches.id, grades.branchId))
    .where(and(...conditions))
    .orderBy(grades.sortOrder, sections.name)
    .limit(LIMIT);

  return rows.map((row) => ({
    key: `section:${row.id}`,
    title: `${row.gradeDisplayName ?? row.gradeName} · ${row.sectionName}`,
    subtitle: row.branchName,
    href: '/dashboard/admissions/grades',
    page: 'Classes & sections',
  }));
}

async function searchSubjects(input: SchoolSearchInput): Promise<SearchHit[]> {
  const pattern = likePattern(input.query);

  const matches = or(ilike(subjects.name, pattern), ilike(subjects.code, pattern));
  if (matches === undefined) return [];

  const rows = await db
    .select({
      id: subjects.id,
      name: subjects.name,
      code: subjects.code,
      isActive: subjects.isActive,
    })
    .from(subjects)
    .where(and(eq(subjects.locationId, input.locationId), matches))
    .orderBy(subjects.name)
    .limit(LIMIT);

  return rows.map((row) => ({
    key: `subject:${row.id}`,
    title: row.name,
    subtitle: row.code,
    href: `/dashboard/academics/subjects/${row.id}/edit`,
    page: 'Subject',
    badge: row.isActive ? undefined : 'inactive',
  }));
}

/**
 * Challans, by number or by the student they belong to.
 *
 * The challan number is the thing a parent reads down the phone, and it was
 * previously findable only from the register with the right filters set. The
 * amount is in the subtitle because "which of these four is the one they mean"
 * is the next question and the money answers it.
 */
async function searchChallans(input: SchoolSearchInput): Promise<SearchHit[]> {
  const pattern = likePattern(input.query);

  const conditions: SQL[] = [eq(feeChallans.locationId, input.locationId)];
  withScope(conditions, input.scope);

  const matches = or(
    ilike(feeChallans.challanNumber, pattern),
    ilike(schoolUsers.name, pattern),
    ilike(studentProfiles.studentId, pattern),
  );
  if (matches !== undefined) conditions.push(matches);

  const rows = await db
    .select({
      id: feeChallans.id,
      challanNumber: feeChallans.challanNumber,
      totalAmount: feeChallans.totalAmount,
      dueDate: feeChallans.dueDate,
      status: feeChallans.status,
      studentName: schoolUsers.name,
    })
    .from(feeChallans)
    .innerJoin(studentProfiles, eq(studentProfiles.id, feeChallans.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    // Left, not inner: a challan for a student between enrolments must still be
    // findable, and an inner join here would hide exactly the ones being chased.
    .leftJoin(
      studentEnrollments,
      eq(studentEnrollments.studentProfileId, feeChallans.studentProfileId),
    )
    .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .where(and(...conditions))
    .orderBy(desc(feeChallans.dueDate))
    .limit(LIMIT);

  return rows.map((row) => ({
    key: `challan:${row.id}`,
    title: row.challanNumber,
    subtitle: `${row.studentName} · ${formatPkr(Number(row.totalAmount))} · due ${row.dueDate}`,
    href: `/dashboard/fees/challans/${row.id}`,
    page: 'Challan',
    badge: row.status,
  }));
}

async function searchApplications(input: SchoolSearchInput): Promise<SearchHit[]> {
  const pattern = likePattern(input.query);

  const matches = or(
    ilike(admissionApplications.studentName, pattern),
    ilike(admissionApplications.guardianName, pattern),
    ilike(admissionApplications.guardianPhone, pattern),
    ilike(admissionApplications.guardianEmail, pattern),
  );
  if (matches === undefined) return [];

  const rows = await db
    .select({
      id: admissionApplications.id,
      studentName: admissionApplications.studentName,
      guardianName: admissionApplications.guardianName,
      status: admissionApplications.status,
      submittedAt: admissionApplications.submittedAt,
    })
    .from(admissionApplications)
    .where(and(eq(admissionApplications.locationId, input.locationId), matches))
    .orderBy(desc(admissionApplications.submittedAt))
    .limit(LIMIT);

  return rows.map((row) => ({
    key: `application:${row.id}`,
    title: row.studentName,
    subtitle: `Guardian ${row.guardianName}`,
    href: `/dashboard/admissions/applications/${row.id}`,
    page: 'Application',
    badge: row.status,
  }));
}

async function searchAnnouncements(
  locationId: string,
  query: string,
  href: string,
): Promise<SearchHit[]> {
  const pattern = likePattern(query);

  const matches = or(ilike(announcements.title, pattern), ilike(announcements.body, pattern));
  if (matches === undefined) return [];

  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      status: announcements.status,
      sentAt: announcements.sentAt,
      createdAt: announcements.createdAt,
    })
    .from(announcements)
    .where(and(eq(announcements.locationId, locationId), matches))
    .orderBy(desc(announcements.createdAt))
    .limit(LIMIT);

  return rows.map((row) => ({
    key: `announcement:${row.id}`,
    title: row.title,
    subtitle: (row.sentAt ?? row.createdAt).toISOString().slice(0, 10),
    href,
    page: 'Announcements',
    badge: row.status,
  }));
}

/**
 * A notice a portal reader may actually see.
 *
 * The administrative search above returns drafts and scheduled notices, because
 * an administrator writes them. This one returns only `sent`, because a parent
 * finding tomorrow's fee-deadline notice through the search box would be the
 * announcement module's central rule broken by its newest feature.
 */
async function searchSentAnnouncements(
  locationId: string,
  query: string,
  href: string,
): Promise<SearchHit[]> {
  const pattern = likePattern(query);

  const matches = or(ilike(announcements.title, pattern), ilike(announcements.body, pattern));
  if (matches === undefined) return [];

  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      sentAt: announcements.sentAt,
    })
    .from(announcements)
    .where(
      and(
        eq(announcements.locationId, locationId),
        eq(announcements.status, 'sent'),
        matches,
      ),
    )
    .orderBy(desc(announcements.sentAt))
    .limit(LIMIT);

  return rows.map((row) => ({
    key: `announcement:${row.id}`,
    title: row.title,
    subtitle: row.sentAt === null ? null : row.sentAt.toISOString().slice(0, 10),
    href,
    page: 'Notice board',
  }));
}

/**
 * The administrative portal's results.
 *
 * Every block is gated on the *read* permission the destination screen itself
 * enforces, so a hit can never lead somewhere the guard would bounce — the same
 * rule `schoolNav` follows for links. An accountant searching a name finds the
 * challans and not the staff file.
 *
 * The reads run in parallel and are ordered afterwards, so the category order
 * on screen is fixed rather than a race: people first, then the things people
 * have, then the paperwork.
 */
export async function searchSchoolPortal(
  input: SchoolSearchInput,
): Promise<SearchGroup[]> {
  const can = (permission: Permission): boolean => input.permissions.includes(permission);

  const [students, guardians, staffRows, users, classes, subjectRows, challans, applications, notices] =
    await Promise.all([
      can('admissions.read') ? searchStudents(input) : [],
      can('admissions.read') ? searchGuardians(input) : [],
      can('hr.read') ? searchStaff(input) : [],
      can('users.read') ? searchUsers(input) : [],
      can('academics.read') ? searchClasses(input) : [],
      can('academics.read') ? searchSubjects(input) : [],
      can('fees.read') ? searchChallans(input) : [],
      can('admissions.read') ? searchApplications(input) : [],
      can('comms.read')
        ? searchAnnouncements(input.locationId, input.query, '/dashboard/communications')
        : [],
    ]);

  return [
    group('students', 'Students', 'students', students, '/dashboard/admissions/students'),
    group('guardians', 'Parents & guardians', 'users', guardians),
    group('staff', 'Teachers & staff', 'hr', staffRows, '/dashboard/hr/staff'),
    group('users', 'Portal accounts', 'users', users, '/dashboard/users'),
    group('classes', 'Classes & sections', 'grades', classes, '/dashboard/admissions/grades'),
    group('subjects', 'Subjects', 'subjects', subjectRows, '/dashboard/academics/subjects'),
    group('challans', 'Fee challans', 'fees', challans, '/dashboard/fees/challans'),
    group(
      'applications',
      'Applications',
      'applications',
      applications,
      '/dashboard/admissions/applications',
    ),
    group('announcements', 'Announcements', 'announcements', notices, '/dashboard/communications'),
  ].filter((entry): entry is SearchGroup => entry !== null);
}

/* -------------------------------------------------------------------------- */
/* The teacher portal                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A teacher finds the children they teach, and nobody else's.
 *
 * The scope is the sections they hold a timetable entry for or are class
 * teacher of — resolved by the caller and handed in as a list, because that
 * resolution already exists in `lib/portal-dashboard.ts` and a second copy of
 * "which classes are mine" would be a second answer.
 *
 * An empty list matches nothing, which is the correct answer for a teacher with
 * no timetable yet and is the same `inArray` reading BR4 relies on.
 */
export async function searchTeacherPortal(input: {
  locationId: string;
  query: string;
  sectionIds: readonly string[];
}): Promise<SearchGroup[]> {
  const pattern = likePattern(input.query);

  const studentMatches = or(
    ilike(schoolUsers.name, pattern),
    ilike(studentProfiles.studentId, pattern),
  );

  const [students, subjectRows, notices] = await Promise.all([
    input.sectionIds.length === 0 || studentMatches === undefined
      ? []
      : db
          .select({
            id: studentProfiles.id,
            name: schoolUsers.name,
            studentId: studentProfiles.studentId,
            gradeName: grades.name,
            gradeDisplayName: grades.displayName,
            sectionName: sections.name,
          })
          .from(studentEnrollments)
          .innerJoin(
            studentProfiles,
            eq(studentProfiles.id, studentEnrollments.studentProfileId),
          )
          .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
          .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
          .innerJoin(grades, eq(grades.id, sections.gradeId))
          .where(
            and(
              eq(studentEnrollments.locationId, input.locationId),
              inArray(studentEnrollments.sectionId, [...input.sectionIds]),
              studentMatches,
            ),
          )
          .orderBy(schoolUsers.name)
          .limit(LIMIT),
    searchSubjectsFor(input.locationId, input.query),
    searchSentAnnouncements(input.locationId, input.query, '/teacher/announcements'),
  ]);

  return [
    group(
      'students',
      'My students',
      'students',
      students.map((row) => ({
        key: `student:${row.id}`,
        title: row.name,
        // No link: a teacher has no student-detail screen, and a hit that
        // navigates to a 403 is worse than one that simply tells them the child
        // is in 5-A. `/teacher/classes` is where they go next.
        subtitle: `${row.studentId} · ${row.gradeDisplayName ?? row.gradeName} ${row.sectionName}`,
        href: '/teacher/classes',
        page: 'My classes',
      })),
      '/teacher/classes',
    ),
    group('subjects', 'Subjects', 'subjects', subjectRows),
    group('announcements', 'Notice board', 'announcements', notices, '/teacher/announcements'),
  ].filter((entry): entry is SearchGroup => entry !== null);
}

/** Subjects without a link to the editor, for the portals that cannot edit. */
async function searchSubjectsFor(locationId: string, query: string): Promise<SearchHit[]> {
  const pattern = likePattern(query);
  const matches = or(ilike(subjects.name, pattern), ilike(subjects.code, pattern));
  if (matches === undefined) return [];

  const rows = await db
    .select({ id: subjects.id, name: subjects.name, code: subjects.code })
    .from(subjects)
    .where(
      and(eq(subjects.locationId, locationId), eq(subjects.isActive, true), matches),
    )
    .orderBy(subjects.name)
    .limit(LIMIT);

  return rows.map((row) => ({
    key: `subject:${row.id}`,
    title: row.name,
    subtitle: row.code,
    href: '/teacher/timetable',
    page: 'Timetable',
  }));
}

/* -------------------------------------------------------------------------- */
/* The parent portal                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A parent searches their own children and their own challans.
 *
 * `studentProfileIds` is this login's children, resolved by the caller through
 * `listPortalChildren` — the one place in the product that answers "whose
 * children are these", and the place Sprint 13.8's sibling identity work put
 * it. Passing the list in rather than re-deriving it here is what stops this
 * feature developing its own, subtly different, opinion about family.
 */
export async function searchParentPortal(input: {
  locationId: string;
  query: string;
  studentProfileIds: readonly string[];
}): Promise<SearchGroup[]> {
  if (input.studentProfileIds.length === 0) {
    return (
      [
        group(
          'announcements',
          'Notice board',
          'announcements',
          await searchSentAnnouncements(input.locationId, input.query, '/parent/announcements'),
          '/parent/announcements',
        ),
      ] as Array<SearchGroup | null>
    ).filter((entry): entry is SearchGroup => entry !== null);
  }

  const pattern = likePattern(input.query);
  const ids = [...input.studentProfileIds];

  const childMatches = or(
    ilike(schoolUsers.name, pattern),
    ilike(studentProfiles.studentId, pattern),
  );

  const challanMatches = or(
    ilike(feeChallans.challanNumber, pattern),
    ilike(schoolUsers.name, pattern),
  );

  const [children, challans, notices] = await Promise.all([
    childMatches === undefined
      ? []
      : db
          .select({
            id: studentProfiles.id,
            name: schoolUsers.name,
            studentId: studentProfiles.studentId,
          })
          .from(studentProfiles)
          .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
          .where(
            and(
              eq(studentProfiles.locationId, input.locationId),
              inArray(studentProfiles.id, ids),
              childMatches,
            ),
          )
          .orderBy(schoolUsers.name)
          .limit(LIMIT),
    challanMatches === undefined
      ? []
      : db
          .select({
            id: feeChallans.id,
            challanNumber: feeChallans.challanNumber,
            totalAmount: feeChallans.totalAmount,
            dueDate: feeChallans.dueDate,
            status: feeChallans.status,
            studentName: schoolUsers.name,
          })
          .from(feeChallans)
          .innerJoin(
            studentProfiles,
            eq(studentProfiles.id, feeChallans.studentProfileId),
          )
          .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
          .where(
            and(
              eq(feeChallans.locationId, input.locationId),
              inArray(feeChallans.studentProfileId, ids),
              challanMatches,
            ),
          )
          .orderBy(desc(feeChallans.dueDate))
          .limit(LIMIT),
    searchSentAnnouncements(input.locationId, input.query, '/parent/announcements'),
  ]);

  return [
    group(
      'children',
      'My children',
      'students',
      children.map((row) => ({
        key: `child:${row.id}`,
        title: row.name,
        subtitle: row.studentId,
        href: '/parent/children',
        page: 'My children',
      })),
      '/parent/children',
    ),
    group(
      'challans',
      'Fee challans',
      'fees',
      challans.map((row) => ({
        key: `challan:${row.id}`,
        title: row.challanNumber,
        subtitle: `${row.studentName} · ${formatPkr(Number(row.totalAmount))} · due ${row.dueDate}`,
        href: '/parent/fees',
        page: 'Fees',
        badge: row.status,
      })),
      '/parent/fees',
    ),
    group('announcements', 'Notice board', 'announcements', notices, '/parent/announcements'),
  ].filter((entry): entry is SearchGroup => entry !== null);
}

/* -------------------------------------------------------------------------- */
/* The student portal                                                          */
/* -------------------------------------------------------------------------- */

export async function searchStudentPortal(input: {
  locationId: string;
  query: string;
  studentProfileId: string | null;
}): Promise<SearchGroup[]> {
  const pattern = likePattern(input.query);

  const challanMatches = ilike(feeChallans.challanNumber, pattern);

  const [challans, subjectRows, notices] = await Promise.all([
    input.studentProfileId === null
      ? []
      : db
          .select({
            id: feeChallans.id,
            challanNumber: feeChallans.challanNumber,
            totalAmount: feeChallans.totalAmount,
            dueDate: feeChallans.dueDate,
            status: feeChallans.status,
          })
          .from(feeChallans)
          .where(
            and(
              eq(feeChallans.locationId, input.locationId),
              eq(feeChallans.studentProfileId, input.studentProfileId),
              challanMatches,
            ),
          )
          .orderBy(desc(feeChallans.dueDate))
          .limit(LIMIT),
    searchSubjectsFor(input.locationId, input.query),
    searchSentAnnouncements(input.locationId, input.query, '/student/announcements'),
  ]);

  return [
    group(
      'challans',
      'My fee challans',
      'fees',
      challans.map((row) => ({
        key: `challan:${row.id}`,
        title: row.challanNumber,
        subtitle: `${formatPkr(Number(row.totalAmount))} · due ${row.dueDate}`,
        href: '/student/fees',
        page: 'Fees',
        badge: row.status,
      })),
      '/student/fees',
    ),
    group(
      'subjects',
      'My subjects',
      'subjects',
      subjectRows.map((hit) => ({ ...hit, href: '/student/timetable', page: 'Timetable' })),
      '/student/timetable',
    ),
    group('announcements', 'Notice board', 'announcements', notices, '/student/announcements'),
  ].filter((entry): entry is SearchGroup => entry !== null);
}

/* -------------------------------------------------------------------------- */
/* The platform portal                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The Super Admin's results — schools, campuses, and the people in them.
 *
 * Cross-tenant, which is the whole point of the surface, and the one search in
 * the product that takes no `locationId`. The category a hit belongs to always
 * names its school in the subtitle: an operator finding "Ayesha Khan" needs to
 * know which of four schools she works at before anything else.
 */
export async function searchPlatform(query: string): Promise<SearchGroup[]> {
  const pattern = likePattern(query);

  const schoolMatches = or(
    ilike(schools.name, pattern),
    ilike(schools.slug, pattern),
    ilike(schools.city, pattern),
    ilike(schools.schoolCode, pattern),
    ilike(schools.email, pattern),
    ilike(schools.principalName, pattern),
  );

  const branchMatches = or(
    ilike(branches.name, pattern),
    ilike(branches.code, pattern),
    ilike(branches.city, pattern),
  );

  const userMatches = or(
    ilike(schoolUsers.name, pattern),
    ilike(schoolUsers.email, pattern),
    ilike(schoolUsers.phone, pattern),
  );

  const [schoolRows, branchRows, userRows] = await Promise.all([
    schoolMatches === undefined
      ? []
      : db
          .select({
            id: schools.id,
            locationId: schools.locationId,
            name: schools.name,
            city: schools.city,
            slug: schools.slug,
            isActive: schools.isActive,
          })
          .from(schools)
          .where(schoolMatches)
          .orderBy(schools.name)
          .limit(LIMIT),
    branchMatches === undefined
      ? []
      : db
          .select({
            id: branches.id,
            name: branches.name,
            city: branches.city,
            schoolName: schools.name,
            schoolId: schools.id,
          })
          .from(branches)
          .innerJoin(schools, eq(schools.locationId, branches.locationId))
          .where(branchMatches)
          .orderBy(branches.name)
          .limit(LIMIT),
    userMatches === undefined
      ? []
      : db
          .select({
            id: schoolUsers.id,
            name: schoolUsers.name,
            email: schoolUsers.email,
            role: schoolUsers.role,
            schoolName: schools.name,
            schoolId: schools.id,
          })
          .from(schoolUsers)
          .innerJoin(schools, eq(schools.locationId, schoolUsers.locationId))
          // Administrative accounts only. A platform operator searching a name
          // is looking for whoever runs a school, and every student and parent
          // in the estate under the same heading would bury them.
          .where(
            and(sql`${schoolUsers.role} NOT IN ('student', 'parent')`, userMatches),
          )
          .orderBy(schoolUsers.name)
          .limit(LIMIT),
  ]);

  return [
    group(
      'schools',
      'Schools',
      'schools',
      schoolRows.map((row) => ({
        key: `school:${row.id}`,
        title: row.name,
        subtitle: `${row.city} · ${row.slug}`,
        href: `/super-admin/schools/${row.id}`,
        page: 'School detail',
        badge: row.isActive ? undefined : 'inactive',
      })),
      '/super-admin/schools',
    ),
    group(
      'branches',
      'Campuses',
      'branches',
      branchRows.map((row) => ({
        key: `branch:${row.id}`,
        title: row.name,
        subtitle: `${row.schoolName} · ${row.city}`,
        href: `/super-admin/schools/${row.schoolId}?tab=branches`,
        page: 'School detail · Branches',
      })),
    ),
    group(
      'people',
      'People',
      'users',
      userRows.map((row) => ({
        key: `user:${row.id}`,
        title: row.name,
        subtitle: [row.schoolName, row.role, row.email]
          .filter((part): part is string => part !== null && part !== '')
          .join(' · '),
        href: `/super-admin/schools/${row.schoolId}?tab=users`,
        page: 'School detail · Users',
      })),
    ),
  ].filter((entry): entry is SearchGroup => entry !== null);
}
