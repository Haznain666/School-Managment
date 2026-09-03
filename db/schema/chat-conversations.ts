import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { schoolUsers } from './school-users';
import { schools } from './schools';
import { studentProfiles } from './student-profiles';

/**
 * chat_conversations — a thread, and the institutional reason it exists.
 *
 * ── Correspondence, not chat ──────────────────────────────────────────────
 * The distinction this table is built around: a conversation cannot exist
 * unless something in the school's own data justifies it. Reachability is
 * *derived* — who teaches you, whose child you are, which desk owes you an
 * answer — and `lib/chat-permissions.ts` derives it. Nothing here is a contact
 * list, and there is deliberately no screen anywhere that answers "show me
 * everybody".
 *
 * That is why the abuse this module was specified to prevent — students
 * flooding each other, forming their own groups, passing images and links
 * around — has no surface to happen on. Every one of those needs student-to-
 * student reachability, and `chat_participants` makes that a `23505` rather
 * than a policy. See the partial unique indexes there; they are the
 * load-bearing part of this design.
 *
 * ── Two kinds in Sprint 24 ────────────────────────────────────────────────
 * `direct`      one thread between named people.
 * `role_inbox`  a thread addressed to a *desk* — Accounts, Admissions, the
 *               front office — which any staff member holding that role at that
 *               branch may claim.
 *
 * `group` and `announcement` are Sprint 25 and are absent from the CHECK on
 * purpose: `ROADMAP.md` settled that an announcement channel is one-way, and
 * that a class notice to 400 parents must not be a group chat 400 people can
 * reply into. A kind that exists before the code that constrains it is an
 * invitation to create one of those by hand.
 *
 * ── Why a role inbox rather than a named clerk ────────────────────────────
 * A parent asks the Accounts Office, not one clerk by name. When that clerk
 * leaves, the thread survives and the next person opens it. `claimed_by`
 * records who picked it up, and the claim is a conditional `UPDATE … RETURNING`
 * — production runs seven Node processes (`CLAUDE.md`, "background work is
 * claimed, not checked"), and three clerks with the same inbox open in a
 * browser is that same race.
 *
 * ── `student_profile_id` is what makes safeguarding resolvable ────────────
 * The child a thread is *about*, which is not the same as a participant: a fee
 * thread between a parent and Accounts concerns a child who is in no position
 * to read it. It is what seats the class teacher and the principal as
 * observers, what shows a parent their child's threads, and what the withdrawal
 * freeze finds. Without it, "which conversations concern this pupil" is a
 * question the schema cannot answer.
 */

export const CONVERSATION_KINDS = ['direct', 'role_inbox'] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

/**
 * `open`     ordinary.
 * `frozen`   read-only and kept. A student left, or an administrator stopped it.
 * `archived` closed by a participant; still writable if reopened.
 *
 * There is no `deleted`. A withdrawal must not be a way to erase a safeguarding
 * record, which is the same argument `CLAUDE.md` makes for the ledger being
 * append-only: the answer to a dispute in March is what was written in October.
 */
export const CONVERSATION_STATUSES = ['open', 'frozen', 'archived'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/**
 * The desks a parent may write to, and who answers each.
 *
 * Keyed by a slug rather than by role, because a desk is not a role: the office
 * is answered by whoever is on it, and at a small school that is the same person
 * who answers Accounts. `claimableBy` is who may *claim*, and `school_admin` may
 * claim any of them because at some schools they are all of them.
 */
export const ROLE_INBOXES = [
  {
    key: 'office',
    label: 'School Office',
    claimableBy: ['school_admin', 'branch_admin', 'coordinator'],
  },
  {
    key: 'accounts',
    label: 'Accounts Office',
    claimableBy: ['school_admin', 'branch_admin', 'accountant'],
  },
  {
    key: 'admissions',
    label: 'Admissions',
    claimableBy: ['school_admin', 'branch_admin', 'coordinator', 'marketing'],
  },
  {
    key: 'principal',
    label: 'Principal Office',
    claimableBy: ['school_admin', 'principal', 'vice_principal'],
  },
] as const;

export type RoleInbox = (typeof ROLE_INBOXES)[number];
export type RoleInboxKey = RoleInbox['key'];

export const ROLE_INBOX_KEYS: readonly RoleInboxKey[] = ROLE_INBOXES.map((inbox) => inbox.key);

export function isRoleInboxKey(value: unknown): value is RoleInboxKey {
  return typeof value === 'string' && (ROLE_INBOX_KEYS as readonly string[]).includes(value);
}

export function roleInboxLabel(key: RoleInboxKey): string {
  return ROLE_INBOXES.find((inbox) => inbox.key === key)?.label ?? key;
}

/** Longest a thread subject may be. Enforced by the API as well as here. */
export const CONVERSATION_SUBJECT_MAX = 140;

const kindList = CONVERSATION_KINDS.map((kind) => `'${kind}'`).join(', ');
const statusList = CONVERSATION_STATUSES.map((status) => `'${status}'`).join(', ');
const inboxList = ROLE_INBOX_KEYS.map((key) => `'${key}'`).join(', ');

export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /** The campus this thread belongs to. Null = school-wide. */
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    subject: text('subject'),
    /**
     * The child this thread is about. Null for a staff-to-staff thread and for
     * a parent's question that concerns no particular pupil.
     *
     * `set null` rather than cascade: deleting a pupil's profile must not take
     * the record of what was said about them with it.
     */
    studentProfileId: uuid('student_profile_id').references(() => studentProfiles.id, {
      onDelete: 'set null',
    }),
    /** Which desk, when `kind = 'role_inbox'`. Null otherwise. */
    roleInbox: text('role_inbox'),
    /** Who picked the desk thread up. Null while unclaimed. */
    claimedBy: uuid('claimed_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    status: text('status').notNull().default('open'),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
    frozenReason: text('frozen_reason'),
    createdBy: uuid('created_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    /**
     * Denormalised for inbox ordering, and written **in the same transaction as
     * the message** via `batch(db, …)`. An inbox sorted by a subquery over
     * `chat_messages` is the one query in this module that every user of the
     * school would run on every page load at once.
     */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chat_conversations_location_id_idx').on(table.locationId),
    // The inbox's own ordering.
    index('chat_conversations_location_last_message_idx').on(
      table.locationId,
      table.lastMessageAt,
    ),
    // "Which threads concern this pupil" — the safeguarding and freeze read.
    index('chat_conversations_student_profile_idx').on(table.studentProfileId),
    // The unclaimed-desk queue.
    index('chat_conversations_role_inbox_idx').on(
      table.locationId,
      table.roleInbox,
      table.claimedBy,
    ),
    check('chat_conversations_kind_check', sql.raw(`kind IN (${kindList})`)),
    check('chat_conversations_status_check', sql.raw(`status IN (${statusList})`)),
    check(
      'chat_conversations_role_inbox_check',
      sql.raw(
        `(kind = 'role_inbox') = (role_inbox IS NOT NULL) ` +
          `AND (role_inbox IS NULL OR role_inbox IN (${inboxList}))`,
      ),
    ),
    // A frozen thread carries the moment it froze, and nothing else does.
    check(
      'chat_conversations_frozen_check',
      sql`(${table.status} = 'frozen') = (${table.frozenAt} IS NOT NULL)`,
    ),
    check(
      'chat_conversations_subject_check',
      sql`${table.subject} IS NULL OR length(${table.subject}) BETWEEN 1 AND 140`,
    ),
  ],
);

export type ChatConversation = typeof chatConversations.$inferSelect;
export type NewChatConversation = typeof chatConversations.$inferInsert;
