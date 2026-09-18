import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { cache } from 'react';

import {
  chatConversations,
  DESK_FALLBACK_ROLE,
  isRoleInboxKey,
  type RoleInboxKey,
  ROLE_INBOX_KEYS,
  ROLE_INBOXES,
  roleInboxLabel,
} from '@/db/schema/chat-conversations';
import { chatAttachments } from '@/db/schema/chat-attachments';
import { chatGrants, grantRankFor } from '@/db/schema/chat-grants';
import { chatMessages } from '@/db/schema/chat-messages';
import { chatParticipants } from '@/db/schema/chat-participants';
import {
  CHAT_SCHOOL_DEFAULTS,
  chatSchoolSettings,
  type ChatSchoolSettingsRow,
} from '@/db/schema/chat-school-settings';
import { chatSettings } from '@/db/schema/chat-settings';
import { chatSignals } from '@/db/schema/chat-signals';
import { branches } from '@/db/schema/branches';
import { grades } from '@/db/schema/grades';
import { schoolUsers } from '@/db/schema/school-users';
import { sections } from '@/db/schema/sections';
import { staff } from '@/db/schema/staff';
import { studentEnrollments } from '@/db/schema/student-enrollments';
import { studentGuardians } from '@/db/schema/student-guardians';
import { studentProfiles } from '@/db/schema/student-profiles';
import { timetableEntries } from '@/db/schema/timetable-entries';
import type { UserRole } from '@/types/school-auth';

import { getActiveAcademicYear } from './admissions-queries';
import {
  contactWindowProblem,
  type GrantLike,
  resolveGrant,
  type ScopeKey,
  turnTakingProblem,
} from './chat-permissions';
import { desksWithAnswerers } from './chat-desks';
import { markChatNotificationsRead, notifyChatRecipients } from './chat-notifications';
import { batch, db } from './drizzle';
import { liveTimetableEntries } from './timetable-history';

/**
 * The database half of the chat permission model.
 *
 * `lib/chat-permissions.ts` holds the rules and is importable by the browser;
 * this file derives the facts those rules are applied to and never leaves the
 * server. The split is the one `lib/permissions.ts` and
 * `lib/permission-queries.ts` already use, and for the same reason: the button
 * the client draws and the answer the server gives have to come from one set of
 * rules.
 *
 * ── The reachability table, in one place ─────────────────────────────────
 *
 *   Staff    any active member of staff at the school
 *   Staff    any parent; any pupil, inside the school's contact hours
 *   Parent   the teachers of their own children, plus the role inboxes
 *   Pupil    replies only — unless a live grant allows it *and* the teacher
 *            has opted in
 *
 * Two rows are missing and their absence is the design: pupil-to-pupil and
 * parent-to-parent. They are not refused here, because a refusal here can be
 * bypassed by the next route that forgets to ask. They are refused by two
 * partial unique indexes on `chat_participants` — see that table's docblock.
 */

/* ------------------------------------------------------------------------
 * Settings
 * --------------------------------------------------------------------- */

export type ChatSchoolSettings = Omit<
  ChatSchoolSettingsRow,
  'id' | 'locationId' | 'createdAt' | 'updatedAt'
>;

/**
 * A school's chat dials. An absent row is the defaults, exactly as
 * `notification_preferences` behaves, so provisioning seeds nothing.
 *
 * `cache()`d per request: the send path, the reachable list and the thread
 * header all want it, and it changes about twice a year.
 */
export const getChatSchoolSettings = cache(
  async (locationId: string): Promise<ChatSchoolSettings> => {
    const rows = await db
      .select()
      .from(chatSchoolSettings)
      .where(eq(chatSchoolSettings.locationId, locationId))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return { ...CHAT_SCHOOL_DEFAULTS };

    return {
      studentLoginMinGradeSortOrder: row.studentLoginMinGradeSortOrder,
      replyWindowMinutes: row.replyWindowMinutes,
      maxUnansweredFromStudent: row.maxUnansweredFromStudent,
      maxOpenThreadsPerStudent: row.maxOpenThreadsPerStudent,
      studentContactFrom: row.studentContactFrom,
      studentContactTo: row.studentContactTo,
      allowContactWindowOverride: row.allowContactWindowOverride,
      safeguardingLeadEmail: row.safeguardingLeadEmail,
      retentionMonths: row.retentionMonths,
    };
  },
);

/** Whether this person accepts pupil-initiated threads. Default false. */
export async function studentsMayInitiateWith(
  locationId: string,
  schoolUserId: string,
): Promise<boolean> {
  const rows = await db
    .select({ allowed: chatSettings.studentsMayInitiate })
    .from(chatSettings)
    .where(
      and(
        eq(chatSettings.locationId, locationId),
        eq(chatSettings.schoolUserId, schoolUserId),
      ),
    )
    .limit(1);

  return rows[0]?.allowed ?? false;
}

/* ------------------------------------------------------------------------
 * Scopes
 * --------------------------------------------------------------------- */

/**
 * Every scope a person falls inside, for grant resolution.
 *
 * A pupil is in five: their own account, their student profile, their section,
 * their grade and their campus. Everybody else is in two. The list is what
 * `resolveGrant` matches grants against, and its order does not matter —
 * specificity is decided by `SCOPE_SPECIFICITY`, not by position.
 */
export async function scopesFor(
  locationId: string,
  schoolUserId: string,
): Promise<ScopeKey[]> {
  const scopes: ScopeKey[] = [{ type: 'school_user', id: schoolUserId }];

  const rows = await db
    .select({
      studentProfileId: studentProfiles.id,
      sectionId: studentEnrollments.sectionId,
      gradeId: sections.gradeId,
      // The campus hangs off the grade, not the section — see `grades`.
      branchId: grades.branchId,
    })
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
        eq(studentProfiles.schoolUserId, schoolUserId),
        eq(studentEnrollments.status, 'active'),
      ),
    );

  for (const row of rows) {
    scopes.push({ type: 'student', id: row.studentProfileId });
    scopes.push({ type: 'section', id: row.sectionId });
    scopes.push({ type: 'grade', id: row.gradeId });
    if (row.branchId !== null) scopes.push({ type: 'branch', id: row.branchId });
  }

  return scopes;
}

/** The live grants touching any of these scopes. */
export async function liveGrantsFor(
  locationId: string,
  scopes: readonly ScopeKey[],
): Promise<GrantLike[]> {
  if (scopes.length === 0) return [];

  const now = new Date();

  const rows = await db
    .select({
      scopeType: chatGrants.scopeType,
      scopeId: chatGrants.scopeId,
      effect: chatGrants.effect,
      grantedByRank: chatGrants.grantedByRank,
      startsAt: chatGrants.startsAt,
      endsAt: chatGrants.endsAt,
      revokedAt: chatGrants.revokedAt,
      reason: chatGrants.reason,
    })
    .from(chatGrants)
    .where(
      and(
        eq(chatGrants.locationId, locationId),
        isNull(chatGrants.revokedAt),
        inArray(
          chatGrants.scopeId,
          scopes.map((scope) => scope.id),
        ),
        // `lte` and `gt`, never `` sql`${column} <= ${value}` ``. CLAUDE.md's
        // rule about a raw template handing a Date straight to postgres-js is
        // what kept every scheduled announcement on the platform from ever
        // being released, silently, from Sprint 11 until 2026-08-20.
        lte(chatGrants.startsAt, now),
        or(isNull(chatGrants.endsAt), gt(chatGrants.endsAt, now)),
      ),
    );

  return rows as GrantLike[];
}

