import 'server-only';

import { and, eq } from 'drizzle-orm';

import { grantRankFor, type GrantScopeType } from '@/db/schema/chat-grants';
import { grades } from '@/db/schema/grades';
import { sections } from '@/db/schema/sections';
import { studentEnrollments } from '@/db/schema/student-enrollments';
import { studentProfiles } from '@/db/schema/student-profiles';
import type { SchoolAuthContext } from '@/lib/api-auth';

import { getActiveAcademicYear } from './admissions-queries';
import { listTeacherSections } from './academics-queries';
import { db } from './drizzle';

/**
 * Whether somebody may write a grant over this scope — the room, not the door.
 *
 * `chat.grant` says a person may open and close chat. It does not say *whose*
 * chat, and a permission cannot: the answer depends on the timetable. A teacher
 * holding `chat.grant` must be able to open 7-B because she teaches 7-B, and
 * must not be able to open 9-C because she does not — and both facts change
 * every time the timetable does.
 *
 * So this re-derives the answer from `listTeacherSections`, which
 * `lib/academics-queries.ts` already calls the teacher portal's authorisation
 * list rather than a convenience. A section id in a request body is untrusted
 * however the screen obtained it.
 *
 * ── Banning a person is not a teacher's decision ─────────────────────────
 * A `deny` over a `school_user` — the shape a parent ban takes — needs rank 60,
 * which is a vice principal and up. A teacher in the middle of an argument with
 * a parent is the last person who should be able to end it unilaterally, and
 * making her escalate is the point rather than a limitation. She can still
 * close her own class opening, which is what she actually needs.
 */

/** The rank required to ban a named person from chat. Vice principal and up. */
const RANK_TO_BAN_A_PERSON = 60;

/** Roles whose reach is the whole school rather than their own timetable. */
const SCHOOL_WIDE_ROLES: readonly string[] = [
  'school_admin',
  'branch_admin',
  'principal',
  'vice_principal',
];

export async function grantScopeProblem(
  auth: SchoolAuthContext,
  schoolUserId: string,
  scopeType: GrantScopeType,
  scopeId: string,
): Promise<string | null> {
  const rank = grantRankFor(auth.role);

  if (scopeType === 'school_user' && rank < RANK_TO_BAN_A_PERSON) {
    return 'Only a vice principal or above can turn chat off for a named person. Ask a head to do it.';
  }

  if (SCHOOL_WIDE_ROLES.includes(auth.role)) {
    // A branch-bound administrator is narrowed by the scope's own campus rather
    // than by their role. Anything school-wide is theirs.
    return auth.branchId === null
      ? null
      : branchProblem(auth.locationId, auth.branchId, scopeType, scopeId);
  }

  // Everyone else — teacher, coordinator — grants over what they teach.
  const year = await getActiveAcademicYear(auth.locationId);
  if (year === null) {
    return 'There is no active academic year, so there are no classes to open.';
  }

  const mine = await listTeacherSections(auth.locationId, schoolUserId, year.id);
  const mySectionIds = new Set(mine.map((section) => section.sectionId));

  if (mySectionIds.size === 0) {
    return 'You do not teach any classes this year, so there is nothing to open.';
  }

  if (scopeType === 'section') {
    return mySectionIds.has(scopeId) ? null : 'You can only open chat for a class you teach.';
  }

  if (scopeType === 'student') {
    const rows = await db
      .select({ sectionId: studentEnrollments.sectionId })
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.locationId, auth.locationId),
          eq(studentEnrollments.studentProfileId, scopeId),
          eq(studentEnrollments.academicYearId, year.id),
          eq(studentEnrollments.status, 'active'),
        ),
      );

    const shared = rows.some((row) => mySectionIds.has(row.sectionId));
    return shared ? null : 'You can only open chat for a pupil you teach.';
  }

  return 'You can open chat for your own classes and pupils. A grade or a campus needs a head.';
}

/** Whether a scope sits inside one campus, for a branch-bound administrator. */
async function branchProblem(
  locationId: string,
  branchId: string,
  scopeType: GrantScopeType,
  scopeId: string,
): Promise<string | null> {
  const elsewhere = 'That belongs to another campus.';

  if (scopeType === 'branch') {
    return scopeId === branchId ? null : elsewhere;
  }

  if (scopeType === 'grade') {
    const rows = await db
      .select({ branchId: grades.branchId })
      .from(grades)
      .where(and(eq(grades.locationId, locationId), eq(grades.id, scopeId)))
      .limit(1);

    return rows[0]?.branchId === branchId ? null : elsewhere;
  }

  if (scopeType === 'section') {
    const rows = await db
      .select({ branchId: grades.branchId })
      .from(sections)
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .where(and(eq(sections.locationId, locationId), eq(sections.id, scopeId)))
      .limit(1);

    return rows[0]?.branchId === branchId ? null : elsewhere;
  }

  if (scopeType === 'student') {
    const rows = await db
      .select({ branchId: grades.branchId })
      .from(studentEnrollments)
      .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .where(
        and(
          eq(studentEnrollments.locationId, locationId),
          eq(studentEnrollments.studentProfileId, scopeId),
          eq(studentEnrollments.status, 'active'),
        ),
      )
      .limit(1);

    return rows[0]?.branchId === branchId ? null : elsewhere;
  }

  // `school_user` — a member of staff or a parent, who may span campuses. A
  // parent with children at two campuses is one person and one ban.
  return null;
}

/** Resolves a pupil's `student_profiles.id` from their sign-in account. */
export async function studentProfileForUser(
  locationId: string,
  schoolUserId: string,
): Promise<string | null> {
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

  return rows[0]?.id ?? null;
}
