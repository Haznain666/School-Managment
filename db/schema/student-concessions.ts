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
    /** Null = every fee head, whatever its category. */
    appliesToFeeTypeId: uuid('applies_to_fee_type_id').references(() => feeTypes.id, {
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
