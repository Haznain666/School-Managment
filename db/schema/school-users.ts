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

import { USER_ROLES } from '@/types/school-auth';

import { branches } from './branches';
import { schools } from './schools';

/**
 * school_users — everyone who can sign in to a school portal.
 *
 * `auth_user_id` is null until the person accepts their invite and a Supabase
 * Auth account exists for them, so a row here can represent a pending member as
 * well as an active one.
 *
 * ── This table is now the authorization record ───────────────────────────
 * Stage 4 moved role, branch and active status out of the token and into this
 * row, read per request. One person has one Supabase account; a row here is
 * their membership of *one* school, which is why the same address can be a
 * teacher at one school and a parent at another. See `lib/school-auth.ts`.
 *
 * ── Phone is required, and is not a channel ──────────────────────────────
 * `phone` is `NOT NULL` and unique per school because it predates Supabase
 * Auth, when invitations went out over WhatsApp and the number was the
 * identity. It is neither now: invitations and sign-in codes go to `email`,
 * and nothing on this platform sends to a phone number. The column stays
 * required because 60-odd rows and every import path depend on it, and it
 * stays unique per tenant because two staff records sharing a number is still
 * a data-entry mistake worth catching.
 */
export const schoolUsers = pgTable(
  'school_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * Supabase `auth.users.id`. Null until the invite is accepted.
     *
     * Deliberately NOT globally unique any more. It was, under Firebase, where
     * each school minted its own derived account. One account per person means
     * the same id legitimately appears once per school they belong to; the
     * uniqueness that matters is per tenant, below.
     */
    authUserId: text('auth_user_id'),
    email: text('email'),
    /** A contact detail. Required, unique per school, never sent to. */
    phone: text('phone').notNull(),
    name: text('name').notNull(),
    role: text('role').notNull(),
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    avatarUrl: text('avatar_url'),
    isActive: boolean('is_active').notNull().default(true),
    /** Auth user id of whoever sent the invitation. */
    invitedByUid: text('invited_by_uid'),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    /** Set when the invite is accepted and the account becomes usable. */
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    /**
     * When a pupil was issued a sign-in credential (Sprint 24).
     *
     * Null for every member of staff and every parent — they arrive through
     * `school_invitations` and `password_setup_tokens`, and `joined_at` already
     * records that. This column is only about the one account type that has no
     * invitation flow: a pupil, whose address is minted by the school rather
     * than supplied by them.
     *
     * The address itself lives in `email` above, deliberately and not in a
     * column of its own. A second address column would be a second thing for
     * the login lookup to disagree with, and `STATE.md` §5bk is the incident
     * report about what that costs — a father permanently signed in as his own
     * daughter. One address column means `0038`'s partial unique index protects
     * a pupil's identity exactly as it protects everyone else's.
     */
    studentCredentialIssuedAt: timestamp('student_credential_issued_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('school_users_location_id_idx').on(table.locationId),
    index('school_users_auth_user_id_idx').on(table.authUserId),
    index('school_users_location_id_role_idx').on(table.locationId, table.role),
    // A phone number identifies one person within a school, not globally — the
    // same parent may exist at two different schools.
    uniqueIndex('school_users_location_id_phone_idx').on(table.locationId, table.phone),
    // The lookup `lib/school-auth.ts` performs on every authenticated request,
    // and the constraint that stops one account holding two memberships of the
    // same school. Both halves matter.
    uniqueIndex('school_users_location_id_auth_user_id_idx').on(
      table.locationId,
      table.authUserId,
    ),
    /*
     * One email is one person at one school. Migration `0038`.
     *
     * Nothing forbade the ambiguity until Sprint 21, and what it cost was a
     * father with five children at LGS. A student's directory row had borrowed
     * his mobile back when it did that, the parent-portal upsert on
     * (location, phone) therefore landed on his daughter's row and wrote his
     * address onto it, and when he accepted his invite GoTrue bound his uid
     * there. The unique auth index above then made it permanent: his uid could
     * never also sit on his own `parent` row, so every sign-in put him in the
     * *student* portal as one of his own children, and four of his five
     * children were unreachable by any login he had.
     *
     * Two things made it invisible rather than loud. `otp/verify` updated
     * every row matching the address and kept whichever the auth index allowed;
     * `getSchoolUserByUid` was an unordered `limit(1)`. Both answered
     * confidently. Neither had any way to say it had chosen.
     *
     * ── Partial, and scoped to the active ────────────────────────────────
     * `lower(email)` because `Father@Example.com` and `father@example.com` are
     * one inbox, and a constraint that let both in would be a constraint that
     * only catches the careful. Deactivated rows are outside it on purpose: a
     * teacher who left in June and is re-hired in September must not be blocked
     * by her own archived membership, and blank is outside it because
     * `school_users.email` is nullable and a school with forty staff who have
     * no address is normal.
     *
     * Drizzle cannot express a partial expression index in a way `db:generate`
     * will reproduce, so `0038` writes it by hand and this declaration exists
     * to keep the schema file honest about what is on the table.
     */
    uniqueIndex('school_users_location_email_active_idx')
      .on(table.locationId, sql`lower(${table.email})`)
      .where(sql`${table.email} is not null and ${table.email} <> '' and ${table.isActive}`),
    check(
      'school_users_role_check',
      sql.raw(`role IN (${USER_ROLES.map((role) => `'${role}'`).join(', ')})`),
    ),
  ],
);

export type SchoolUser = typeof schoolUsers.$inferSelect;
export type NewSchoolUser = typeof schoolUsers.$inferInsert;