/* ------------------------------------------------------------------------
 * Reachability
 * --------------------------------------------------------------------- */

export interface ReachableTarget {
  /** A person, or a desk. */
  kind: 'person' | 'inbox';
  /** `school_users.id` for a person, the inbox key for a desk. */
  id: string;
  name: string;
  /** What they are to this actor: "Maths teacher", "Accounts Office". */
  detail: string;
  /**
   * The role chips group by this. Sprint 33c, C3.
   *
   * **Null for a desk**, and the type says so rather than inventing one. The
   * Accounts Office is not a role and is not held by one — `desksWithAnswerers`
   * resolves who actually answers it, and at a small school that is the school
   * administrator. Labelling it `accountant` would be a guess printed as a
   * fact, on a chip somebody then filters by.
   */
  role: UserRole | null;
  /**
   * The campus, where the target has one. Null is not "unknown": on
   * `school_users` it has meant *the whole school* since Sprint 19a, and a desk
   * that serves every campus carries it for the same reason.
   */
  branchName: string | null;
}

const STAFF_ROLES: readonly UserRole[] = [
  'school_admin',
  'branch_admin',
  'principal',
  'vice_principal',
  // Sprint 33b. A Section Head is staff, and this list is what decides who may
  // be seated with whom — a role missing from it is a colleague the school
  // cannot start a conversation with, which reads as chat being broken.
  'section_head',
  'coordinator',
  'teacher',
  'accountant',
  'hr_manager',
  'marketing',
];

function isStaffRole(role: UserRole): boolean {
  return STAFF_ROLES.includes(role);
}

/**
 * The one campus a parent's children sit at, or null.
 *
 * Null means "every campus", and it is returned for both of the cases that
 * deserve it: a parent with no enrolled child yet, and a parent whose children
 * are at two campuses. Neither can be answered by one branch's office, so
 * neither is scoped to one — `servesBranch` in `lib/chat-desks.ts` reads null
 * on either side as "all", which is the same convention `branch_id` has carried
 * on `school_users` since Sprint 19a.
 */
export async function branchOfParent(
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

/**
 * The teachers of one parent's children, plus their class teachers.
 *
 * Two id spaces meet here and conflating them is the defect
 * `lib/staff-portal-access.ts` warns about at length:
 * `timetable_entries.teacher_id` is a **`school_users.id`**, while
 * `sections.class_teacher_id` is a **`staff.id`**. The second is bridged back
 * through `staff.school_user_id`, because a chat participant is always a
 * `school_users` row.
 *
 * ── Sprint 30: the role is part of the test, not only the timetable ───────
 * Both halves now require `school_users.role = 'teacher'`.
 *
 * The timetable was already the gate — a teacher who stops teaching a section
 * stops being reachable by that section's parents the moment the grid says so
 * — but it gates on *who is in the grid*, and `timetable_entries.teacher_id`
 * is any `school_users` row. At Lahore Grammar the school administrator was
 * against a period of Pre-Nursery A, so a parent's dropdown offered
 * `Sumera Hasnain — Teaches Pre-Nursery A`: the administrator's personal
 * inbox, presented as the child's teacher, beside four desks that exist so
 * that administrative questions do not go to a person by name.
 *
 * The class-teacher half carries the same filter, for the same reason and one
 * more: a section whose class teacher is an administrator is a real
 * arrangement at a small school, and the parent's route to them is still the
 * office desk.
 *
 * ⚠ **Exported only so that `scripts/check-sprint33c.ts` can execute it.**
 * `resolveReachable` is the caller and should remain the only one. This and
 * `teachersOfStudent`, `studentContextFor` and `childrenOfParents` are all
 * unreachable from `resolveReachable` on a tenant that owns no row — there is
 * no active year and there are no ids, so it returns before it gets here — and
 * CLAUDE.md is explicit that a statement which has been read and not run is
 * evidence about spelling and nothing else. Exporting them is what turns that
 * gate from a claim into a fact.
 */
export async function teachersOfChildren(
  locationId: string,
  parentSchoolUserId: string,
  academicYearId: string,
): Promise<ReachableTarget[]> {
  const subjectTeachers = await db
    .selectDistinct({
      schoolUserId: schoolUsers.id,
      name: schoolUsers.name,
      gradeName: grades.name,
      sectionName: sections.name,
    })
    .from(studentGuardians)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentGuardians.studentProfileId))
    .innerJoin(
      studentEnrollments,
      eq(studentEnrollments.studentProfileId, studentProfiles.id),
    )
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(
      timetableEntries,
      and(
        eq(timetableEntries.sectionId, sections.id),
        eq(timetableEntries.academicYearId, academicYearId),
        eq(timetableEntries.isActive, true),
        // Sprint 33c: the version in force today. `lib/timetable-history.ts`.
        liveTimetableEntries(),
      ),
    )
    .innerJoin(schoolUsers, eq(schoolUsers.id, timetableEntries.teacherId))
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.schoolUserId, parentSchoolUserId),
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.status, 'active'),
        eq(studentEnrollments.academicYearId, academicYearId),
        eq(schoolUsers.isActive, true),
        eq(schoolUsers.role, 'teacher'),
      ),
    );

  const classTeachers = await db
    .selectDistinct({
      schoolUserId: staff.schoolUserId,
      name: schoolUsers.name,
      gradeName: grades.name,
      sectionName: sections.name,
    })
    .from(studentGuardians)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentGuardians.studentProfileId))
    .innerJoin(
      studentEnrollments,
      eq(studentEnrollments.studentProfileId, studentProfiles.id),
    )
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(staff, eq(staff.id, sections.classTeacherId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, staff.schoolUserId))
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.schoolUserId, parentSchoolUserId),
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.status, 'active'),
        eq(studentEnrollments.academicYearId, academicYearId),
        eq(schoolUsers.isActive, true),
        eq(schoolUsers.role, 'teacher'),
      ),
    );

  const byId = new Map<string, ReachableTarget>();

  for (const row of subjectTeachers) {
    byId.set(row.schoolUserId, {
      kind: 'person',
      id: row.schoolUserId,
      name: row.name,
      // Sprint 33c. Both halves of this list are already filtered to
      // `role = 'teacher'`, so the chip is a fact rather than an assumption.
      role: 'teacher',
      branchName: null,
      detail: `Teaches ${row.gradeName} ${row.sectionName}`,
    });
  }

  for (const row of classTeachers) {
    if (row.schoolUserId === null) continue;
    byId.set(row.schoolUserId, {
      kind: 'person',
      id: row.schoolUserId,
      name: row.name,
      role: 'teacher',
      branchName: null,
      detail: `Class teacher, ${row.gradeName} ${row.sectionName}`,
    });
  }

  return withBranchNames(
    locationId,
    [...byId.values()].sort((left, right) => left.name.localeCompare(right.name)),
  );
}

