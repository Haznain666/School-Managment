import 'server-only';

import { and, asc, desc, eq, inArray, isNotNull, ne, or } from 'drizzle-orm';

import {
  academicYears,
  branches,
  grades,
  schoolUsers,
  sections,
  studentEnrollments,
  studentGuardians,
  studentProfiles,
  gradeLabel,
  type GuardianRelationship,
} from '@/db/schema';

import { db } from './drizzle';
import { normalizeCnic } from './national-id';

/**
 * The school's active academic year, or null.
 *
 * Read here rather than imported from `lib/admissions-queries.ts` so that the
 * sibling module does not pull the whole admissions surface — and its whole
 * import graph — into every page that only wants to name a brother.
 */
async function activeYearId(locationId: string): Promise<string | null> {
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
 * Who is related to whom, resolved once for the whole product.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 * **Two enrolled students are siblings when they share a guardian.** There is
 * no sibling table, no household record and no link between one student and
 * another — there is only `student_guardians`, which holds one row per
 * guardian *per child*, and the question of when two of those rows are the
 * same person.
 *
 * Two rows are the same person when either is true:
 *
 *   1. they carry the **same CNIC**, or
 *   2. they carry the **same phone number**.
 *
 * ── Why CNIC is first, and why phone is still there ──────────────────────
 * The CNIC is the honest key: issued once, to one person, for life. It is what
 * the enrollment form now asks for before it asks for anything else, precisely
 * so that the second child of an existing parent is recognised as they are
 * being admitted rather than discovered later at the fee counter.
 *
 * The phone number cannot simply be dropped in its favour. Every guardian
 * recorded before 2026-08-20 has a phone and most have no CNIC, and a rule
 * that ignored them would un-relate every family already on the roll — the
 * family voucher would stop grouping and a real regression would ship dressed
 * as an improvement. So both keys count, and they are OR-ed rather than
 * AND-ed.
 *
 * ── What that costs, stated plainly ──────────────────────────────────────
 * The phone half is fallible in the way it has always been: two unrelated
 * guardians sharing one handset are read as one family. The CNIC half is not
 * fallible in that way, which is the point of moving to it — but it only helps
 * where the number has actually been collected. The direction of travel is
 * that CNIC coverage grows with every new admission, and the phone rule
 * quietly stops mattering.
 *
 * The failure is visible rather than silent everywhere it is used: the sibling
 * card names the children, and the family voucher prints them. A school that
 * sees a stranger's child on their voucher can see the reason.
 *
 * ── One student can front several families ───────────────────────────────
 * A child with a father and a mother recorded has two guardian rows, and a
 * half-sibling through one of them is not a sibling through the other. This
 * returns the **union**: everyone reachable through any of the student's
 * guardians. That is the right answer for "who else in this family is at this
 * school", which is the only question anything asks it.
 */

export interface SiblingRow {
  studentProfileId: string;
  /** The printed admission number, e.g. `GVS-2025-0007`. */
  studentId: string;
  name: string;
  photoUrl: string | null;
  /** Null when the sibling has no placement in the active year. */
  gradeName: string | null;
  sectionName: string | null;
  /**
   * The campus this sibling attends, when they have a placement (Sprint 20,
   * item 8).
   *
   * Carried because **the sibling rule is school-wide and always was** — it
   * matches on `student_guardians.location_id` and joins no `branches` — so two
   * children at two campuses of one school already read as siblings and always
   * have. That is right, and it is invisible: a clerk at Defence looking at a
   * discount granted because of a child at Karachi sees a name with no class
   * beside it and no reason for the grant. Naming the campus is what turns a
   * correct answer into a legible one.
   */
  branchId: string | null;
  branchName: string | null;
  /** Which guardian they are shared through, for the "via" line. */
  sharedGuardianName: string;
  /** True when they are on the roll in the active academic year. */
  isCurrentlyEnrolled: boolean;
}

/** The keys one student's guardians are matched on. */
interface FamilyKeys {
  cnics: string[];
  phones: string[];
}

async function familyKeysFor(
  locationId: string,
  studentProfileId: string,
): Promise<FamilyKeys> {
  const rows = await db
    .select({ cnic: studentGuardians.cnic, phone: studentGuardians.phone })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.studentProfileId, studentProfileId),
      ),
    );

  const cnics = new Set<string>();
  const phones = new Set<string>();

  for (const row of rows) {
    // Normalised on the way out as well as on the way in. A row written before
    // migration 0026 that the migration could not canonicalise — a CNIC with
    // twelve digits, say — must not match another row's *literal* twelve
    // digits, so anything that is not a whole CNIC is dropped rather than
    // compared.
    const cnic = normalizeCnic(row.cnic);
    if (cnic !== null) cnics.add(cnic);
    if (row.phone !== '') phones.add(row.phone);
  }

  return { cnics: [...cnics], phones: [...phones] };
}

