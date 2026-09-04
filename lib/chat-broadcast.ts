import 'server-only';

import { and, eq, inArray, or, type SQL } from 'drizzle-orm';

import { chatBroadcasts, MAX_BROADCAST_RECIPIENTS } from '@/db/schema/chat-broadcasts';
import { chatConversations } from '@/db/schema/chat-conversations';
import { grades } from '@/db/schema/grades';
import { schoolUsers } from '@/db/schema/school-users';
import { sections } from '@/db/schema/sections';
import { studentEnrollments } from '@/db/schema/student-enrollments';
import { studentGuardians } from '@/db/schema/student-guardians';
import { studentProfiles } from '@/db/schema/student-profiles';
import type { UserRole } from '@/types/school-auth';

import { getActiveAcademicYear } from './admissions-queries';
import { contactWindowProblem, resolveGrant } from './chat-permissions';
import { getChatSchoolSettings, liveGrantsFor, scopesFor } from './chat-queries';
import { openThread } from './chat-threads';
import { db } from './drizzle';

/**
 * Compose once, deliver to thirty people, and never make a group out of it.
 *
 * ── The shape, and why it could not be anything else ─────────────────────
 * A teacher with a class of thirty should not write thirty times. That is the
 * whole request, and it is a request about *composing*, not about a room.
 *
 * A genuine thirty-person thread is not something this schema can hold:
 * `chat_participants_one_student_idx` makes a second pupil in a conversation a
 * `23505`, and that index is the control that makes pupil-to-pupil messaging
 * impossible rather than merely disallowed. Relaxing it to build a class group
 * would trade the module's one hard guarantee for a convenience.
 *
 * So the send **fans out**: N ordinary `direct` conversations, each private
 * between the sender and one recipient, each carrying `broadcast_id` back to
 * the composition. No recipient ever learns who else received it, because there
 * is no query that would tell them — they are not participants in each other's
 * threads. Replies come back individually, which is what a teacher asking a
 * class a question actually wants.
 *
 * ── A refusal is a skip, not a failure ───────────────────────────────────
 * Every recipient goes through `initiateProblem` on their own. A pupil under a
 * live ban, an account deactivated between the picker rendering and Send being
 * pressed — each is **skipped with a reason the sender is shown**, and the rest
 * of the send proceeds.
 *
 * The alternative is a broadcast to thirty that fails because one of them is
 * banned, which is a screen a teacher would learn to fight rather than use.
 *
 * ── Sequential, and chunked ──────────────────────────────────────────────
 * Thirty recipients is thirty transactions — a conversation, its seats and its
 * first message each time. `Promise.all` over that on a shared plan is how one
 * teacher's class message makes every other school's page slow. The same
 * reasoning `sendAnnouncement` gives for sending sequentially.
 */

export interface BroadcastRecipient {
  schoolUserId: string;
  name: string;
}

export interface BroadcastSkip {
  name: string;
  reason: string;
}

export interface BroadcastOutcome {
  broadcastId: string;
  sent: number;
  skipped: BroadcastSkip[];
}

export type BroadcastResult =
  | { ok: true; outcome: BroadcastOutcome }
  | { ok: false; problem: string };

export interface BroadcastInput {
  locationId: string;
  actor: { schoolUserId: string; name: string; role: UserRole; branchId: string | null };
  sectionIds: string[];
  studentProfileIds: string[];
  includeStudents: boolean;
  includeParents: boolean;
  subject: string | null;
  body: string;
}

/**
 * The pupils a broadcast is aimed at, resolved from sections and named pupils.
 *
 * Both inputs are untrusted. Sections are checked against the sender's reach by
 * the caller (`grantScopeProblem` for a teacher); the pupils named individually
 * are constrained here to those actually enrolled in this school and year, so a
 * crafted `studentProfileIds` cannot reach a pupil at another campus.
 */