/**
 * The campus each of these people belongs to, filled in on a resolved list.
 *
 * Sprint 33c. A separate read rather than a `leftJoin` added to the four
 * reachability statements above, and that is deliberate: three of them are
 * `selectDistinct` over five and six joined tables, and the way to break one is
 * to add a column to its DISTINCT. This is a single indexed read keyed on ids
 * already in hand, and it cannot change what the list contains — only what each
 * row says about itself.
 *
 * Null stays null and means *the whole school*, which is what `branch_id` has
 * meant on `school_users` since Sprint 19a.
 */
async function withBranchNames(
  locationId: string,
  targets: ReachableTarget[],
): Promise<ReachableTarget[]> {
  const ids = targets.filter((row) => row.kind === 'person').map((row) => row.id);
  if (ids.length === 0) return targets;

  const rows = await db
    .select({ id: schoolUsers.id, branchName: branches.name })
    .from(schoolUsers)
    .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
    .where(and(eq(schoolUsers.locationId, locationId), inArray(schoolUsers.id, ids)));

  const byId = new Map(rows.map((row) => [row.id, row.branchName]));

  return targets.map((target) =>
    target.kind === 'person'
      ? { ...target, branchName: byId.get(target.id) ?? null }
      : target,
  );
}

/** The teachers who actually teach this pupil, this year. */
export async function teachersOfStudent(
  locationId: string,
  studentSchoolUserId: string,
  academicYearId: string,
): Promise<ReachableTarget[]> {
  const rows = await db
    .selectDistinct({
      schoolUserId: schoolUsers.id,
      name: schoolUsers.name,
      role: schoolUsers.role,
    })
    .from(studentProfiles)
    .innerJoin(
      studentEnrollments,
      eq(studentEnrollments.studentProfileId, studentProfiles.id),
    )
    .innerJoin(
      timetableEntries,
      and(
        eq(timetableEntries.sectionId, studentEnrollments.sectionId),
        eq(timetableEntries.academicYearId, academicYearId),
        eq(timetableEntries.isActive, true),
        // Sprint 33c: the version in force today. `lib/timetable-history.ts`.
        liveTimetableEntries(),
      ),
    )
    .innerJoin(schoolUsers, eq(schoolUsers.id, timetableEntries.teacherId))
    .where(
      and(
        eq(studentProfiles.locationId, locationId),
        eq(studentProfiles.schoolUserId, studentSchoolUserId),
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.status, 'active'),
        eq(studentEnrollments.academicYearId, academicYearId),
        eq(schoolUsers.isActive, true),
      ),
    )
    .orderBy(asc(schoolUsers.name));

  /*
   * ⚠ This half does **not** filter on `role = 'teacher'`, and it never has —
   * only the parent's two halves do (Sprint 30). Changing that here would
   * quietly take away a pupil's route to somebody they are timetabled with, so
   * the chip reports what the row actually is rather than asserting `teacher`
   * the way the parent's list can.
   */
  return withBranchNames(
    locationId,
    rows.map((row) => ({
      kind: 'person' as const,
      id: row.schoolUserId,
      name: row.name,
      role: row.role as UserRole,
      branchName: null,
      detail: 'Your teacher',
    })),
  );
}

/**
 * *Parent's name · Class with section*, for each pupil account. Sprint 33c.
 *
 * Two reads rather than one statement with an aggregate, and that is the safer
 * trade here: an ordered aggregate over `student_guardians.name` inside a
 * statement that also joins `school_users.name` is precisely the shape
 * CLAUDE.md records taking the all-students screen down with a 42702, twice.
 * Both of these are small, indexed and folded in JavaScript.
 *
 * The **primary** contact is preferred and the first guardian is the fallback,
 * because `is_primary_contact` is a flag a school may never have set. A pupil
 * with no guardian on file gets the class alone; a pupil with neither falls
 * back to the word "student", which is what this column said before.
 */
export async function studentContextFor(
  locationId: string,
  studentUserIds: readonly string[],
): Promise<Map<string, string>> {
  if (studentUserIds.length === 0) return new Map();

  const ids = [...studentUserIds];

  const [classes, guardians] = await Promise.all([
    db
      .select({
        studentUserId: studentProfiles.schoolUserId,
        gradeName: grades.name,
        sectionName: sections.name,
      })
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
          inArray(studentProfiles.schoolUserId, ids),
          eq(studentEnrollments.locationId, locationId),
          eq(studentEnrollments.status, 'active'),
        ),
      ),
    db
      .select({
        studentUserId: studentProfiles.schoolUserId,
        guardianName: studentGuardians.name,
        isPrimaryContact: studentGuardians.isPrimaryContact,
      })
      .from(studentGuardians)
      .innerJoin(studentProfiles, eq(studentProfiles.id, studentGuardians.studentProfileId))
      .where(
        and(
          eq(studentGuardians.locationId, locationId),
          inArray(studentProfiles.schoolUserId, ids),
        ),
      ),
  ]);

  const classBy = new Map<string, string>();
  for (const row of classes) {
    if (row.studentUserId === null) continue;
    classBy.set(row.studentUserId, `${row.gradeName} ${row.sectionName}`);
  }

  const guardianBy = new Map<string, { name: string; primary: boolean }>();
  for (const row of guardians) {
    if (row.studentUserId === null) continue;
    const held = guardianBy.get(row.studentUserId);
    if (held === undefined || (row.isPrimaryContact && !held.primary)) {
      guardianBy.set(row.studentUserId, {
        name: row.guardianName,
        primary: row.isPrimaryContact,
      });
    }
  }

  const answers = new Map<string, string>();
  for (const id of ids) {
    const parts = [guardianBy.get(id)?.name ?? null, classBy.get(id) ?? null].filter(
      (part): part is string => part !== null && part.trim() !== '',
    );
    if (parts.length > 0) answers.set(id, parts.join(' · '));
  }

  return answers;
}

/**
 * *Their children's names*, for each parent account. Sprint 33c.
 *
 * The student's name lives on `school_users`, not on `student_profiles` — the
 * profile carries the record and the account carries the name — so this joins
 * it once for the **child**, while the parent's id is read straight off
 * `student_guardians.school_user_id` and needs no join at all. One occurrence
 * of `school_users` in the statement, which is what keeps it free of the
 * ambiguous reference the docblock above is about.
 */
