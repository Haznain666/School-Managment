import 'server-only';

import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { branches } from '@/db/schema/branches';
import { chatConversations } from '@/db/schema/chat-conversations';
import { chatParticipants } from '@/db/schema/chat-participants';
import { grades } from '@/db/schema/grades';
import { schoolUsers } from '@/db/schema/school-users';
import { sections } from '@/db/schema/sections';
import { studentEnrollments } from '@/db/schema/student-enrollments';
import { studentProfiles } from '@/db/schema/student-profiles';
import type { UserRole } from '@/types/school-auth';

import { db } from './drizzle';
import { describeScope, UNSCOPED } from './principal-resolver';
import { scopeForCaller, visibleGradeIds } from './principal-visibility';

/**
 * Who may read which conversations, for the people who are not in them.
 *
 * ── This is oversight, and it is not moderation ──────────────────────────
 * `chat.moderate` answers one question: somebody reported a message, may I read
 * the thread it sat in. It is narrow by design — `isModeratableConversation`
 * admits only threads *about a pupil*, so a staff-to-staff thread stays shut.
 *
 * Sprint 26 adds the second question, which the product owner asked directly: a
 * School Administrator has to be able to read **all** the correspondence at the
 * school, and a Principal the correspondence of the campuses they run. That is
 * a different shape of answer and it gets its own permission (`chat.oversight`)
 * and its own screen, rather than being bolted onto moderation — because a head
 * browsing what teachers say to each other is not a safeguarding investigation
 * and should not be recorded, permissioned or explained as if it were.
 *
 * ── The four scopes, and the one that is an omission ─────────────────────
 *
 * | Role | Reads |
 * | --- | --- |
 * | School Administrator | every conversation at the school, every campus |
 * | Principal | every conversation at the campuses assigned to them |
 * | Principal, with grades | staff-to-staff at their campuses, **plus** pupil and parent threads for their own grades |
 * | Branch Administrator | nothing. `chat.oversight` is not in their default set |
 *
 * The grade-limited head is the interesting row and the reason this module
 * exists rather than a `WHERE branch_id IN (…)` in a route. A conversation
 * about a pupil is attributable to a grade — through that pupil's active
 * enrollment — and one between two members of staff is not. The rule the owner
 * gave is that a head with particular grades still sees *all* staff-to-staff
 * correspondence at their campuses, because a division head is still a head:
 * only the pupil-facing half narrows.
 *
 * ── It narrows sight, and here that IS the boundary ──────────────────────
 * `lib/principal-visibility.ts` opens by restating that a principal's scope is
 * a visibility filter and not an authorization boundary — a crafted request
 * outside their grades still succeeds, deliberately, and that is a recorded
 * product decision.
 *
 * **That does not carry over to this module, and must not.** Every function
 * here is checked server-side before a transcript is returned, and
 * `oversightAdmits` is called by the transcript route on the conversation id in
 * the URL rather than trusting the list the screen was drawn from. The
 * difference is what is on the other side: a head seeing one extra student's
 * name on a roll is untidy, and a head reading a colleague's private
 * correspondence about them is not.
 *
 * ── Everybody in a conversation is told ──────────────────────────────────
 * The banner is half the design and the half that is easy to drop. Sprint 24's
 * notice covered pupil threads only, because those were the only ones anybody
 * could read. Staff threads now carry one too — see `OVERSIGHT_NOTICE`. A
 * covert audit is surveillance; a disclosed one is a deterrent.
 */

/** What one caller may reach. */
export type OversightScope =
  | { kind: 'none' }
  /** Every conversation at the school. */
  | { kind: 'all'; note: null }
  /**
   * Campuses, and possibly grades.
   *
   * `branchIds` null means every campus; an **empty array** means none, and is
   * a real answer — an unassigned head reaches nothing. `gradeIds` null means
   * pupil threads are not narrowed; an empty array means no pupil thread
   * matches. Reading either empty array as "no filter" would hand a head the
   * whole school, which is the one dangerous mistake in this module.
   */
  | {
      kind: 'scoped';
      branchIds: string[] | null;
      gradeIds: string[] | null;
      note: string | null;
    };

/**
 * The sentence a thread carries when somebody outside it can read it.
 *
 * Deliberately says *who*, not "may be monitored". A teacher is entitled to
 * know that this is their head and their school administrator and nobody else.
 */
export const OVERSIGHT_NOTICE =
  'Your school administrator and the head of your campus can read this conversation.';

/**
 * The caller's oversight scope, from a verified session.
 *
 * The permission is the caller's; this decides only how far it reaches. A route
 * checks `chat.oversight` first and then asks this — the two are separate
 * because a school may move the permission to another role in the matrix, and
 * that role's *reach* still has to be derived from what they are.
 */
