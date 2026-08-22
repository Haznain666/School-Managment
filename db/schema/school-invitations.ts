import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { USER_ROLES } from '@/types/school-auth';

import { branches } from './branches';
import { schools } from './schools';

/** How long an invite link stays usable. */
export const INVITE_TTL_HOURS = 72;

/**
 * school_invitations — pending membership offers.
 *
 * The `token` is the credential: anyone holding it can complete the signup,
 * which is why it is 32 random bytes, unique, and expires in 72 hours.
 *
 * Cancelling an invite sets `expires_at` to now rather than deleting the row,
 * so the audit trail of who invited whom survives.
 */
export const schoolInvitations = pgTable(
  'school_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /**
     * Where the invitation goes. The only channel there is.
     *
     * Nullable in the column because rows predate the rule; the API has
     * refused a blank address since Stage 4 and refuses one now.
     */
    email: text('email'),
    /**
     * A contact detail, not a channel and not an identity.
     *
     * Nothing is sent here. It is `NOT NULL` because `school_users.phone` is,
     * and the accepted invitation writes one from the other.
     */
    phone: text('phone').notNull(),
    role: text('role').notNull(),
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    invitedByUid: text('invited_by_uid').notNull(),
    /** 32 random bytes, hex encoded. This is the credential. */
    token: text('token').notNull().unique(),
    /**
     * The invitation email reached `email_outbox`.
     *
     * Not "SMTP accepted it" — the drainer discovers that later and records it
     * on the outbox row. The UI says "Email queued" for exactly this reason.
     */
    emailSent: boolean('email_sent').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('school_invitations_location_id_idx').on(table.locationId),
    index('school_invitations_token_idx').on(table.token),
    index('school_invitations_expires_at_idx').on(table.expiresAt),
    check(
      'school_invitations_role_check',
      sql.raw(`role IN (${USER_ROLES.map((role) => `'${role}'`).join(', ')})`),
    ),
  ],
);

export type SchoolInvitation = typeof schoolInvitations.$inferSelect;
export type NewSchoolInvitation = typeof schoolInvitations.$inferInsert;

/** Expiry timestamp for a newly created or resent invitation. */
export function inviteExpiryFromNow(): Date {
  return new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
}