export async function childrenOfParents(
  locationId: string,
  parentUserIds: readonly string[],
): Promise<Map<string, string>> {
  if (parentUserIds.length === 0) return new Map();

  const rows = await db
    .select({
      parentUserId: studentGuardians.schoolUserId,
      childName: schoolUsers.name,
    })
    .from(studentGuardians)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentGuardians.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        inArray(studentGuardians.schoolUserId, [...parentUserIds]),
      ),
    )
    .orderBy(asc(schoolUsers.name));

  const byParent = new Map<string, string[]>();
  for (const row of rows) {
    if (row.parentUserId === null) continue;
    const held = byParent.get(row.parentUserId) ?? [];
    if (!held.includes(row.childName)) held.push(row.childName);
    byParent.set(row.parentUserId, held);
  }

  return new Map(
    [...byParent.entries()].map(([parentUserId, names]) => [
      parentUserId,
      // Three is where a line stops being a label and starts being a list.
      names.length > 3
        ? `${names.slice(0, 3).join(', ')} and ${String(names.length - 3)} more`
        : names.join(', '),
    ]),
  );
}

/**
 * Everybody this person may open a conversation with.
 *
 * The list is derived on every call rather than stored. A teacher who stops
 * teaching a section stops being reachable by that section's parents the moment
 * the timetable says so, which is the property that makes this safe to render
 * without a second authorization check — though `initiateProblem` runs one
 * anyway, because a target id in a request body is untrusted.
 */
export async function resolveReachable(
  locationId: string,
  actor: { schoolUserId: string; role: UserRole },
): Promise<ReachableTarget[]> {
  if (actor.role === 'student') {
    const year = await getActiveAcademicYear(locationId);
    if (year === null) return [];

    const scopes = await scopesFor(locationId, actor.schoolUserId);
    const decision = resolveGrant(await liveGrantsFor(locationId, scopes), scopes);
    if (!decision.allowed) return [];

    // A live grant is necessary and not sufficient: the teacher must also have
    // opted in. Filtering here means a pupil never sees a name that would
    // refuse them.
    const teachers = await teachersOfStudent(locationId, actor.schoolUserId, year.id);
    const opted = await Promise.all(
      teachers.map((teacher) => studentsMayInitiateWith(locationId, teacher.id)),
    );

    return teachers.filter((_, index) => opted[index] === true);
  }

  if (actor.role === 'parent') {
    const year = await getActiveAcademicYear(locationId);
    const teachers =
      year === null ? [] : await teachersOfChildren(locationId, actor.schoolUserId, year.id);

    /*
     * Sprint 30. Only the desks somebody can actually answer.
     *
     * All four used to be offered unconditionally, and three of them reached
     * nobody but the school admin at every school on the platform — see
     * `lib/chat-desks.ts`. A desk with no holder is now left off the list
     * rather than accepting an enquiry into an empty room, and the campus is
     * the parent's children's, so a Karachi parent's office enquiry is offered
     * only when Karachi has an office to answer it.
     */
    const branchId = await branchOfParent(locationId, actor.schoolUserId);
    const open = new Set(await desksWithAnswerers(locationId, branchId));

    const inboxes: ReachableTarget[] = ROLE_INBOXES.filter((inbox) =>
      open.has(inbox.key),
    ).map((inbox) => ({
      kind: 'inbox' as const,
      id: inbox.key,
      name: inbox.label,
      /*
       * A desk has **no role**, and the type says so rather than inventing one.
       * `desksWithAnswerers` has just resolved who actually answers each of
       * these, and at a small school that is the school administrator for all
       * four — so labelling the Accounts Office `accountant` would put a guess
       * on a chip that somebody then filters by. The picker groups them under
       * "School offices" instead, which is what they are.
       */
      role: null,
      branchName: null,
      detail: 'The school will answer',
    }));

    return [...inboxes, ...teachers];
  }

  if (!isStaffRole(actor.role)) return [];

  // Staff reach every active account at the school. `school_users` is the
  // school's own directory and a member of staff already has it on the users
  // screen; chat is not what makes it visible.
  const rows = await db
    .select({
      id: schoolUsers.id,
      name: schoolUsers.name,
      role: schoolUsers.role,
      branchName: branches.name,
    })
    .from(schoolUsers)
    .leftJoin(branches, eq(branches.id, schoolUsers.branchId))
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.isActive, true),
        ne(schoolUsers.id, actor.schoolUserId),
      ),
    )
    .orderBy(asc(schoolUsers.name));

  /*
   * Sprint 33c, C3. What a pupil and a parent actually are, on a staff list.
   *
   * `role.replace(/_/g, ' ')` is what this line said for four sprints, and on a
   * school's directory of six hundred accounts it produced two hundred rows
   * reading "student" and three hundred reading "parent" — which is not a
   * disambiguation, it is the same word repeated until the picker is useless.
   * A teacher looking for a child's father is looking for *the father of
   * Ayesha in 5 A*, and that is the sentence this now prints.
   *
   * Two supplementary reads, both keyed on ids already in hand and both skipped
   * when the list holds none of that kind — a school with no pupil accounts
   * pays nothing for this.
   */
  const studentIds = rows.filter((row) => row.role === 'student').map((row) => row.id);
  const parentIds = rows.filter((row) => row.role === 'parent').map((row) => row.id);

  const [studentContext, parentContext] = await Promise.all([
    studentContextFor(locationId, studentIds),
    childrenOfParents(locationId, parentIds),
  ]);

  return rows.map((row) => ({
    kind: 'person' as const,
    id: row.id,
    name: row.name,
    role: row.role as UserRole,
    branchName: row.branchName,
    detail:
      (row.role === 'student'
        ? (studentContext.get(row.id) ?? null)
        : row.role === 'parent'
          ? (parentContext.get(row.id) ?? null)
          : null) ?? row.role.replace(/_/g, ' '),
  }));
}

/* ------------------------------------------------------------------------
 * The refusals
 * --------------------------------------------------------------------- */

/** Whether a target is somebody this actor may open a thread with. */
export async function initiateProblem(
  locationId: string,
  actor: { schoolUserId: string; role: UserRole },
  target: { kind: 'person' | 'inbox'; id: string },
): Promise<string | null> {
  const reachable = await resolveReachable(locationId, actor);
  const found = reachable.some((entry) => entry.kind === target.kind && entry.id === target.id);

  if (!found) {
    return 'You cannot start a conversation with them.';
  }

  if (actor.role === 'student') {
    const settings = await getChatSchoolSettings(locationId);
    const open = await db
      .select({ total: count() })
      .from(chatParticipants)
      .innerJoin(
        chatConversations,
        eq(chatConversations.id, chatParticipants.conversationId),
      )
      .where(
        and(
          eq(chatParticipants.locationId, locationId),
          eq(chatParticipants.schoolUserId, actor.schoolUserId),
          eq(chatConversations.status, 'open'),
        ),
      );

    const total = open[0]?.total ?? 0;
    if (total >= settings.maxOpenThreadsPerStudent) {
      return `You already have ${String(total)} conversations open. Close one before starting another.`;
    }
  }

  // Staff writing to a pupil are held to the school's contact hours, and this
  // is checked before the thread exists rather than only on the message —
  // opening a thread a pupil is then notified about at midnight is the same
  // contact by another route.
  if (isStaffRole(actor.role) && target.kind === 'person') {
    const rows = await db
      .select({ role: schoolUsers.role })
      .from(schoolUsers)
      .where(and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.id, target.id)))
      .limit(1);

    if (rows[0]?.role === 'student') {
      const settings = await getChatSchoolSettings(locationId);
      return contactWindowProblem(
        new Date(),
        settings.studentContactFrom,
        settings.studentContactTo,
      );
    }
  }

  return null;
}

