import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { concessionSchemes } from './concession-schemes';
import { feeTypes } from './fee-types';
import { schools } from './schools';
import { studentProfiles } from './student-profiles';

export const DISCOUNT_TYPES = ['percentage', 'fixed'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const DISCOUNT_TYPE_LABELS: Record<DiscountType, string> = {
  percentage: 'Percentage',
  fixed: 'Fixed PKR',
};

/**
 * student_concessions — a discount granted to one child.
 *
 * Sibling discounts, staff children and hardship waivers are all the same
 * shape: a percentage or a flat rupee amount, optionally narrowed to one fee
 * head, valid over a window. `applies_to_fee_type_id` being null means **every
 * head, of every category** — which is what a school means by "20% off her
 * fees" with no qualifier. Until Sprint 17 the calculator read null as "every
 * *monthly* head", so an unqualified sibling discount silently never reached
 * the admission, annual or examination fee; this comment was the surviving
 * copy of that bug and is corrected here for that reason.
 *
 * The row is never deleted when it lapses — `valid_until` closes it, so the
 * challans it already discounted stay explainable.
 */
export const studentConcessions = pgTable(
  'student_concessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    studentProfileId: uuid('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'cascade' }),
    /** What the school calls it, e.g. `Sibling discount`. */
    concessionName: text('concession_name').notNull(),
    discountType: text('discount_type').notNull().$type<DiscountType>(),
    /** A percentage (0–100) or a flat PKR amount, per `discount_type`. */
    discountValue: numeric('discount_value', { precision: 10, scale: 2 }).notNull(),
    /**
     * The single head this grant is narrowed to, for rows written before
     * Sprint 18. Null = every fee head, whatever its category.
     *
     * Superseded by `student_concession_fee_types`, which holds a *set*, and
     * deliberately **not backfilled**. `listActiveConcessions` folds this
     * column into the array on the way out, so a legacy row keeps behaving
     * exactly as it did. New grants leave it null and write the join rows.
     */
    appliesToFeeTypeId: uuid('applies_to_fee_type_id').references(() => feeTypes.id, {
      onDelete: 'set null',
    }),
    /**
     * The scheme this grant came from, when it came from one (Sprint 18).
     *
     * Provenance, never a live join: the name, the rate and the dates are
     * copied onto this row at grant time and are what price a voucher. It
     * answers "which policy is this" — which is the question an audit asks and
     * the one nothing could answer before — and never "how much is it worth".
     *
     * `set null` on delete, so removing a scheme leaves every grant it made
     * standing. Deleting a policy is not the same act as taking a discount off
     * four hundred children, and it must not silently be one.
     */
    schemeId: uuid('scheme_id').references(() => concessionSchemes.id, {
      onDelete: 'set null',
    }),
    validFrom: date('valid_from').notNull(),
    /** Null = open ended. */
    validUntil: date('valid_until'),
    /** Firebase uid of the admin who approved it — an audit breadcrumb. */
    approvedByUid: text('approved_by_uid'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('student_concessions_location_id_idx').on(table.locationId),
    index('student_concessions_student_profile_id_idx').on(table.studentProfileId),
    // "Who is on the staff discount, and who already holds this scheme" — the
    // second of those is asked once per student on every bulk apply.
    index('student_concessions_scheme_id_idx').on(table.schemeId),
    check(
      'student_concessions_discount_type_check',
      sql`${table.discountType} IN ('percentage', 'fixed')`,
    ),
  ],
);

export type StudentConcession = typeof studentConcessions.$inferSelect;
export type NewStudentConcession = typeof studentConcessions.$inferInsert;

export function isDiscountType(value: unknown): value is DiscountType {
  return (
    typeof value === 'string' && (DISCOUNT_TYPES as readonly string[]).includes(value)
  );
}
