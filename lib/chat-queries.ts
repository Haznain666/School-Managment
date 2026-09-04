import 'server-only';

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
import { cache } from 'react';

import { chatConversations, type RoleInboxKey, ROLE_INBOXES } from '@/db/schema/chat-conversations';
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
import { batch, db } from './drizzle';

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
}

const STAFF_ROLES: readonly UserRole[] = [
  'school_admin',
  'branch_admin',
  'principal',
  'vice_principal',
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
 * The teachers of one parent's children, plus their class teachers.
 *
 * Two id spaces meet here and conflating them is the defect
 * `lib/staff-portal-access.ts` warns about at length:
 * `timetable_entries.teacher_id` is a **`school_users.id`**, while
 * `sections.class_teacher_id` is a **`staff.id`**. The second is bridged back
 * through `staff.school_user_id`, because a chat participant is always a
 * `school_users` row.
 */
async function teachersOfChildren(
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
      ),
    );

  const byId = new Map<string, ReachableTarget>();

  for (const row of subjectTeachers) {
    byId.set(row.schoolUserId, {
      kind: 'person',
      id: row.schoolUserId,
      name: row.name,
      detail: `Teaches ${row.gradeName} ${row.sectionName}`,
    });
  }

  for (const row of classTeachers) {
    if (row.schoolUserId === null) continue;
    byId.set(row.schoolUserId, {
      kind: 'person',
      id: row.schoolUserId,
      name: row.name,
      detail: `Class teacher, ${row.gradeName} ${row.sectionName}`,
    });
  }

  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** The teachers who actually teach this pupil, this year. */
async function teachersOfStudent(
  locationId: string,
  studentSchoolUserId: string,
  academicYearId: string,
): Promise<ReachableTarget[]> {
  const rows = await db
    .selectDistinct({
      schoolUserId: schoolUsers.id,
      name: schoolUsers.name,
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

  return rows.map((row) => ({
    kind: 'person' as const,
    id: row.schoolUserId,
    name: row.name,
    detail: 'Your teacher',
  }));
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

    const inboxes: ReachableTarget[] = ROLE_INBOXES.map((inbox) => ({
      kind: 'inbox' as const,
      id: inbox.key,
      name: inbox.label,
      detail: 'The school will answer',
    }));

    return [...inboxes, ...teachers];
  }

  if (!isStaffRole(actor.role)) return [];

  // Staff reach every active account at the school. `school_users` is the
  // school's own directory and a member of staff already has it on the users
  // screen; chat is not what makes it visible.
  const rows = await db
    .select({ id: schoolUsers.id, name: schoolUsers.name, role: schoolUsers.role })
    .from(schoolUsers)
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.isActive, true),
        ne(schoolUsers.id, actor.schoolUserId),
      ),
    )
    .orderBy(asc(schoolUsers.name));

  return rows.map((row) => ({
    kind: 'person' as const,
    id: row.id,
    name: row.name,
    detail: row.role.replace(/_/g, ' '),
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

/**
 * Writes a message, moves the conversation's clock, rolls every pupil's reply
 * window, and fans out the signals — in **one transaction**.
 *
 * All four or none. A message whose `last_message_at` did not move is a message
 * that never reaches an inbox, and a signal written outside the transaction is
 * a notification for a message a rollback removed.
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
}): Promise<PostedMessage> {
  const now = new Date();
  const settings = await getChatSchoolSettings(input.locationId);
  const senderIsStaff = input.senderSchoolUserId !== null && isStaffRole(input.senderRole as UserRole);

  // The recipients of the signal: every other seated participant who has a
  // sign-in account. Read before the transaction because it is a plain read and
  // holding a transaction open across it buys nothing.
  const recipients = await db
    .select({ authUserId: schoolUsers.authUserId })
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

  const [inserted] = await batch(db, (tx) => [
    tx
      .insert(chatMessages)
      .values({
        locationId: input.locationId,
        conversationId: input.conversationId,
        senderSchoolUserId: input.senderSchoolUserId,
        senderName: input.senderName,
        senderRole: input.senderRole,
        kind: input.kind ?? 'text',
        body: input.body,
        flaggedAt: input.flaggedReason === undefined || input.flaggedReason === null ? null : now,
        flaggedReason: input.flaggedReason ?? null,
        createdAt: now,
      })
      .returning({ id: chatMessages.id, createdAt: chatMessages.createdAt }),
    tx
      .update(chatConversations)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(
        and(
          eq(chatConversations.locationId, input.locationId),
          eq(chatConversations.id, input.conversationId),
        ),
      ),
  ]);

  const messageId = inserted[0]?.id;
  if (messageId === undefined) {
    throw new Error('chat: the message insert returned no row');
  }

  // A staff message re-opens every pupil's reply window on this thread. This is
  // the rolling half of the rule: without it a teacher answering at ten at
  // night leaves a pupil unable to respond, which reads to the teacher as being
  // ignored.
  if (senderIsStaff) {
    await db
      .update(chatParticipants)
      .set({
        replyWindowExpiresAt: new Date(now.getTime() + settings.replyWindowMinutes * 60_000),
      })
      .where(
        and(
          eq(chatParticipants.locationId, input.locationId),
          eq(chatParticipants.conversationId, input.conversationId),
          eq(chatParticipants.isStudent, true),
        ),
      );
  }

  const signals = recipients
    .filter((row): row is { authUserId: string } => row.authUserId !== null)
    .map((row) => ({
      locationId: input.locationId,
      recipientAuthUserId: row.authUserId,
      conversationId: input.conversationId,
      messageId,
      createdAt: now,
    }));

  if (signals.length > 0) {
    await db.insert(chatSignals).values(signals);
  }

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

/** Which desks this member of staff may pick up. */
export function claimableInboxes(role: UserRole): RoleInboxKey[] {
  return ROLE_INBOXES.filter((inbox) =>
    (inbox.claimableBy as readonly string[]).includes(role),
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
    })
    .from(chatParticipants)
    .innerJoin(chatConversations, eq(chatConversations.id, chatParticipants.conversationId))
    .leftJoin(counterparty, eq(counterparty.conversationId, chatConversations.id))
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
    counterparty: row.counterparty ?? 'The school',
  }));
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

/** Marks everything in a conversation read, for one participant. */
export async function markConversationRead(
  locationId: string,
  conversationId: string,
  schoolUserId: string,
): Promise<void> {
  await db
    .update(chatParticipants)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(chatParticipants.locationId, locationId),
        eq(chatParticipants.conversationId, conversationId),
        eq(chatParticipants.schoolUserId, schoolUserId),
      ),
    );
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

/** Signals newer than a cursor, for a client catching up after a reconnect. */
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
    .where(
      and(
        eq(chatSignals.locationId, locationId),
        eq(chatSignals.recipientAuthUserId, authUserId),
        gte(chatSignals.createdAt, since),
      ),
    )
    .orderBy(asc(chatSignals.createdAt))
    .limit(200);
}