export interface SendContext {
  conversationStatus: string;
  canPost: boolean;
  isStudent: boolean;
  replyWindowExpiresAt: Date | null;
}

/**
 * Why this person may not post into this conversation, or null.
 *
 * Read as a single row joining the conversation to the caller's participant
 * seat, so a caller who is not a participant produces no row and is refused —
 * which is the membership check, not a separate one.
 */
export async function sendProblem(
  locationId: string,
  schoolUserId: string,
  conversationId: string,
): Promise<string | null> {
  const rows = await db
    .select({
      conversationStatus: chatConversations.status,
      canPost: chatParticipants.canPost,
      isStudent: chatParticipants.isStudent,
      replyWindowExpiresAt: chatParticipants.replyWindowExpiresAt,
    })
    .from(chatParticipants)
    .innerJoin(chatConversations, eq(chatConversations.id, chatParticipants.conversationId))
    .where(
      and(
        eq(chatParticipants.locationId, locationId),
        eq(chatParticipants.conversationId, conversationId),
        eq(chatParticipants.schoolUserId, schoolUserId),
        isNull(chatParticipants.leftAt),
      ),
    )
    .limit(1);

  const seat = rows[0];
  if (seat === undefined) return 'This conversation is not open to you.';

  if (seat.conversationStatus === 'frozen') {
    return 'This conversation has been closed and can no longer be replied to.';
  }

  if (!seat.canPost) {
    return 'You can read this conversation but not reply to it.';
  }

  if (!seat.isStudent) return null;

  const settings = await getChatSchoolSettings(locationId);

  const expiresAt = seat.replyWindowExpiresAt;
  if (expiresAt === null || expiresAt.getTime() <= Date.now()) {
    return 'The reply window has closed. You can reply again when a teacher writes back.';
  }

  // Turn-taking: how many of this pupil's messages sit after the last one
  // written by somebody else. Counting *since the last other sender* rather
  // than in a time window is what makes it unfloodable at any speed.
  const unanswered = await countUnansweredFrom(locationId, conversationId, schoolUserId);
  return turnTakingProblem(unanswered, settings.maxUnansweredFromStudent);
}

/** How many messages this person has sent since anybody else last wrote. */
export async function countUnansweredFrom(
  locationId: string,
  conversationId: string,
  schoolUserId: string,
): Promise<number> {
  const lastOther = await db
    .select({ createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.locationId, locationId),
        eq(chatMessages.conversationId, conversationId),
        or(
          isNull(chatMessages.senderSchoolUserId),
          ne(chatMessages.senderSchoolUserId, schoolUserId),
        ),
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);

  const since = lastOther[0]?.createdAt ?? null;

  const rows = await db
    .select({ total: count() })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.locationId, locationId),
        eq(chatMessages.conversationId, conversationId),
        eq(chatMessages.senderSchoolUserId, schoolUserId),
        since === null ? undefined : gt(chatMessages.createdAt, since),
      ),
    );

  return rows[0]?.total ?? 0;
}

/* ------------------------------------------------------------------------
 * Writes
 * --------------------------------------------------------------------- */

export interface PostedMessage {
  id: string;
  conversationId: string;
  createdAt: Date;
}

/** A file that arrives with the message. Already uploaded; only the row is left. */
export interface PostedAttachment {
  storagePath: string;
  fileName: string;
  contentType: string;
  size: number;
}

/**
 * Writes a message, moves the conversation's clock, files its attachment, rolls
 * every pupil's reply window, and fans out the signals — in **one transaction**,
 * signals last.
 *
 * All of it or none. A message whose `last_message_at` did not move is a
 * message that never reaches an inbox, and a signal written outside the
 * transaction is a notification for a message a rollback removed.
 *
 * ── Why the attachment moved in here (Sprint 33a) ────────────────────────
 * It used to be a second `db.insert(chatAttachments)` in the route, **after**
 * this function had already committed the message *and its signals*. The
 * recipient is woken by that signal and immediately fetches `/messages`, which
 * answers `{ messages, attachments }` — so a fetch landing in the gap between
 * the two commits returned the message with no file. That is precisely the
 * product owner's report: *"it did not go the first time, and it went the next
 * time"*, because the next fetch saw the row.
 *
 * The upload to object storage still happens before this is called, and stays
 * outside the transaction. An orphaned object is invisible and harmless; a
 * message without its file is neither.
 *
 * ── The id is generated here, and that is what makes one batch possible ──
 * `batch()` builds every statement *before* any of them runs, so a statement
 * that needs the message id cannot wait for the insert to return it. Minting
 * the uuid in JavaScript — the same v4 the column's `defaultRandom()` would
 * have produced — lets the attachment row and the signal rows name it in the
 * same batch, which is the whole point. Statements are built on `tx`, never on
 * `db`: a builder made from `db` runs outside the transaction even when it is
 * awaited inside one.
 *
 * The signal rows carry a conversation id and a message id and nothing else.
 * The client fetches the content back through `withSchoolAuth`, where
 * membership is re-resolved from `school_users` on that request — see
 * `db/schema/chat-signals.ts` for why the socket is not trusted with the body.
 */
