import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * super_admin_users — the people who operate the platform. Sprint 35, §9.
 *
 * ── Why a table, when there was one operator in an env var ───────────────
 * `SUPER_ADMIN_EMAIL` and a bcrypt hash in the host's panel was one account,
 * editable only by whoever could reach the panel, with no way to give a second
 * person less than everything. The product now has a second person, and the
 * only honest place for "who may do what above the tenants" is a table the
 * owner can edit from a screen.
 *
 * The environment credential is not deleted. It is the owner's way back in if
 * this table cannot be read — see `lib/super-admin-credentials.ts` — and it is
 * what `scripts/apply-0052.mjs` seeds the owner's row from.
 *
 * ── No `location_id`, deliberately ───────────────────────────────────────
 * A super admin belongs to no school; that is the definition. The same
 * exception `scheduler_leases` makes, for the same reason: inventing a tenant
 * for a row that has none would let a tenant filter somewhere include or
 * exclude an operator by accident.
 *
 * ── The owner is protected by the database, not only by the API ──────────
 * `0052` installs `super_admin_users_protect_owner`, a trigger that refuses to
 * delete, deactivate, demote or re-address the owner's row, and refuses to
 * promote anybody else. The API refuses the same things first, with a sentence;
 * the trigger is what makes it true for a hand-typed `UPDATE` too. The partial
 * unique index below makes "one owner" a constraint rather than a habit.
 *
 * ── `permissions` is jsonb, and read through one function ────────────────
 * `{ "schools": { "c": true, "r": true, "u": false, "d": false }, … }`. Read
 * only through `normaliseSuperAdminPermissions`, which drops anything it does
 * not recognise — so a row can never grant more than it spells out. The
 * owner's own value is ignored: `is_owner` holds everything.
 */
export const superAdminUsers = pgTable(
  'super_admin_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Lowercased and trimmed on write; the CHECK makes that a guarantee. */
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** bcrypt, cost 12. Never returned by any route. */
    passwordHash: text('password_hash').notNull(),
    isOwner: boolean('is_owner').notNull().default(false),
    permissions: jsonb('permissions').notNull().default(sql`'{}'::jsonb`),
    isActive: boolean('is_active').notNull().default(true),
    /** The super admin who created this row, by address. Null for the seed. */
    createdBy: text('created_by'),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('super_admin_users_email_idx').on(table.email),
    // One owner, ever. A second `is_owner = true` row is a 23505.
    uniqueIndex('super_admin_users_one_owner_idx')
      .on(table.isOwner)
      .where(sql`${table.isOwner}`),
    index('super_admin_users_is_active_idx').on(table.isActive),
    check('super_admin_users_email_lower_check', sql`${table.email} = lower(btrim(${table.email}))`),
    check('super_admin_users_email_shape_check', sql`${table.email} LIKE '%_@_%'`),
    check('super_admin_users_name_check', sql`btrim(${table.name}) <> ''`),
  ],
);

export type SuperAdminUser = typeof superAdminUsers.$inferSelect;
export type NewSuperAdminUser = typeof superAdminUsers.$inferInsert;