async function resolveStudents(
  locationId: string,
  academicYearId: string,
  sectionIds: readonly string[],
  studentProfileIds: readonly string[],
): Promise<{ studentProfileId: string; schoolUserId: string; name: string }[]> {
  if (sectionIds.length === 0 && studentProfileIds.length === 0) return [];

  /*
   * Sections OR named pupils, not both-as-an-AND. A teacher who picks 7-B and
   * then also ticks two pupils from 7-C means "these thirty-two people"; an
   * AND would silently mean "nobody", which is the shape of bug that looks
   * like the feature not working at all.
   */
  const clauses: SQL[] = [];
  if (sectionIds.length > 0) {
    clauses.push(inArray(studentEnrollments.sectionId, [...sectionIds]));
  }
  if (studentProfileIds.length > 0) {
    clauses.push(inArray(studentProfiles.id, [...studentProfileIds]));
  }

  const selection = clauses.length === 1 ? clauses[0] : or(...clauses);

  const rows = await db
    .selectDistinct({
      studentProfileId: studentProfiles.id,
      schoolUserId: studentProfiles.schoolUserId,
      name: schoolUsers.name,
    })
    .from(studentEnrollments)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentEnrollments.studentProfileId))
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentProfiles.schoolUserId))
    .where(
      and(
        eq(studentEnrollments.locationId, locationId),
        eq(studentEnrollments.academicYearId, academicYearId),
        eq(studentEnrollments.status, 'active'),
        eq(schoolUsers.isActive, true),
        selection,
      ),
    );

  return rows;
}

/** The guardians of a set of pupils, deduplicated — one parent, one message. */
async function guardiansOf(
  locationId: string,
  studentProfileIds: readonly string[],
): Promise<BroadcastRecipient[]> {
  if (studentProfileIds.length === 0) return [];

  const rows = await db
    .selectDistinct({
      schoolUserId: studentGuardians.schoolUserId,
      name: schoolUsers.name,
    })
    .from(studentGuardians)
    .innerJoin(schoolUsers, eq(schoolUsers.id, studentGuardians.schoolUserId))
    .where(
      and(
        eq(studentGuardians.locationId, locationId),
        inArray(studentGuardians.studentProfileId, [...studentProfileIds]),
        eq(schoolUsers.isActive, true),
      ),
    );

  // A parent with three children in the selection gets one message, not three.
  const seen = new Set<string>();
  const out: BroadcastRecipient[] = [];

  for (const row of rows) {
    if (row.schoolUserId === null || seen.has(row.schoolUserId)) continue;
    seen.add(row.schoolUserId);
    out.push({ schoolUserId: row.schoolUserId, name: row.name });
  }

  return out;
}

/** "Class 7-B", "5 students and their parents" — what the sender is shown. */
function describeScope(input: {
  sectionLabels: string[];
  namedStudents: number;
  includeStudents: boolean;
  includeParents: boolean;
}): string {
  const who = input.sectionLabels.length > 0
    ? input.sectionLabels.join(', ')
    : `${String(input.namedStudents)} student${input.namedStudents === 1 ? '' : 's'}`;

  if (input.includeStudents && input.includeParents) return `${who} and their parents`;
  if (input.includeParents) return `Parents of ${who}`;
  return who;
}