export async function postMessage(input: {
  locationId: string;
  conversationId: string;
  senderSchoolUserId: string | null;
  senderName: string;
  senderRole: string;
  body: string;
  kind?: 'text' | 'system';
  flaggedReason?: string | null;
  attachment?: PostedAttachment | null;
}): Promise<PostedMessage> {
  const now = new Date();
  const settings = await getChatSchoolSettings(input.locationId);
  const senderIsStaff = input.senderSchoolUserId !== null && isStaffRole(input.senderRole as UserRole);

  /*
   * The recipients of the signal: every other seated participant. Read before
   * the transaction because it is a plain read and holding a transaction open
   * across it buys nothing.
   *
   * Sprint 29 widened this from `auth_user_id` alone. The socket needs the auth
   * id and nothing else; the **bell** needs the `school_users` id it is
   * addressed to and the role that decides which portal the entry links into —
   * see `lib/chat-notifications.ts`. Both come out of the same join, so this is
   * two more columns rather than a second read.
   *
   * `authUserId` stays nullable and the two consumers diverge on it: a person
   * with no sign-in account gets no signal (there is no socket to send it down)
   * but still gets the bell entry, because they will have one the moment
   * somebody issues them a login and the entry will be waiting.
   */
  const recipients = await db
    .select({
      authUserId: schoolUsers.authUserId,
      schoolUserId: schoolUsers.id,
      role: schoolUsers.role,
    })
    .from(chatParticipants)
    .innerJoin(schoolUsers, eq(schoolUsers.id, chatParticipants.schoolUserId))
    .where(
      and(
        eq(chatParticipants.locationId, input.locationId),
        eq(chatParticipants.conversationId, input.conversationId),
        isNull(chatParticipants.leftAt),
        input.senderSchoolUserId === null
          ? undefined
          : ne(chatParticipants.schoolUserId, input.senderSchoolUserId),
      ),
    );

  /*
   * The thread's subject, for the bell entry's body. One indexed read of a row
   * this function is about to update anyway; it is read here rather than taken
   * from the `UPDATE` because that update sets `last_message_at` and returns
   * nothing, and widening it to return a column would put a read inside the
   * batch for no gain.
   */
  const [conversation] = await db
    .select({ subject: chatConversations.subject })
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.locationId, input.locationId),
        eq(chatConversations.id, input.conversationId),
      ),
    )
    .limit(1);

  const messageId = randomUUID();

  const signals = recipients.flatMap((row) =>
    row.authUserId === null
      ? []
      : [
          {
            locationId: input.locationId,
            recipientAuthUserId: row.authUserId,
            conversationId: input.conversationId,
            messageId,
            createdAt: now,
          },
        ],
  );

  await batch(db, (tx) => {
    const statements: PromiseLike<unknown>[] = [
      tx.insert(chatMessages).values({
        id: messageId,
        locationId: input.locationId,
        conversationId: input.conversationId,
        senderSchoolUserId: input.senderSchoolUserId,
        senderName: input.senderName,
        senderRole: input.senderRole,
        kind: input.kind ?? 'text',
        body: input.body,
        flaggedAt:
          input.flaggedReason === undefined || input.flaggedReason === null ? null : now,
        flaggedReason: input.flaggedReason ?? null,
        createdAt: now,
      }),
      tx
        .update(chatConversations)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(
          and(
            eq(chatConversations.locationId, input.locationId),
            eq(chatConversations.id, input.conversationId),
          ),
        ),
    ];

    // The file, in the same commit as the message it hangs off. See the
    // docblock: this being a separate, later commit is the whole of the lost
    // attachment.
    const attachment = input.attachment ?? null;
    if (attachment !== null) {
      statements.push(
        tx.insert(chatAttachments).values({
          locationId: input.locationId,
          messageId,
          storagePath: attachment.storagePath,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          sizeBytes: attachment.size,
        }),
      );
    }

    // A staff message re-opens every pupil's reply window on this thread. This
    // is the rolling half of the rule: without it a teacher answering at ten at
    // night leaves a pupil unable to respond, which reads to the teacher as
    // being ignored. It is inside the transaction because it is a consequence
    // of the message, and a window rolled for a message that rolled back would
    // be a window nobody can explain.
    if (senderIsStaff) {
      statements.push(
        tx
          .update(chatParticipants)
          .set({
            replyWindowExpiresAt: new Date(
              now.getTime() + settings.replyWindowMinutes * 60_000,
            ),
          })
          .where(
            and(
              eq(chatParticipants.locationId, input.locationId),
              eq(chatParticipants.conversationId, input.conversationId),
              eq(chatParticipants.isStudent, true),
            ),
          ),
      );
    }

    /*
     * Signals last, and that ordering is the fix.
     *
     * A signal is what wakes the recipient's client, and the client's next act
     * is to fetch this conversation. Nothing it could fetch must be missing at
     * the moment the signal becomes visible — so the signal is the last row
     * written inside the transaction that wrote everything it points at.
     */
    if (signals.length > 0) {
      statements.push(tx.insert(chatSignals).values(signals));
    }

    return statements;
  });

  /*
   * Sprint 29. The bell, which is the half of this that reaches somebody who is
   * *not* on the chat screen.
   *
   * A signal is delivered over a socket that only the chat screen listens on,
   * so before this every other page of every portal was deaf: a parent on their
   * dashboard when a teacher wrote to them learned about it from the hourly
   * digest email and from nothing else. `lib/chat-notifications.ts` writes one
   * bell entry per conversation per recipient, carries no message text, and
   * sends no mail — chat already owns its own, and the reasoning is there.
   *
   * Awaited rather than fired and forgotten, so a message and its bell entry
   * land together; it swallows its own failures, so this cannot turn a
   * delivered message into a failed send.
   */
  await notifyChatRecipients({
    locationId: input.locationId,
    conversationId: input.conversationId,
    senderName: input.senderName,
    subject: conversation?.subject ?? null,
    recipients: recipients.map((row) => ({
      schoolUserId: row.schoolUserId,
      role: row.role as UserRole,
    })),
  });

  return { id: messageId, conversationId: input.conversationId, createdAt: now };
}

/**
 * Claims an unclaimed desk thread for one member of staff.
 *
 * A conditional `UPDATE … RETURNING`, not a read followed by an `if`, and the
 * reason is `CLAUDE.md`'s rule about seven server processes applied to three
 * clerks with the same inbox open: Postgres decides it on one row under one
 * lock, and exactly one caller gets a row back.
 */
export async function claimRoleInbox(
  locationId: string,
  conversationId: string,
  schoolUserId: string,
): Promise<boolean> {
  const claimed = await db
    .update(chatConversations)
    .set({ claimedBy: schoolUserId, claimedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(chatConversations.locationId, locationId),
        eq(chatConversations.id, conversationId),
        eq(chatConversations.kind, 'role_inbox'),
        isNull(chatConversations.claimedBy),
      ),
    )
    .returning({ id: chatConversations.id });

  return claimed.length > 0;
}

/**
 * Which desks this member of staff may pick up.
 *
 * The desk's own roles, plus the school admin — who may claim anything at any
 * time, whether or not they were seated. Sprint 30 took `school_admin` off
 * `answeredBy` because being *copied on every enquiry by default* was the
 * defect; being able to pick one up never was. See `db/schema/chat-conversations.ts`.
 */
export function claimableInboxes(role: UserRole): RoleInboxKey[] {
  if (role === DESK_FALLBACK_ROLE) return [...ROLE_INBOX_KEYS];

  return ROLE_INBOXES.filter((inbox) =>
    (inbox.answeredBy as readonly string[]).includes(role),
  ).map((inbox) => inbox.key);
}

/* ------------------------------------------------------------------------
 * Reads
 * --------------------------------------------------------------------- */

export interface InboxRow {
  conversationId: string;
  kind: string;
  subject: string | null;
  roleInbox: string | null;
  status: string;
  lastMessageAt: Date | null;
  lastReadAt: Date | null;
  unread: boolean;
  canPost: boolean;
  counterparty: string;
  /**
   * Who picked this desk enquiry up, if anybody. Null on every direct thread —
   * `claimed_by` is meaningless there — and null on a desk nobody has taken.
   */
  claimedByName: string | null;
  /** True when this is an unclaimed desk thread the reader could take. */
  claimable: boolean;
}

/**
 * One person's inbox.
 *
 * ── The alias, and why it is spelled like that ───────────────────────────
 * `counterparty` is an ordered aggregate over `school_users.name` in a
 * statement that already joins `school_users`. `CLAUDE.md` records what an
 * alias colliding with a joined column costs — Sprint 18 aliased one `phone`
 * beside `school_users.phone`, Postgres refused the whole statement with 42702,
 * and the all-students screen was a 500 at every school for as long as it was
 * live. So the alias is a name no joined table has, and every reference to it
 * is qualified.
 *
 * Read the generated SQL before changing this. It joins four tables and
 * `console.log(query.toSQL())` is the only evidence that exists.
 */
