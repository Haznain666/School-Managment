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
 * `firebase_uid` is null until the person accepts their invite and a Firebase
 * account is created for them, so a row here can represent a pending member as
 * well as an active one.
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
    /** Null until the invite is accepted. */
    firebaseUid: text('firebase_uid').unique(),
    email: text('email'),
    /**
     * The WhatsApp channel, when there is one.
     *
     * Nullable since email authentication: a member invited by email address
     * alone has no number on file, and requiring a placeholder here would put
     * a value in the column that no channel can actually reach.
     */
    phone: text('phone'),
    name: text('name').notNull(),
    role: text('role').notNull(),
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    avatarUrl: text('avatar_url'),
    isActive: boolean('is_active').notNull().default(true),
    /** Firebase uid of whoever sent the invitation. */
    invitedByUid: text('invited_by_uid'),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    /** Set when the invite is accepted and the account becomes usable. */
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('school_users_location_id_idx').on(table.locationId),
    index('school_users_firebase_uid_idx').on(table.firebaseUid),
    index('school_users_location_id_role_idx').on(table.locationId, table.role),
    // A phone number identifies one person within a school, not globally — the
    // same parent may exist at two different schools.
    uniqueIndex('school_users_location_id_phone_idx').on(table.locationId, table.phone),
    check(
      'school_users_role_check',
      sql.raw(`role IN (${USER_ROLES.map((role) => `'${role}'`).join(', ')})`),
    ),
  ],
);

export type SchoolUser = typeof schoolUsers.$inferSelect;
export type NewSchoolUser = typeof schoolUsers.$inferInsert;