export async function sendBroadcast(input: BroadcastInput): Promise<BroadcastResult> {
  const body = input.body.trim();
  if (body === '') return { ok: false, problem: 'Write a message first.' };
  if (!input.includeStudents && !input.includeParents) {
    return { ok: false, problem: 'Choose whether this goes to the students, their parents, or both.' };
  }

  const year = await getActiveAcademicYear(input.locationId);
  if (year === null) {
    return { ok: false, problem: 'There is no active academic year to send to.' };
  }

  const students = await resolveStudents(
    input.locationId,
    year.id,
    input.sectionIds,
    input.studentProfileIds,
  );

  if (students.length === 0) {
    return { ok: false, problem: 'That selection has nobody in it.' };
  }

  const settings = await getChatSchoolSettings(input.locationId);

  // Checked once, before anything is opened. A broadcast to pupils at eleven at
  // night is refused whole rather than opening thirty threads and then
  // discovering the hour on each of them.
  if (input.includeStudents) {
    const hours = contactWindowProblem(
      new Date(),
      settings.studentContactFrom,
      settings.studentContactTo,
    );
    if (hours !== null) return { ok: false, problem: hours };
  }

  const studentRecipients: BroadcastRecipient[] = input.includeStudents
    ? students.map((s) => ({ schoolUserId: s.schoolUserId, name: s.name }))
    : [];

  const parentRecipients = input.includeParents
    ? await guardiansOf(input.locationId, students.map((s) => s.studentProfileId))
    : [];

  const recipients = [...studentRecipients, ...parentRecipients];

  if (recipients.length > MAX_BROADCAST_RECIPIENTS) {
    return {
      ok: false,
      problem:
        `That reaches ${String(recipients.length)} people. One message can go to at most ` +
        `${String(MAX_BROADCAST_RECIPIENTS)} — narrow the selection.`,
    };
  }

  const sectionLabels = await labelSections(input.locationId, input.sectionIds);

  const created = await db
    .insert(chatBroadcasts)
    .values({
      locationId: input.locationId,
      branchId: input.actor.branchId,
      sentBy: input.actor.schoolUserId,
      sentByName: input.actor.name,
      subject: input.subject,
      body,
      scopeLabel: describeScope({
        sectionLabels,
        namedStudents: students.length,
        includeStudents: input.includeStudents,
        includeParents: input.includeParents,
      }).slice(0, 120),
    })
    .returning({ id: chatBroadcasts.id });

  const broadcastId = created[0]?.id;
  if (broadcastId === undefined) {
    throw new Error('chat: the broadcast insert returned no row');
  }

  const skipped: BroadcastSkip[] = [];
  let sent = 0;

  // Sequential. Thirty recipients is thirty transactions, and running them at
  // once on a shared plan is how one class message slows every other school.
  for (const recipient of recipients) {
    const result = await openThread({
      locationId: input.locationId,
      actor: input.actor,
      target: { kind: 'person', id: recipient.schoolUserId },
      subject: input.subject,
      body,
    });

    if (result.ok) {
      sent += 1;
      await db
        .update(chatConversations)
        .set({ broadcastId })
        .where(
          and(
            eq(chatConversations.locationId, input.locationId),
            eq(chatConversations.id, result.conversationId),
          ),
        );
    } else {
      skipped.push({ name: recipient.name, reason: result.problem });
    }
  }

  await db
    .update(chatBroadcasts)
    .set({ recipientCount: sent, skippedCount: skipped.length })
    .where(eq(chatBroadcasts.id, broadcastId));

  return { ok: true, outcome: { broadcastId, sent, skipped } };
}

/** "7-B", for the scope label. */
async function labelSections(
  locationId: string,
  sectionIds: readonly string[],
): Promise<string[]> {
  if (sectionIds.length === 0) return [];

  const rows = await db
    .select({ gradeName: grades.name, sectionName: sections.name })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(eq(sections.locationId, locationId), inArray(sections.id, [...sectionIds])),
    );

  return rows.map((row) => `${row.gradeName} ${row.sectionName}`);
}

/**
 * Whether a pupil is under a live *deny*, as opposed to merely not granted.
 *
 * Not used by the fan-out — `initiateProblem` covers it — but exported because
 * the composer wants to grey out a banned pupil before the teacher writes three
 * paragraphs, and `resolveGrant(...).allowed === false` is the wrong test for
 * that: it is false for almost every pupil almost always, since reply-only is
 * the default. The question the picker is asking is "has somebody banned this
 * person", which is `matched.effect === 'deny'`.
 */
export async function isBanned(
  locationId: string,
  schoolUserId: string,
): Promise<boolean> {
  const scopes = await scopesFor(locationId, schoolUserId);
  const decision = resolveGrant(await liveGrantsFor(locationId, scopes), scopes);
  return decision.matched !== null && decision.matched.effect === 'deny';
}