export async function resolveOversightScope(
  locationId: string,
  role: UserRole,
  uid: string,
): Promise<OversightScope> {
  // A School Administrator reads the school. There is no campus to resolve and
  // no grades to intersect, so this answers without touching the database.
  if (role === 'school_admin') return { kind: 'all', note: null };

  if (role !== 'principal') return { kind: 'none' };

  const scope = await scopeForCaller(locationId, role, uid);

  // A head at a `single`-principal school runs the whole school, which is what
  // `UNSCOPED` means. Not the same as `school_admin` in permissions, identical
  // in reach.
  if (!scope.scoped) return { kind: 'all', note: null };

  // Assigned nothing. Empty arrays rather than nulls, so every caller below
  // filters to zero rather than to everything.
  if (scope.unassigned) {
    return {
      kind: 'scoped',
      branchIds: [],
      gradeIds: [],
      note: describeScope(scope),
    };
  }

  // `visibleGradeIds` collapses both axes — campus and division — into the one
  // grade list the rest of the product already filters on. A head scoped only
  // by campus gets every grade at that campus, which is the correct answer:
  // their pupil threads are not narrowed beyond the campus itself.
  const gradeIds = await visibleGradeIds(locationId, scope);

  return {
    kind: 'scoped',
    branchIds: scope.branchIds,
    // A head with no grade axis at all has `scope.gradeIds === null`, and
    // narrowing their pupil threads by the campus's grade list would be the
    // same answer at more cost. Keep the null so the query drops the join.
    gradeIds: scope.gradeIds === null ? null : gradeIds,
    note: describeScope(scope),
  };
}

/* ------------------------------------------------------------------------
 * The list
 * --------------------------------------------------------------------- */

export interface OversightRow {
  conversationId: string;
  kind: string;
  subject: string | null;
  status: string;
  lastMessageAt: Date | null;
  branchName: string | null;
  studentName: string | null;
  gradeName: string | null;
  /** Every seat at the table, "Name (Role)", so the list explains itself. */
  participants: string;
}

/**
 * Conversations one overseer may read, newest first.
 *
 * ── Read the generated SQL before changing this ──────────────────────────
 * CLAUDE.md's alias rule, twice over. This statement joins six relations, two
 * of them derived, and Drizzle renders a `sql``` column inside a template
 * *unqualified* — so a derived column called `name` beside `branches.name`,
 * `grades.name` or `school_users.name` is the 42702 that took the all-students
 * screen down at every school in Sprint 18. Every column selected inside a
 * subquery below is therefore aliased to `oversight_*`, a prefix no table in
 * this schema has, and `scripts/check-sprint26.ts` executes the whole thing
 * against the real schema because a statement that has only been read is
 * evidence about spelling and nothing else.
 */
export async function listOverseeableConversations(
  locationId: string,
  scope: OversightScope,
  limit = 100,
): Promise<OversightRow[]> {
  if (scope.kind === 'none') return [];

  /*
   * Who is in the thread. `string_agg` over name and role, ordered, so two
   * calls produce the same string and a reader can scan the column.
   *
   * `left_at IS NULL` is deliberately *not* applied: somebody removed from a
   * conversation was in it when the messages were written, and an oversight
   * list that quietly drops them describes a conversation that never happened.
   */
  const seats = db
    .select({
      conversationId: sql<string>`${chatParticipants.conversationId}`.as(
        'oversight_seat_conversation_id',
      ),
      names: sql<string>`string_agg(
        ${schoolUsers.name} || ' (' || ${schoolUsers.role} || ')',
        ', ' ORDER BY ${schoolUsers.role}, ${schoolUsers.name}
      )`.as('oversight_seat_names'),
    })
    .from(chatParticipants)
    .innerJoin(schoolUsers, eq(schoolUsers.id, chatParticipants.schoolUserId))
    .where(eq(chatParticipants.locationId, locationId))
    .groupBy(chatParticipants.conversationId)
    .as('oversight_seats');

  /*
   * The grade a pupil thread belongs to.
   *
   * One row per pupil, off their **active** enrollment — the same predicate the
   * register, the voucher and the report card use. A pupil with no active
   * enrollment (withdrawn, or between years) produces no row, so their threads
   * carry a null grade and are excluded from a grade-limited head's list. That
   * is the safe direction: an unattributable thread is not shown to somebody
   * whose reach is defined by attribution.
   */
  const placement = db
    .select({
      studentProfileId: sql<string>`${studentEnrollments.studentProfileId}`.as(
        'oversight_placement_profile_id',
      ),
      gradeId: sql<string>`${grades.id}`.as('oversight_placement_grade_id'),
      gradeName: sql<string>`${grades.name}`.as('oversight_placement_grade_name'),
    })
    .from(studentEnrollments)
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .as('oversight_placement');

  const rows = await db
    .select({
      conversationId: chatConversations.id,
      kind: chatConversations.kind,
      subject: chatConversations.subject,
      status: chatConversations.status,
      lastMessageAt: chatConversations.lastMessageAt,
      branchName: branches.name,
      studentName: schoolUsers.name,
      gradeName: placement.gradeName,
      participants: seats.names,
    })
    .from(chatConversations)
    .leftJoin(branches, eq(branches.id, chatConversations.branchId))
    .leftJoin(studentProfiles, eq(studentProfiles.id, chatConversations.studentProfileId))
    .leftJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .leftJoin(placement, eq(placement.studentProfileId, chatConversations.studentProfileId))
    .leftJoin(seats, eq(seats.conversationId, chatConversations.id))
    .where(and(eq(chatConversations.locationId, locationId), scopeCondition(scope, placement)))
    .orderBy(desc(chatConversations.lastMessageAt))
    .limit(limit);

  return rows.map((row) => ({
    conversationId: row.conversationId,
    kind: row.kind,
    subject: row.subject,
    status: row.status,
    lastMessageAt: row.lastMessageAt,
    branchName: row.branchName,
    studentName: row.studentName,
    gradeName: row.gradeName,
    participants: row.participants ?? 'Nobody',
  }));
}

