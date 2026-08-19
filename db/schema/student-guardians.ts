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

import { schoolUsers } from './school-users';
import { schools } from './schools';
import { studentProfiles } from './student-profiles';

export const GUARDIAN_RELATIONSHIPS = [
  'father',
  'mother',
  'guardian',
  'sibling',
  'other',
] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export const GUARDIAN_RELATIONSHIP_LABELS: Record<GuardianRelationship, string> = {
  father: 'Father',
  mother: 'Mother',
  guardian: 'Guardian',
  sibling: 'Sibling',
  other: 'Other',
};

/**
 * student_guardians — who the school contacts about a child.
 *
 * `school_user_id` is nullable on purpose: most guardians are recorded during
 * admission and never sign in, and a school must be able to hold a father's
 * phone number without provisioning him a portal account. When he is later
 * invited, this is the row that links his login to his children — which is how
 * the parent portal finds them.
 *
 * Exactly one guardian per student carries `is_primary_contact`; the API
 * demotes the incumbent rather than letting two rows claim it.
 */
export const studentGuardians = pgTable(
  'student_guardians',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    studentProfileId: uuid('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'cascade' }),
    /** Null when this guardian has no portal account. */
    schoolUserId: uuid('school_user_id').references(() => schoolUsers.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    relationship: text('relationship').notNull().$type<GuardianRelationship>(),
    /** E.164, normalised by `lib/phone.ts`. The WhatsApp channel. */
    phone: text('phone').notNull(),
    email: text('email'),
    cnic: text('cnic'),
    occupation: text('occupation'),
    isPrimaryContact: boolean('is_primary_contact').notNull().default(false),
    /**
     * When the parent-portal welcome was queued for this guardian.
     *
     * The marker is on the guardian and not on the student because a family
     * with three children at the school must not receive three welcomes to the
     * same portal — one account covers all of them. It is also what makes the
     * fee gate safely re-runnable: a second payment against a second challan
     * re-enters the same code path, finds this set, and sends nothing.
     */
    welcomeEmailSentAt: timestamp('welcome_email_sent_at', { withTimezone: true }),
    /** GHL contact this guardian is mirrored to. Null until the sync succeeds. */
    ghlContactId: text('ghl_contact_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('student_guardians_location_id_idx').on(table.locationId),
    index('student_guardians_student_profile_id_idx').on(table.studentProfileId),
    index('student_guardians_school_user_id_idx').on(table.schoolUserId),
    check(
      'student_guardians_relationship_check',
      sql`${table.relationship} IN ('father', 'mother', 'guardian', 'sibling', 'other')`,
    ),
  ],
);

export type StudentGuardian = typeof studentGuardians.$inferSelect;
export type NewStudentGuardian = typeof studentGuardians.$inferInsert;

export function isGuardianRelationship(
  value: unknown,
): value is GuardianRelationship {
  return (
    typeof value === 'string' &&
    (GUARDIAN_RELATIONSHIPS as readonly string[]).includes(value)
  );
}
