import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { chatConversations } from './chat-conversations';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * chat_participants — who is in a thread, and on what terms.
 *
 * ── The two indexes at the bottom are the whole safeguarding design ───────
 * The brief for this module named four abuses: students flooding one another,
 * making their own groups, passing images around, and passing links to the
 * places they made those groups. Every one of them needs a student to be able
 * to reach another student.
 *
 * So that is not a permission, a setting, or a rule in a resolver. It is:
 *
 *     CREATE UNIQUE INDEX chat_participants_one_student_idx
 *       ON chat_participants (conversation_id) WHERE is_student;
 *
 * At most one student in any conversation, decided by Postgres, on one row,
 * under one lock. There is no administrator toggle that lifts it, no
 * super-admin override, and no path back to student-to-student messaging that
 * does not go through a migration somebody has to write and defend. A resolver
 * can be bypassed by the next route that forgets to call it; this cannot.
 *
 * The parent twin is narrower and the difference matters:
 *
 *     CREATE UNIQUE INDEX chat_participants_one_posting_parent_idx
 *       ON chat_participants (conversation_id) WHERE is_parent AND can_post;
 *
 * At most one parent who can *write*. Both parents may still sit on their
 * child's thread as observers, which is exactly what the parent-visibility rule
 * requires and what a flat "one parent" index would have made impossible.
 *
 * ── `is_student` / `is_parent` are denormalised, and that is the price ────
 * They duplicate `school_users.role`, which is a thing this schema otherwise
 * avoids. It is paid deliberately: a partial index cannot reach through a
 * foreign key, so the alternative to these two columns is no index, and the
 * alternative to the index is a rule in application code. They are written
 * once, at insert, by the one function that seats a participant, and a role
 * change afterwards does not move somebody between these categories — a
 * teacher who becomes a parent gets a new participant row in a new thread, not
 * a rewrite of an old one.
 *
 * ── `can_post` is where the parent's read-only seat lives ─────────────────
 * A participant with `can_post = false` sees everything and writes nothing.
 * That is the parent on their child's thread, and the class teacher and
 * principal seated for audit. `participant_role = 'observer'` says *why* they
 * are there; `can_post` says what they may do, and the two are separate because
 * an observer may later be given the floor without changing what they are.
 *
 * ── The reply window is per participant, and it rolls ─────────────────────
 * `reply_window_expires_at` gates **sending only**. A student whose window has
 * closed can still read the whole thread — they must be able to re-read what a
 * teacher told them about tomorrow's exam.
 *
 * It is reset every time a staff message lands, rather than being a session
 * clock started when the thread opened. A fixed clock produces the case the
 * design exists to avoid: the student asks at 2pm, the window shuts at 3pm, the
 * teacher answers at 10pm, and the student cannot reply — which the teacher
 * reads as being ignored.
 */

/**
 * `owner`    started it, or holds the desk it was addressed to.
 * `member`   an ordinary correspondent.
 * `observer` seated for oversight — a parent on their child's thread, the class
 *            teacher, the principal. Disclosed in the thread header; a covert
 *            observer would be surveillance rather than safeguarding.
 */
export const PARTICIPANT_ROLES = ['owner', 'member', 'observer'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

const participantRoleList = PARTICIPANT_ROLES.map((role) => `'${role}'`).join(', ');

export const chatParticipants = pgTable(
  'chat_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    schoolUserId: uuid('school_user_id')
      .notNull()
      .references(() => schoolUsers.id, { onDelete: 'cascade' }),
    participantRole: text('participant_role').notNull().default('member'),
    /** May they write? False is the parent's and the auditor's seat. */
    canPost: boolean('can_post').notNull().default(true),
    /** Denormalised from the role at insert. See the docblock — index fuel. */
    isStudent: boolean('is_student').notNull().default(false),
    isParent: boolean('is_parent').notNull().default(false),
    /**
     * Until when this participant may send. Null = no window restriction, which
     * is every member of staff and every parent. Only a student carries one.
     */
    replyWindowExpiresAt: timestamp('reply_window_expires_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
    /** Left the thread. Kept rather than deleted: they read what was said. */
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => [
    index('chat_participants_location_id_idx').on(table.locationId),
    uniqueIndex('chat_participants_conversation_user_idx').on(
      table.conversationId,
      table.schoolUserId,
    ),
    // The inbox read, and the unread badge.
    index('chat_participants_user_read_idx').on(table.schoolUserId, table.lastReadAt),
    /**
     * Student-to-student, refused by the database. See the docblock; this is
     * the single most load-bearing line in the chat module.
     */
    uniqueIndex('chat_participants_one_student_idx')
      .on(table.conversationId)
      .where(sql`${table.isStudent}`),
    /**
     * Parent-to-parent, refused the same way — while still permitting both
     * parents to observe their child's thread, because this one is narrowed to
     * the seats that can write.
     */
    uniqueIndex('chat_participants_one_posting_parent_idx')
      .on(table.conversationId)
      .where(sql`${table.isParent} AND ${table.canPost}`),
    check(
      'chat_participants_role_check',
      sql.raw(`participant_role IN (${participantRoleList})`),
    ),
    // A student is never a parent, and neither is ever both.
    check('chat_participants_kind_check', sql`NOT (${table.isStudent} AND ${table.isParent})`),
    // An observer never writes. The reverse is not constrained: a member may be
    // muted by an administrator without ceasing to be a member.
    check(
      'chat_participants_observer_check',
      sql`${table.participantRole} <> 'observer' OR ${table.canPost} = false`,
    ),
  ],
);

export type ChatParticipant = typeof chatParticipants.$inferSelect;
export type NewChatParticipant = typeof chatParticipants.$inferInsert;