/**
 * Every other student at this school who shares a guardian with this one.
 *
 * Ordered by name, so a family reads the same way on every screen that shows
 * it. Returns `[]` — never null — for an only child, which is the common case
 * and is what lets every caller render the result unconditionally.
 */
export async function listSiblings(
  locationId: string,
  studentProfileId: string,
): Promise<SiblingRow[]> {
  const keys = await familyKeysFor(locationId, studentProfileId);
  return studentsMatching(locationId, keys, studentProfileId);
}

/**
 * The same list, for a guardian who is not on any student record yet.
 *
 * This is the admissions-application case: a family has applied, the applicant
 * gave a CNIC and a phone number on the public form, and the question in front
 * of whoever is reviewing it is "do we already teach this family?". There is no
 * student to start from — the child is not enrolled — so the keys come straight
 * from the application.
 *
 * It matters at exactly that moment. A sibling is why a school waives an
 * admission test, applies a sibling discount, or places a child in the campus
 * their brother already attends, and none of those decisions can be made after
 * the offer has gone out.
 */
export async function listStudentsForGuardianIdentity(
  locationId: string,
  identity: { cnic: string | null; phone: string | null },
): Promise<SiblingRow[]> {
  const cnic = normalizeCnic(identity.cnic);
  const phone = (identity.phone ?? '').trim();

  return studentsMatching(locationId, {
    cnics: cnic === null ? [] : [cnic],
    phones: phone === '' ? [] : [phone],
  });
}

/** The one query both entry points run. */
async function studentsMatching(
  locationId: string,
  { cnics, phones }: FamilyKeys,
  excludeStudentProfileId?: string,
): Promise<SiblingRow[]> {
  if (cnics.length === 0 && phones.length === 0) return [];

  const matchers = [
    ...(cnics.length > 0
      ? [and(isNotNull(studentGuardians.cnic), inArray(studentGuardians.cnic, cnics))]
      : []),
    ...(phones.length > 0 ? [inArray(studentGuardians.phone, phones)] : []),
  ];

  const yearId = await activeYearId(locationId);

  const rows = await db
    .selectDistinctOn([schoolUsers.name, studentProfiles.id], {
      studentProfileId: studentProfiles.id,
      studentId: studentProfiles.studentId,
      name: schoolUsers.name,
      photoUrl: studentProfiles.photoUrl,
      sharedGuardianName: studentGuardians.name,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
      branchId: grades.branchId,
      branchName: branches.name,
      enrollmentStatus: studentEnrollments.status,
    })
    .from(studentGuardians)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentGuardians.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    /*
     * The placement is a LEFT join through the active year, so a sibling who
     * has left — or who has been admitted and not yet placed — still appears,
     * with no class beside their name. Dropping them would be the wrong answer
     * to "who else in this family is here": an admin looking at a withdrawn
     * elder brother is looking at the reason the younger one's fee concession
     * exists.
     */
    .leftJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.studentProfileId, studentProfiles.id),
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.status, 'active'),
        ...(yearId === null ? [] : [eq(studentEnrollments.academicYearId, yearId)]),
      ),
    )
    .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .leftJoin(grades, eq(grades.id, sections.gradeId))
    /*
     * The campus, for display only — Sprint 20, item 8.
     *
     * ⚠ A LEFT JOIN and **never** a predicate. There is no branch condition
     * anywhere in this statement and none is ever coming: a family is a family
     * across campuses, and `resolveBranchScope` applied here would split one
     * into two on the day a school opened its second campus. `scripts/
     * check-branch-scope.ts` asserts that in so many words, because narrowing
     * this by campus is the natural mistake for the next scoping pass to make
     * and it is invisible — the sibling card simply empties, the family voucher
     * splits, and nothing reports an error.
     */
    .leftJoin(branches, eq(branches.id, grades.branchId))
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        ...(excludeStudentProfileId === undefined
          ? []
          : [ne(studentGuardians.studentProfileId, excludeStudentProfileId)]),
        or(...matchers),
      ),
    )
    .orderBy(asc(schoolUsers.name), asc(studentProfiles.id));

  return rows.map((row) => ({
    studentProfileId: row.studentProfileId,
    studentId: row.studentId,
    name: row.name,
    photoUrl: row.photoUrl,
    gradeName:
      row.gradeName === null
        ? null
        : gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
    sectionName: row.sectionName,
    branchId: row.branchId,
    branchName: row.branchName,
    sharedGuardianName: row.sharedGuardianName,
    isCurrentlyEnrolled: row.enrollmentStatus === 'active',
  }));
}

