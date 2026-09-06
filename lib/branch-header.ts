import 'server-only';

import { and, asc, eq } from 'drizzle-orm';
import { cache } from 'react';

import { branches } from '@/db/schema/branches';
import { grades } from '@/db/schema/grades';
import { sections } from '@/db/schema/sections';
import { studentEnrollments } from '@/db/schema/student-enrollments';
import { studentGuardians } from '@/db/schema/student-guardians';
import { studentProfiles } from '@/db/schema/student-profiles';
import type { UserRole } from '@/types/school-auth';

import { db } from './drizzle';

/**
 * Which campus the person reading this page belongs to, for the header.
 *
 * ── The question a header has to answer at a group ───────────────────────
 * Lahore Grammar runs Defence and Karachi. Every screen in both portals said
 * "Lahore Grammar School" and nothing else, so a teacher, a parent and a head
 * all read a page whose numbers are their campus's under a title that claims
 * the whole school — and the only way to find out which campus you were
 * looking at was to recognise the data.
 *
 * ── Two rules, and both are deliberate ───────────────────────────────────
 * **Nothing is shown at a school with one campus.** A single-campus school has
 * no ambiguity to resolve, and a label that never varies is furniture.
 *
 * **Nothing is shown to a school administrator.** Their scope *is* the school:
 * `branch_id` is null on their record, they read across every campus, and
 * naming one of them in the chrome would be false. This is the "except School
 * Admin" in the requirement, and it falls out of the data rather than being a
 * special case — an unscoped account has no campus to name.
 *
 * ── Where the campus comes from, per portal ──────────────────────────────
 * Staff carry `school_users.branch_id`. A pupil and a parent do not — nothing
 * on the enrolment path writes it — so theirs is derived from the enrolment
 * that decides everything else about them: section → grade → branch. A parent
 * whose children are at two campuses gets no label, for the same reason the
 * administrator does not: there is no one true answer, and a header that picks
 * one is a header that lies on every other page.
 */

/** The school's active campuses, cached per request. */
const activeBranches = cache(
  async (locationId: string): Promise<{ id: string; name: string }[]> =>
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(and(eq(branches.locationId, locationId), eq(branches.isActive, true)))
      .orderBy(asc(branches.name)),
);

/** The campus of the one child, or of children who all sit at the same one. */
async function branchOfChildren(
  locationId: string,
  parentSchoolUserId: string,
): Promise<string | null> {
  const rows = await db
    .selectDistinct({ branchId: grades.branchId })
    .from(studentGuardians)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentGuardians.studentProfileId))
    .innerJoin(
      studentEnrollments,
      eq(studentEnrollments.studentProfileId, studentProfiles.id),
    )
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.schoolUserId, parentSchoolUserId),
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.status, 'active'),
      ),
    );

  return rows.length === 1 ? (rows[0]?.branchId ?? null) : null;
}

/** The campus a pupil is enrolled at. */
async function branchOfPupil(
  locationId: string,
  studentSchoolUserId: string,
): Promise<string | null> {
  const rows = await db
    .selectDistinct({ branchId: grades.branchId })
    .from(studentProfiles)
    .innerJoin(
      studentEnrollments,
      eq(studentEnrollments.studentProfileId, studentProfiles.id),
    )
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(
        eq(studentProfiles.locationId, locationId),
        eq(studentProfiles.schoolUserId, studentSchoolUserId),
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.status, 'active'),
      ),
    );

  return rows.length === 1 ? (rows[0]?.branchId ?? null) : null;
}

export interface HeaderBranchInput {
  locationId: string;
  role: UserRole;
  /** The reader's `school_users.id`. Null while their record cannot be read. */
  schoolUserId: string | null;
  /** `school_users.branch_id` — null means school-wide. */
  branchId: string | null;
}

/**
 * The campus label for the portal header, or null when there is nothing
 * truthful to show.
 *
 * Never throws: a header is not worth a portal nobody can open, which is the
 * posture the two unread counts beside it already take in every layout.
 */
export async function headerBranchName(
  input: HeaderBranchInput,
): Promise<string | null> {
  try {
    const campuses = await activeBranches(input.locationId);
    if (campuses.length < 2) return null;
    if (input.role === 'school_admin') return null;

    let branchId = input.branchId;

    if (branchId === null && input.schoolUserId !== null) {
      if (input.role === 'parent') {
        branchId = await branchOfChildren(input.locationId, input.schoolUserId);
      } else if (input.role === 'student') {
        branchId = await branchOfPupil(input.locationId, input.schoolUserId);
      }
    }

    if (branchId === null) return null;

    return campuses.find((campus) => campus.id === branchId)?.name ?? null;
  } catch (error) {
    console.error('[layout] the header campus could not be read:', error);
    return null;
  }
}
