import 'server-only';

import { and, eq, isNull, ne } from 'drizzle-orm';

import { chatConversations, isRoleInboxKey } from '@/db/schema/chat-conversations';
import { chatMessages } from '@/db/schema/chat-messages';
import { chatParticipants } from '@/db/schema/chat-participants';
import { grades } from '@/db/schema/grades';
import { schoolUsers } from '@/db/schema/school-users';
import { sections } from '@/db/schema/sections';
import { staff } from '@/db/schema/staff';
import { studentEnrollments } from '@/db/schema/student-enrollments';
import { studentGuardians } from '@/db/schema/student-guardians';
import { studentProfiles } from '@/db/schema/student-profiles';
import type { UserRole } from '@/types/school-auth';

import { getChatSchoolSettings, initiateProblem, postMessage } from './chat-queries';
import { batch, db } from './drizzle';

/**
 * Opening a conversation, and seating everyone who belongs in it.
 *
 * The read side lives in `lib/chat-queries.ts`; this file is the one place a
 * thread comes into existence, which is what makes the seating rules
 * enforceable rather than repeated.
 *
 * ── Who is seated, and who is not ────────────────────────────────────────
 * A thread about a pupil seats **the pupil's guardians and the class teacher as
 * observers**, read-only, and says so in the thread header. That is the
 * safeguarding control `ROADMAP.md` agreed on 2026-08-07, with the parent added
 * by this sprint's decisions — and the disclosure is the half that matters. A
 * covert observer is surveillance; a disclosed one is a deterrent, which is the
 * thing actually wanted.
 *
 * Principals and administrators are deliberately **not** seated. They reach a
 * pupil's conversations through `chat.moderate` instead, and the difference is
 * not pedantry: a seat per head per thread is a row per head per thread, and at
 * a group with four campuses it would be most of the table. A permission
 * answers the same question — may this person read it — without storing the
 * answer once per conversation.
 *
 * ── The indexes decide, not this file ────────────────────────────────────
 * Nothing here checks that two pupils are not being seated together. That is
 * `chat_participants`' partial unique index, and leaving the check there rather
 * than duplicating it is deliberate: a copy in application code is a second
 * thing to keep true, and the one in the database is the one that cannot be
 * skipped. A violation surfaces as `23505` and is translated for the caller.
 */

/** Postgres unique_violation — what the two safeguarding indexes raise. */
const UNIQUE_VIOLATION = '23505';

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

export function isStaffRole(role: string): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

interface Seat {
  schoolUserId: string;
  participantRole: 'owner' | 'member' | 'observer';
  canPost: boolean;
  isStudent: boolean;
  isParent: boolean;
}

/**
 * The pupil's guardians and class teacher, as read-only seats.
 *
 * `exclude` holds anybody already seated — the actor and the target — so a
 * parent who started the thread is not also seated as an observer of it. The
 * unique index on `(conversation_id, school_user_id)` would refuse the second
 * row anyway; excluding here is what turns that from an error into the
 * intended behaviour.
 */
async function observersFor(
  locationId: string,
  studentProfileId: string,
  exclude: ReadonlySet<string>,
): Promise<Seat[]> {
  const guardians = await db
    .select({ schoolUserId: studentGuardians.schoolUserId })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        eq(studentGuardians.studentProfileId, studentProfileId),
      ),
    );

  const classTeachers = await db
    .selectDistinct({ schoolUserId: staff.schoolUserId })
    .from(studentEnrollments)
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(staff, eq(staff.id, sections.classTeacherId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
        eq(studentEnrollments.status, 'active'),
      ),
    );

  const seats: Seat[] = [];
  const seen = new Set(exclude);

  for (const row of guardians) {
    const id = row.schoolUserId;
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    seats.push({
      schoolUserId: id,
      participantRole: 'observer',
      canPost: false,
      isStudent: false,
      isParent: true,
    });
  }

  for (const row of classTeachers) {
    const id = row.schoolUserId;
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    seats.push({
      schoolUserId: id,
      participantRole: 'observer',
      canPost: false,
      isStudent: false,
      isParent: false,
    });
  }

  return seats;
}

/** The student profile a person *is*, if they are a pupil. */
async function profileOf(locationId: string, schoolUserId: string): Promise<string | null> {
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

/** The campus a pupil sits in, for the conversation's `branch_id`. */
async function branchOfStudent(
  locationId: string,
  studentProfileId: string,
): Promise<string | null> {
  const rows = await db
    .select({ branchId: grades.branchId })
    .from(studentEnrollments)
    .innerJoin(sections, eq(sections.id, studentEnrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.studentProfileId, studentProfileId),
        eq(studentEnrollments.status, 'active'),
      ),
    )
    .limit(1);

  return rows[0]?.branchId ?? null;
}