/**
 * What one CNIC already means at this school, for the enrollment form.
 *
 * ── Why the guardian's own details come back too ─────────────────────────
 * The second child of an existing parent is the case this whole feature is
 * about, and the clerk admitting them has the same father in front of them
 * that the school already holds a record of. Re-typing his name, number and
 * occupation is three chances to spell them differently — and a differently
 * spelled *phone number* is what would have split the family in two under the
 * old rule. So the form fills itself in from the existing row and the clerk
 * confirms rather than transcribes.
 *
 * The most recently recorded row wins where a guardian's details differ
 * between their children: it is the one the school corrected last.
 */
export interface GuardianLookupResult {
  /** Null when this CNIC is not on any guardian record at this school. */
  guardian: {
    name: string;
    phone: string;
    email: string | null;
    occupation: string | null;
    /**
     * How this person is related to the child they were most recently recorded
     * against.
     *
     * The enrollment card adopts it when the relationship is still free for the
     * student being admitted. A mother enrolling her second child was being
     * offered Father — the form's default for the first guardian — and the
     * clerk who did not change it created a second father and split the family
     * that the CNIC lookup had just successfully recognised.
     */
    relationship: GuardianRelationship;
    /** True when a parent portal login already exists on this number. */
    hasPortalAccount: boolean;
  } | null;
  /** Students already recorded against this CNIC. */
  students: {
    studentProfileId: string;
    studentId: string;
    name: string;
    gradeName: string | null;
    sectionName: string | null;
    /** How this guardian is related to that child. */
    relationship: string;
  }[];
}

export async function lookupGuardianByCnic(
  locationId: string,
  rawCnic: string,
): Promise<GuardianLookupResult> {
  const cnic = normalizeCnic(rawCnic);
  if (cnic === null) return { guardian: null, students: [] };

  const rows = await db
    .select({
      guardianName: studentGuardians.name,
      phone: studentGuardians.phone,
      email: studentGuardians.email,
      occupation: studentGuardians.occupation,
      relationship: studentGuardians.relationship,
      schoolUserId: studentGuardians.schoolUserId,
      createdAt: studentGuardians.createdAt,
      studentProfileId: studentProfiles.id,
      studentId: studentProfiles.studentId,
      studentName: schoolUsers.name,
      gradeName: grades.name,
      gradeDisplayName: grades.displayName,
      sectionName: sections.name,
    })
    .from(studentGuardians)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentGuardians.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .leftJoin(
      studentEnrollments,
      and(
        eq(studentEnrollments.studentProfileId, studentProfiles.id),
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .leftJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(eq(studentGuardians.locationId, locationId), eq(studentGuardians.cnic, cnic)),
    )
    .orderBy(desc(studentGuardians.createdAt));

  const newest = rows[0];
  if (newest === undefined) return { guardian: null, students: [] };

  const seen = new Set<string>();
  const students: GuardianLookupResult['students'] = [];

  for (const row of rows) {
    if (seen.has(row.studentProfileId)) continue;
    seen.add(row.studentProfileId);

    students.push({
      studentProfileId: row.studentProfileId,
      studentId: row.studentId,
      name: row.studentName,
      gradeName:
        row.gradeName === null
          ? null
          : gradeLabel({ name: row.gradeName, displayName: row.gradeDisplayName }),
      sectionName: row.sectionName,
      relationship: row.relationship,
    });
  }

  students.sort((left, right) => left.name.localeCompare(right.name));

  return {
    guardian: {
      name: newest.guardianName,
      phone: newest.phone,
      email: newest.email,
      occupation: newest.occupation,
      relationship: newest.relationship,
      hasPortalAccount: rows.some((row) => row.schoolUserId !== null),
    },
    students,
  };
}

/**
 * The children one **portal account** may see, for the parent portal header.
 *
 * Deliberately not the sibling rule above. A parent's portal is scoped by
 * `student_guardians.school_user_id` — the link written when their account was
 * opened — and nothing else, because that link is the authorisation boundary.
 * Widening it to "anyone sharing my phone number" would let a household member
 * read a child they were never recorded against, which is a different and much
 * worse mistake than a family voucher grouping two families together.
 *
 * `listChildrenForGuardian` in `lib/admissions-queries.ts` is the same query
 * with the enrollment attached; this is the cheap version the header needs on
 * every request.
 */
export async function listPortalChildren(
  locationId: string,
  schoolUserId: string,
): Promise<{ studentProfileId: string; studentId: string; name: string }[]> {
  return db
    .selectDistinctOn([schoolUsers.name, studentProfiles.id], {
      studentProfileId: studentProfiles.id,
      studentId: studentProfiles.studentId,
      name: schoolUsers.name,
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
    .orderBy(asc(schoolUsers.name), asc(studentProfiles.id));
}
