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
 * Phone is required rather than email because invitations go out over WhatsApp;
 * email is the optional fallback channel.
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
    /** Required: the WhatsApp channel for invitations. */
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
    check(
      'school_users_role_check',
      sql.raw(`role IN (${USER_ROLES.map((role) => `'${role}'`).join(', ')})`),
    ),
  ],
);

export type SchoolUser = typeof schoolUsers.$inferSelect;
export type NewSchoolUser = typeof schoolUsers.$inferInsert;