export interface OpenThreadInput {
  locationId: string;
  actor: { schoolUserId: string; name: string; role: UserRole; branchId: string | null };
  target: { kind: 'person' | 'inbox'; id: string };
  subject: string | null;
  body: string;
}

export type OpenThreadResult =
  | { ok: true; conversationId: string }
  | { ok: false; problem: string };

/**
 * Opens a conversation and posts its first message.
 *
 * The conversation, its seats and that message commit together. A thread with
 * no message in it is an empty row in everybody's inbox that nobody can explain,
 * and a thread whose seats did not commit is one only its author can see.
 */
export async function openThread(input: OpenThreadInput): Promise<OpenThreadResult> {
  const problem = await initiateProblem(input.locationId, input.actor, input.target);
  if (problem !== null) return { ok: false, problem };

  if (input.target.kind === 'inbox' && !isRoleInboxKey(input.target.id)) {
    return { ok: false, problem: 'That is not a desk you can write to.' };
  }

  const actorIsStudent = input.actor.role === 'student';
  const actorIsParent = input.actor.role === 'parent';

  // Which child the thread is about. A pupil's own thread is about them; a
  // staff member writing to a pupil is writing about that pupil. A parent's
  // question to a desk is about no particular child unless they say so, and
  // saying so is Sprint 25's context-links work.
  let studentProfileId: string | null = null;
  let targetRole: string | null = null;

  if (actorIsStudent) {
    studentProfileId = await profileOf(input.locationId, input.actor.schoolUserId);
  } else if (input.target.kind === 'person') {
    const rows = await db
      .select({ role: schoolUsers.role })
      .from(schoolUsers)
      .where(
        and(
          eq(schoolUsers.locationId, input.locationId),
          eq(schoolUsers.id, input.target.id),
          eq(schoolUsers.isActive, true),
        ),
      )
      .limit(1);

    targetRole = rows[0]?.role ?? null;
    if (targetRole === null) return { ok: false, problem: 'That account is not active.' };

    if (targetRole === 'student') {
      studentProfileId = await profileOf(input.locationId, input.target.id);
    }
  }

  const seats: Seat[] = [
    {
      schoolUserId: input.actor.schoolUserId,
      participantRole: 'owner',
      canPost: true,
      isStudent: actorIsStudent,
      isParent: actorIsParent,
    },
  ];

  if (input.target.kind === 'person') {
    seats.push({
      schoolUserId: input.target.id,
      participantRole: 'member',
      canPost: true,
      isStudent: targetRole === 'student',
      isParent: targetRole === 'parent',
    });
  }

  if (studentProfileId !== null) {
    const already = new Set(seats.map((seat) => seat.schoolUserId));
    seats.push(...(await observersFor(input.locationId, studentProfileId, already)));
  }

  const settings = await getChatSchoolSettings(input.locationId);
  const now = new Date();
  const replyWindow = new Date(now.getTime() + settings.replyWindowMinutes * 60_000);

  const branchId =
    studentProfileId === null
      ? input.actor.branchId
      : await branchOfStudent(input.locationId, studentProfileId);

  try {
    const [created] = await batch(db, (tx) => [
      tx
        .insert(chatConversations)
        .values({
          locationId: input.locationId,
          branchId,
          kind: input.target.kind === 'inbox' ? 'role_inbox' : 'direct',
          subject: input.subject,
          studentProfileId,
          roleInbox: input.target.kind === 'inbox' ? input.target.id : null,
          status: 'open',
          createdBy: input.actor.schoolUserId,
          lastMessageAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: chatConversations.id }),
    ]);

    const conversationId = created[0]?.id;
    if (conversationId === undefined) {
      throw new Error('chat: the conversation insert returned no row');
    }

    await db.insert(chatParticipants).values(
      seats.map((seat) => ({
        locationId: input.locationId,
        conversationId,
        schoolUserId: seat.schoolUserId,
        participantRole: seat.participantRole,
        canPost: seat.canPost,
        isStudent: seat.isStudent,
        isParent: seat.isParent,
        // Only a pupil carries a window. Everyone else writes when they like.
        replyWindowExpiresAt: seat.isStudent ? replyWindow : null,
        joinedAt: now,
      })),
    );

    await postMessage({
      locationId: input.locationId,
      conversationId,
      senderSchoolUserId: input.actor.schoolUserId,
      senderName: input.actor.name,
      senderRole: input.actor.role,
      body: input.body,
    });

    return { ok: true, conversationId };
  } catch (error) {
    // The two safeguarding indexes surface here. Translating them is the only
    // place in the module that names them to a user, and the wording says what
    // the rule is rather than that a constraint was violated.
    if (uniqueViolation(error)) {
      return {
        ok: false,
        problem:
          'Students can only be in a conversation with a member of staff, and ' +
          'a conversation has one parent writing in it. This one cannot be opened.',
      };
    }
    throw error;
  }
}

function uniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/**
 * Freezes every conversation about a pupil who has left the school.
 *
 * ── Read-only and kept, never deleted ────────────────────────────────────
 * The pupil and their parents lose access; an administrator keeps it. A
 * withdrawal must not be a way to erase a safeguarding record, which is the
 * same argument `CLAUDE.md` makes about the ledger applied to the one thing a
 * school is least able to survive losing.
 *
 * ── Called after the transaction, never inside it ────────────────────────
 * `applyPromotionRun` is all-or-nothing by design, and a chat table refusing a
 * write must not roll a whole class back into last year. This follows the
 * sibling-discount reconciliation beside it exactly, including swallowing its
 * own failure: a conversation left `open` is a conversation an administrator
 * can freeze by hand, and a rolled-back promotion is a day's work lost.
 */
export async function freezeConversationsOnDeparture(
  locationId: string,
  studentProfileId: string,
  reason: string,
): Promise<number> {
  try {
    const frozen = await db
      .update(chatConversations)
      .set({
        status: 'frozen',
        frozenAt: new Date(),
        frozenReason: reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chatConversations.locationId, locationId),
          eq(chatConversations.studentProfileId, studentProfileId),
          ne(chatConversations.status, 'frozen'),
        ),
      )
      .returning({ id: chatConversations.id });

    return frozen.length;
  } catch (error) {
    console.error('[chat] could not freeze conversations on departure', error);
    return 0;
  }
}

/**
 * Seats a member of staff into a desk thread they have just claimed.
 *
 * Separate from the claim itself so the claim stays a single conditional
 * `UPDATE … RETURNING` with nothing else inside its race.
 */
export async function seatClaimant(
  locationId: string,
  conversationId: string,
  schoolUserId: string,
): Promise<void> {
  const existing = await db
    .select({ id: chatParticipants.id })
    .from(chatParticipants)
    .where(
      and(
        eq(chatParticipants.locationId, locationId),
        eq(chatParticipants.conversationId, conversationId),
        eq(chatParticipants.schoolUserId, schoolUserId),
      ),
    )
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(chatParticipants).values({
    locationId,
    conversationId,
    schoolUserId,
    participantRole: 'member',
    canPost: true,
    isStudent: false,
    isParent: false,
  });
}

/**
 * Redacts a message. The body is never cleared — see `chat_messages`.
 *
 * Returns false when the message was already redacted, so a second moderator
 * pressing the same button does not overwrite the first one's reason.
 */
export async function redactMessage(
  locationId: string,
  messageId: string,
  moderatorSchoolUserId: string,
  reason: string,
): Promise<boolean> {
  const redacted = await db
    .update(chatMessages)
    .set({
      redactedAt: new Date(),
      redactedBy: moderatorSchoolUserId,
      redactionReason: reason,
    })
    .where(
      and(
        eq(chatMessages.locationId, locationId),
        eq(chatMessages.id, messageId),
        isNull(chatMessages.redactedAt),
      ),
    )
    .returning({ id: chatMessages.id });

  return redacted.length > 0;
}

/** Every conversation a moderator may review for one pupil. */
export async function conversationsAboutStudent(
  locationId: string,
  studentProfileId: string,
): Promise<{ id: string; subject: string | null; status: string; lastMessageAt: Date | null }[]> {
  return db
    .select({
      id: chatConversations.id,
      subject: chatConversations.subject,
      status: chatConversations.status,
      lastMessageAt: chatConversations.lastMessageAt,
    })
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.locationId, locationId),
        eq(chatConversations.studentProfileId, studentProfileId),
      ),
    );
}

/** Closes a thread for its participants without freezing the record. */
export async function archiveThread(
  locationId: string,
  conversationId: string,
  schoolUserId: string,
): Promise<boolean> {
  const archived = await db
    .update(chatConversations)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(
      and(
        eq(chatConversations.locationId, locationId),
        eq(chatConversations.id, conversationId),
        eq(chatConversations.createdBy, schoolUserId),
        ne(chatConversations.status, 'frozen'),
      ),
    )
    .returning({ id: chatConversations.id });

  return archived.length > 0;
}
