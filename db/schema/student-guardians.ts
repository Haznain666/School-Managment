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
 * How a guardian is described on screen.
 *
 * `other` alone is not a description — it is the absence of one — so the
 * school's own words replace it wherever a relationship is shown. Defined here
 * rather than in a component because the enrolment review, the guardian panel,
 * the parent portal and the sibling card all render it, and a second copy of
 * this rule is a second place for a bare "Other" to leak out.
 */
export function relationshipLabel(guardian: {
  relationship: GuardianRelationship;
  relationshipOther: string | null;
}): string {
  if (guardian.relationship === 'other') {
    const words = (guardian.relationshipOther ?? '').trim();
    if (words !== '') return words;
  }

  return GUARDIAN_RELATIONSHIP_LABELS[guardian.relationship];
}

/**
 * What the *first* guardian on a record may be.
 *
 * A child's first recorded guardian is the person the school holds responsible
 * for them, and "Other" is not an answer to that — it is the absence of one.
 * Recording an uncle as the first guardian and describing him nowhere is how a
 * record ends up with a phone number and no idea whose it is.
 *
 * `guardian` belongs in this set and was missing from it until Sprint 17. A
 * legal guardian *is* the person the school holds responsible — for an orphaned
 * child or a child living with relatives there is nobody else — and refusing
 * the row forced the admissions desk to record that person as "Other", which is
 * the one answer this list exists to exclude, or as a father they are not.
 *
 * The narrower set is enforced on the form and again in `parseGuardians`, and
 * deliberately not by a database constraint: rows written before this rule
 * existed are legitimate history, and a check constraint would refuse the next
 * unrelated write to any of them.
 */
export const FIRST_GUARDIAN_RELATIONSHIPS = [
  'father',
  'mother',
  'guardian',
  'sibling',
] as const satisfies readonly GuardianRelationship[];

/**
 * The permitted first relationships, written out for a message to a person.
 *
 * Derived from `FIRST_GUARDIAN_RELATIONSHIPS` rather than typed out beside it.
 * Sprint 17 added `guardian` to that list and left four hand-written copies of
 * "father, mother or sibling" behind in the API, the form and the enrolment
 * parser — so the product accepted a legal guardian and then told the clerk who
 * chose one that it would not. A message that contradicts the rule it is
 * explaining is worse than no message.
 */
export function firstGuardianChoices(): string {
  const labels = FIRST_GUARDIAN_RELATIONSHIPS.map(
    (relationship) => GUARDIAN_RELATIONSHIP_LABELS[relationship].toLowerCase(),
  );

  const last = labels[labels.length - 1];
  return `${labels.slice(0, -1).join(', ')} or ${last}`;
}

/**
 * The relationships only one guardian per student may hold.
 *
 * A child has one father and one mother. Two rows claiming either is not a
 * family arrangement this product needs to model — it is a duplicate, and the
 * duplicate is what would later split one family into two on the sibling
 * lookup and the family voucher.
 */
export const SINGLETON_RELATIONSHIPS = [
  'father',
  'mother',
] as const satisfies readonly GuardianRelationship[];

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
    /**
     * How this person is related, in their own words. Only for `other`.
     *
     * "Other" on its own records nothing a teacher ringing this number could
     * use. The five fixed values cover the cases a school has a policy about;
     * this covers the uncle, the sponsor and the elder cousin, and is required
     * by the API whenever `relationship` is `other` — which is why it is
     * nullable in the column and not in the write path. Every row written
     * before this existed has it null, and those rows are not rewritten.
     */
    relationshipOther: text('relationship_other'),
    /** E.164, normalised by `lib/phone.ts`. A contact detail, not a channel. */
    phone: text('phone').notNull(),
    email: text('email'),
    /**
     * The guardian's CNIC / Smart Card, as `42101-1234567-1`.
     *
     * ── This is an identity key now, not a note ─────────────────────────
     * Two enrolled children are siblings when they share a guardian, and this
     * is what "the same guardian" means — see `lib/siblings.ts`. A name is
     * spelled three ways in every real school's data and a phone number is
     * shared by a household rather than owned by a person, so neither can
     * carry that. A CNIC is issued once, to one person, for life.
     *
     * Stored in exactly one spelling. `normalizeCnic` in `lib/national-id.ts`
     * is the only thing that writes it, migration `0026` normalised the rows
     * that predate the rule, and `CnicField` is the only field that collects
     * it. Null stays perfectly legal: a school must be able to enrol a child
     * whose parent left the card at home.
     */
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
    // The sibling lookup and the guardian-by-CNIC prefill both enter through
    // (location, cnic). Without this they are a sequential scan of every
    // guardian in the school on a screen an admissions clerk is waiting on.
    index('student_guardians_location_cnic_idx').on(table.locationId, table.cnic),
    // The same, for the phone half of the sibling rule and for the family
    // voucher's grouping.
    index('student_guardians_location_phone_idx').on(table.locationId, table.phone),
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
