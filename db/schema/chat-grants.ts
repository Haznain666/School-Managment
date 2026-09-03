import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { UserRole } from '@/types/school-auth';

import { branches } from './branches';
import { schoolUsers } from './school-users';
import { schools } from './schools';

/**
 * chat_grants — who may start a conversation, over what, and until when.
 *
 * ── Four features that turned out to be one table ─────────────────────────
 * The brief asked for four separate controls:
 *
 *   · a per-student switch an administrator flips;
 *   · a teacher opening her whole class for two hours;
 *   · the same teacher opening five named pupils instead;
 *   · a principal banning a parent who has abused the service.
 *
 * They are four rows here. A grant names a **scope** (one person, a section, a
 * grade, a campus), an **effect** (allow or deny), and a **window** (`ends_at`
 * null means standing). Nothing else about them differs, so nothing else about
 * them is modelled separately — and the fifth control nobody has asked for yet
 * is another row rather than another migration.
 *
 * ── Precedence, and the trap it exists for ────────────────────────────────
 * Resolution is: **most specific deny, then most specific allow, then the
 * default**, which is reply-only.
 *
 * Deny wins at equal specificity, and that alone is not enough. Consider the
 * case the product owner described: the Principal bans a parent, and a teacher
 * then opens the whole class for an activity. The teacher's allow is *less*
 * specific than the ban, so it loses — but reverse the two and a section-scoped
 * teacher allow would beat a school-scoped principal deny, and the teacher
 * would have quietly un-banned somebody the principal banned.
 *
 * So `granted_by_rank` is compared first: **a grant cannot lift a deny issued
 * by a higher rank, at any specificity.** Without that column a ban is
 * advisory, and the way it fails is silent — nobody is told the ban stopped
 * applying.
 *
 * ── Revoked rather than deleted ───────────────────────────────────────────
 * "Who opened the chat that afternoon, and why" is a question a school will ask
 * after something goes wrong in it. `revoked_at` closes a grant; nothing
 * removes the row. `reason` is required on a deny for the same reason the
 * override reason is a first-class output elsewhere in this product: a ban a
 * parent cannot be told the grounds for is a ban the school cannot defend.
 */

/**
 * What a grant is attached to, most specific first.
 *
 * The order of this array **is** the specificity order — `SCOPE_SPECIFICITY`
 * below derives from it — so reordering it changes resolution. `school_user`
 * and `student` are separate because they are different id spaces: the first is
 * a `school_users.id` (any person, including a parent), the second is a
 * `student_profiles.id`, which is what a class list hands you.
 */
export const GRANT_SCOPE_TYPES = [
  'school_user',
  'student',
  'section',
  'grade',
  'branch',
] as const;
export type GrantScopeType = (typeof GRANT_SCOPE_TYPES)[number];

/** Higher is more specific. Ties are broken by effect, and deny wins a tie. */
export const SCOPE_SPECIFICITY: Record<GrantScopeType, number> = {
  school_user: 50,
  student: 40,
  section: 30,
  grade: 20,
  branch: 10,
};

/**
 * What a grant confers. One member today, and the column is not a boolean
 * because Sprint 25 adds `attach` and the shape should not have to change to
 * take it.
 */
export const GRANT_CAPABILITIES = ['initiate'] as const;
export type GrantCapability = (typeof GRANT_CAPABILITIES)[number];

export const GRANT_EFFECTS = ['allow', 'deny'] as const;
export type GrantEffect = (typeof GRANT_EFFECTS)[number];

/**
 * How much authority each role's grants carry.
 *
 * Not the permission matrix — a coordinator may well hold `chat.grant` and
 * still must not be able to lift a principal's ban. This is a separate,
 * deliberately coarse ordering of *whose word overrides whose*, and it is
 * compiled in rather than configurable because a school able to rank its own
 * principal below its own teachers is a school that has misconfigured the one
 * control that protects a parent from being silenced by the person they are
 * complaining about.
 */
export const GRANT_RANKS: Record<UserRole, number> = {
  school_admin: 100,
  branch_admin: 80,
  principal: 80,
  vice_principal: 60,
  coordinator: 40,
  teacher: 20,
  accountant: 0,
  hr_manager: 0,
  marketing: 0,
  student: 0,
  parent: 0,
};

export function grantRankFor(role: UserRole): number {
  return GRANT_RANKS[role];
}

/** The longest a reason may be. Required on a deny. */
export const GRANT_REASON_MAX = 280;

const scopeList = GRANT_SCOPE_TYPES.map((scope) => `'${scope}'`).join(', ');
const capabilityList = GRANT_CAPABILITIES.map((capability) => `'${capability}'`).join(', ');
const effectList = GRANT_EFFECTS.map((effect) => `'${effect}'`).join(', ');

export const chatGrants = pgTable(
  'chat_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    scopeType: text('scope_type').notNull(),
    /**
     * The id within that scope, as text.
     *
     * Deliberately not a foreign key, and deliberately not five nullable uuid
     * columns. A grant points into five different tables depending on
     * `scope_type`, so a single FK is impossible and five columns would make
     * every read a five-way coalesce over a shape where exactly four are always
     * null. The referential cost is real and is paid where it lands: a grant
     * pointing at a deleted section resolves to nobody, which is the same
     * answer as an expired one.
     */
    scopeId: text('scope_id').notNull(),
    capability: text('capability').notNull().default('initiate'),
    effect: text('effect').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    /** Null = standing. A teacher's class opening always sets one. */
    endsAt: timestamp('ends_at', { withTimezone: true }),
    grantedBy: uuid('granted_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    /** Snapshotted, like a message's sender — a later promotion must not
     * retrospectively strengthen a ban somebody issued as a teacher. */
    grantedByRole: text('granted_by_role').notNull(),
    grantedByRank: integer('granted_by_rank').notNull(),
    reason: text('reason'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => schoolUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chat_grants_location_id_idx').on(table.locationId),
    // The resolver's own read: this school, this scope, live right now.
    index('chat_grants_scope_idx').on(table.locationId, table.scopeType, table.scopeId),
    // The expiry sweep, and the "what is open right now" screen.
    index('chat_grants_location_ends_idx').on(table.locationId, table.endsAt),
    check('chat_grants_scope_type_check', sql.raw(`scope_type IN (${scopeList})`)),
    check('chat_grants_capability_check', sql.raw(`capability IN (${capabilityList})`)),
    check('chat_grants_effect_check', sql.raw(`effect IN (${effectList})`)),
    check(
      'chat_grants_window_check',
      sql`${table.endsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`,
    ),
    // A ban says why. An opening need not.
    check(
      'chat_grants_reason_check',
      sql`(${table.effect} <> 'deny' OR ${table.reason} IS NOT NULL)
          AND (${table.reason} IS NULL OR length(${table.reason}) BETWEEN 1 AND 280)`,
    ),
    check('chat_grants_rank_check', sql`${table.grantedByRank} BETWEEN 0 AND 100`),
  ],
);

export type ChatGrant = typeof chatGrants.$inferSelect;
export type NewChatGrant = typeof chatGrants.$inferInsert;