/** `school_users` under a second name, for the person holding a desk thread. */
const claimant = alias(schoolUsers, 'claimant');

export async function listInbox(
  locationId: string,
  schoolUserId: string,
  limit = 50,
): Promise<InboxRow[]> {
  const counterparty = db
    .select({
      conversationId: chatParticipants.conversationId,
      chatCounterpartyName: sql<string>`string_agg(${schoolUsers.name}, ', ' ORDER BY ${schoolUsers.name})`.as(
        'chat_counterparty_name',
      ),
    })
    .from(chatParticipants)
    .innerJoin(schoolUsers, eq(schoolUsers.id, chatParticipants.schoolUserId))
    .where(
      and(
        eq(chatParticipants.locationId, locationId),
        ne(chatParticipants.schoolUserId, schoolUserId),
      ),
    )
    .groupBy(chatParticipants.conversationId)
    .as('counterparty');

  const rows = await db
    .select({
      conversationId: chatConversations.id,
      kind: chatConversations.kind,
      subject: chatConversations.subject,
      roleInbox: chatConversations.roleInbox,
      status: chatConversations.status,
      lastMessageAt: chatConversations.lastMessageAt,
      lastReadAt: chatParticipants.lastReadAt,
      canPost: chatParticipants.canPost,
      counterparty: counterparty.chatCounterpartyName,
      claimedBy: chatConversations.claimedBy,
      claimedByName: claimant.name,
    })
    .from(chatParticipants)
    .innerJoin(chatConversations, eq(chatConversations.id, chatParticipants.conversationId))
    .leftJoin(counterparty, eq(counterparty.conversationId, chatConversations.id))
    /*
     * Who holds the desk. A table alias rather than a `sql` template, which is
     * the distinction `CLAUDE.md` draws at length: `alias()` renames the table
     * and Drizzle then qualifies every reference to it, so `claimant.name`
     * cannot collide with the `school_users.name` the counterparty subquery
     * aggregates. A `sql` alias would have been emitted unqualified and this
     * statement would have joined its third `name`.
     */
    .leftJoin(claimant, eq(claimant.id, chatConversations.claimedBy))
    .where(
      and(
        eq(chatParticipants.locationId, locationId),
        eq(chatParticipants.schoolUserId, schoolUserId),
        isNull(chatParticipants.leftAt),
      ),
    )
    .orderBy(desc(chatConversations.lastMessageAt))
    .limit(limit);

  return rows.map((row) => ({
    conversationId: row.conversationId,
    kind: row.kind,
    subject: row.subject,
    roleInbox: row.roleInbox,
    status: row.status,
    lastMessageAt: row.lastMessageAt,
    lastReadAt: row.lastReadAt,
    unread:
      row.lastMessageAt !== null &&
      (row.lastReadAt === null || row.lastReadAt.getTime() < row.lastMessageAt.getTime()),
    canPost: row.canPost,
    counterparty: counterpartyLabel(row),
    claimedByName: row.claimedByName,
    claimable:
      row.kind === 'role_inbox' && row.claimedBy === null && row.status === 'open',
  }));
}

/**
 * What one row in the inbox is called.
 *
 * ── Why a desk is not a person ───────────────────────────────────────────
 * `counterparty` is an aggregate of the *other* seated people, which is the
 * right answer for a direct thread and the wrong one for a desk. A parent who
 * wrote to the Principal Office saw **"The school"** — the fallback for a
 * thread with nobody else in it — and once Sprint 30 seats the answerers they
 * would instead see the clerks' personal names, which is worse: the whole
 * point of writing to a desk is that you are not writing to a named person,
 * and the name that answers today is not the one that answers in March.
 *
 * So a desk thread is titled by the desk, on both sides. A parent sees
 * "Principal Office" in the list they chose it from; the staff on that desk
 * see which desk the enquiry came in on, which is the thing that tells them
 * whether it is theirs. Who actually wrote each message is in the transcript,
 * where it belongs, and never inferred from a list heading.
 */
function counterpartyLabel(row: {
  kind: string;
  roleInbox: string | null;
  counterparty: string | null;
}): string {
  if (row.kind === 'role_inbox' && isRoleInboxKey(row.roleInbox)) {
    return roleInboxLabel(row.roleInbox);
  }

  return row.counterparty ?? 'The school';
}

/** How many of this person's conversations have something unread in them. */
export async function countUnreadConversations(
  locationId: string,
  schoolUserId: string,
): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(chatParticipants)
    .innerJoin(chatConversations, eq(chatConversations.id, chatParticipants.conversationId))
    .where(
      and(
        eq(chatParticipants.locationId, locationId),
        eq(chatParticipants.schoolUserId, schoolUserId),
        isNull(chatParticipants.leftAt),
        or(
          isNull(chatParticipants.lastReadAt),
          lt(chatParticipants.lastReadAt, chatConversations.lastMessageAt),
        ),
      ),
    );

  return rows[0]?.total ?? 0;
}

export interface TranscriptMessage {
  id: string;
  senderSchoolUserId: string | null;
  senderName: string;
  senderRole: string;
  kind: string;
  /** Null when redacted — the row keeps the body, the wire does not carry it. */
  body: string | null;
  redactedAt: Date | null;
  redactionReason: string | null;
  createdAt: Date;
}

/**
 * A conversation's messages, for somebody already shown to be a participant.
 *
 * A redacted message keeps its body in the table and loses it here. That is the
 * whole distinction the append-only rule buys: the record survives for the
 * investigation and the export, and the reader sees that something was removed
 * and by whom rather than seeing a gap.
 */
export async function listMessages(
  locationId: string,
  conversationId: string,
  since: Date | null = null,
  limit = 200,
): Promise<TranscriptMessage[]> {
  const rows = await db
    .select({
      id: chatMessages.id,
      senderSchoolUserId: chatMessages.senderSchoolUserId,
      senderName: chatMessages.senderName,
      senderRole: chatMessages.senderRole,
      kind: chatMessages.kind,
      body: chatMessages.body,
      redactedAt: chatMessages.redactedAt,
      redactionReason: chatMessages.redactionReason,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.locationId, locationId),
        eq(chatMessages.conversationId, conversationId),
        since === null ? undefined : gt(chatMessages.createdAt, since),
      ),
    )
    .orderBy(asc(chatMessages.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    body: row.redactedAt === null ? row.body : null,
  }));
}