/**
 * The `WHERE` half of a scope, shared by the list and the single-row check.
 *
 * Written once because the two must never disagree: a conversation the list
 * shows and the transcript refuses is a broken screen, and one the list hides
 * and the transcript serves is a hole.
 */
function scopeCondition(
  scope: OversightScope,
  placement: { gradeId: unknown },
): ReturnType<typeof and> {
  if (scope.kind === 'all') return undefined;
  if (scope.kind === 'none') return sql`false`;

  const { branchIds, gradeIds } = scope;

  /*
   * The campus. A null `branch_id` is a school-wide thread and belongs to every
   * head, exactly as `scopeAdmitsBranch` and `visibleGradeIds` treat a
   * school-wide grade — a single-campus school that never created a branch
   * record has null on everything, and excluding those would show its head an
   * empty screen.
   */
  const branchClause =
    branchIds === null
      ? undefined
      : branchIds.length === 0
        ? isNull(chatConversations.branchId)
        : or(
            isNull(chatConversations.branchId),
            inArray(chatConversations.branchId, branchIds),
          );

  if (gradeIds === null) return and(branchClause);

  /*
   * The grades, and the rule that makes this a division head rather than a
   * class teacher: a thread **about a pupil** must be one of their grades; a
   * thread about nobody — staff to staff, teacher to teacher — is theirs by
   * campus alone.
   */
  const gradeColumn = placement.gradeId as Parameters<typeof inArray>[0];

  const pupilClause =
    gradeIds.length === 0
      ? // Drizzle already renders `inArray(x, [])` as false. Spelling it out is
        // what stops the next reader deleting the branch as unreachable.
        sql`false`
      : inArray(gradeColumn, gradeIds);

  return and(
    branchClause,
    or(isNull(chatConversations.studentProfileId), and(isNotNull(chatConversations.studentProfileId), pupilClause)),
  );
}

/**
 * Whether one conversation is inside one overseer's reach.
 *
 * Called by the transcript route on the id in the URL. The screen's list is not
 * the authority — a conversation id is untrusted however the client obtained
 * it, which is the same reasoning `isParticipant` exists for.
 */
export async function oversightAdmits(
  locationId: string,
  scope: OversightScope,
  conversationId: string,
): Promise<boolean> {
  if (scope.kind === 'none') return false;

  const placement = db
    .select({
      studentProfileId: sql<string>`${studentEnrollments.studentProfileId}`.as(
        'oversight_admits_profile_id',
      ),
      gradeId: sql<string>`${grades.id}`.as('oversight_admits_grade_id'),
    })
    .from(studentEnrollments)
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .as('oversight_admits_placement');

  const rows = await db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .leftJoin(
      placement,
      eq(placement.studentProfileId, chatConversations.studentProfileId),
    )
    .where(
      and(
        eq(chatConversations.locationId, locationId),
        eq(chatConversations.id, conversationId),
        scopeCondition(scope, placement),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/** The scope of somebody who oversees nothing, for a caller with no permission. */
export const NO_OVERSIGHT: OversightScope = { kind: 'none' };

/** Exported for the check script, which asserts the resolver's shape. */
export const OVERSIGHT_UNSCOPED = UNSCOPED;