/**
 * Marks everything in a conversation read, for one participant.
 *
 * Four things move now, and each was added for a reported fault.
 *
 * `chat_participants.last_read_at` is what the inbox dot and the sidebar badge
 * are computed from. The bell keeps its own row per thread (Sprint 29), and
 * leaving that behind would make the bell a number that only ever grows —
 * which is precisely how a badge stops being read.
 *
 * ── Sprint 33a: the signals go, and the digest counter resets ────────────
 * **The chime rang for messages already read.** Nothing deleted a
 * `chat_signal` when its conversation was opened, so every catch-up that
 * reached back over a read message delivered it again — and since Sprint 29
 * `ChatStreamProvider` is mounted in *every* portal layout, so each page load
 * re-armed that catch-up. A signal is worthless the moment it is delivered;
 * its own schema says so. Deleting this person's signals for this thread is
 * the server-side half of the fix, and it is the half that holds on **every**
 * device: reading on a phone silences the laptop.
 *
 * `digest_count` goes back to 0 for the same reason in the other channel. It
 * counts how many daily emails this thread has already produced, and having
 * read it is the answer those emails were asking for.
 *
 * All three are in **one transaction**: a `last_read_at` that moved while the
 * signals survived is exactly the state the chime defect lived in.
 *
 * The bell half stays best-effort and outside it. This is called
 * fire-and-forget from the client, the marker that matters is the first one,
 * and a failed bell clear must not lose the read.
 */
export async function markConversationRead(
  locationId: string,
  conversationId: string,
  schoolUserId: string,
  role: UserRole,
): Promise<void> {
  /*
   * `chat_signals` is keyed by the GoTrue id — see that table's docblock for
   * why the RLS policy needs it rather than a join — so the caller's auth id
   * is read first and the delete uses `eq`. One indexed read outside the
   * transaction, rather than a correlated subquery inside it.
   */
  const accounts = await db
    .select({ authUserId: schoolUsers.authUserId })
    .from(schoolUsers)
    .where(and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.id, schoolUserId)))
    .limit(1);

  const authUserId = accounts[0]?.authUserId ?? null;

  await batch(db, (tx) => {
    const statements: PromiseLike<unknown>[] = [
      tx
        .update(chatParticipants)
        .set({ lastReadAt: new Date(), digestCount: 0 })
        .where(
          and(
            eq(chatParticipants.locationId, locationId),
            eq(chatParticipants.conversationId, conversationId),
            eq(chatParticipants.schoolUserId, schoolUserId),
          ),
        ),
    ];

    // Nobody with no sign-in account has ever been sent a signal, so there is
    // nothing to delete for them — and a delete with a null recipient would be
    // a delete with no predicate on the column that scopes it to one person.
    if (authUserId !== null) {
      statements.push(
        tx
          .delete(chatSignals)
          .where(
            and(
              eq(chatSignals.locationId, locationId),
              eq(chatSignals.conversationId, conversationId),
              eq(chatSignals.recipientAuthUserId, authUserId),
            ),
          ),
      );
    }

    return statements;
  });

  try {
    await markChatNotificationsRead(schoolUserId, role, conversationId);
  } catch (error) {
    console.error(`[chat] could not clear the bell for ${conversationId}:`, error);
  }
}

/**
 * Whether a conversation is one a moderator may read without being seated.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 * `ROADMAP.md` agreed on 2026-08-07 that **school admins can read conversations
 * involving students**, and every pupil thread carries a banner telling its
 * participants exactly that. Until this existed the promise was only half kept:
 * the moderation queue showed a reported *message*, and
 * `/conversations/[id]/messages` refused the thread it sat in, because an
 * administrator is deliberately not seated as a participant.
 *
 * So a head investigating "he said something to my daughter" saw one sentence
 * with no conversation around it — which is the one thing a safeguarding
 * investigation cannot work from.
 *
 * ── Narrow on purpose ────────────────────────────────────────────────────
 * **Only threads about a pupil.** `student_profile_id IS NOT NULL` is the whole
 * condition, and it is what stops this being a licence to read anything: a
 * staff-to-staff thread and a parent's fee query to the Accounts desk are not
 * the safeguarding case, were never agreed to be readable, and stay unreadable.
 *
 * The permission is checked by the caller; this answers only "is this the kind
 * of conversation that permission covers".
 */
export async function isModeratableConversation(
  locationId: string,
  conversationId: string,
): Promise<boolean> {
  const rows = await db
    .select({ studentProfileId: chatConversations.studentProfileId })
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.locationId, locationId),
        eq(chatConversations.id, conversationId),
      ),
    )
    .limit(1);

  return rows[0]?.studentProfileId != null;
}

/** Whether this person is seated in this conversation at all. */
export async function isParticipant(
  locationId: string,
  conversationId: string,
  schoolUserId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: chatParticipants.id })
    .from(chatParticipants)
    .where(
      and(
        eq(chatParticipants.locationId, locationId),
        eq(chatParticipants.conversationId, conversationId),
        eq(chatParticipants.schoolUserId, schoolUserId),
        isNull(chatParticipants.leftAt),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/** The rank a person's grants carry. Snapshotted onto every row they write. */
export function rankFor(role: UserRole): number {
  return grantRankFor(role);
}

/**
 * Signals newer than a cursor, for a client catching up after a reconnect.
 *
 * ── Sprint 33a: a read conversation delivers nothing ─────────────────────
 * This used to filter on the recipient and `created_at` and **nothing else**,
 * which is what made the chime ring for messages somebody had already read: a
 * catch-up cursor that reaches back over a read message finds its signal still
 * sitting there. `markConversationRead` now deletes those rows, and this is the
 * belt to that pair of braces — a signal written before the read, on a device
 * that has been asleep since, is excluded by the marker rather than by whether
 * the delete happened to have run.
 *
 * The join is `chat_signals` → `school_users` (the GoTrue id the signal is
 * addressed to is not a `school_users.id`) → that person's seat in the
 * conversation. It is a **left** join: a signal for a thread somebody has since
 * left still belongs to them, and an inner join would silently stop delivering
 * it.
 *
 * `lt(lastReadAt, createdAt)` is column against column, so no JavaScript
 * `Date` reaches the driver through it — CLAUDE.md's rule, and the reason no
 * raw template appears anywhere in this statement.
 */
export async function listSignalsSince(
  locationId: string,
  authUserId: string,
  since: Date,
): Promise<{ conversationId: string; messageId: string; createdAt: Date }[]> {
  return db
    .select({
      conversationId: chatSignals.conversationId,
      messageId: chatSignals.messageId,
      createdAt: chatSignals.createdAt,
    })
    .from(chatSignals)
    .innerJoin(
      schoolUsers,
      and(
        eq(schoolUsers.locationId, chatSignals.locationId),
        eq(schoolUsers.authUserId, chatSignals.recipientAuthUserId),
      ),
    )
    .leftJoin(
      chatParticipants,
      and(
        eq(chatParticipants.conversationId, chatSignals.conversationId),
        eq(chatParticipants.schoolUserId, schoolUsers.id),
      ),
    )
    .where(
      and(
        eq(chatSignals.locationId, locationId),
        eq(chatSignals.recipientAuthUserId, authUserId),
        gte(chatSignals.createdAt, since),
        or(
          isNull(chatParticipants.lastReadAt),
          lt(chatParticipants.lastReadAt, chatSignals.createdAt),
        ),
      ),
    )
    .orderBy(asc(chatSignals.createdAt))
    .limit(200);
}
