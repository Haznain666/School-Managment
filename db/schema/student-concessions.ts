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
  fixed: 'Fixed amount',
};

/**
 * student_concessions — a discount granted to one child.
 *
 * Sibling discounts, merit scholarships and need-based waivers are ordinary in
 * Pakistani schools, and they are per student rather than per grade, which is
 * why they cannot live in `fee_structures`.
 *
 * `applies_to_fee_type_id` null means the concession applies to tuition only —
 * the common case, and the one a school means when it says "20% off". A school
 * that wants a transport discount names that fee head explicitly.
 *
 * `valid_from` / `valid_until` are dates rather than a boolean because a
 * concession granted mid-session must not retroactively alter challans already
 * issued, and a scholarship that lapses in June should stop applying in July
 * without anyone remembering to switch it off.
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
    concessionName: text('concession_name').notNull(),
    discountType: text('discount_type').notNull().$type<DiscountType>(),
    /** Percentage: 0-100. Fixed: PKR. Read with `lib/money.ts`. */
    discountValue: numeric('discount_value', { precision: 10, scale: 2 }).notNull(),
    /** Null = tuition only. */
    appliesToFeeTypeId: uuid('applies_to_fee_type_id').references(() => feeTypes.id, {
      onDelete: 'set null',
    }),
    validFrom: date('valid_from').notNull(),
    /** Null = indefinite. */
    validUntil: date('valid_until'),
    /** Firebase uid of the admin who granted it — concessions cost money. */
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
    check('student_concessions_discount_value_check', sql`${table.discountValue} >= 0`),
  ],
);

export type StudentConcession = typeof studentConcessions.$inferSelect;
export type NewStudentConcession = typeof studentConcessions.$inferInsert;

export function isDiscountType(value: unknown): value is DiscountType {
  return (
    typeof value === 'string' && (DISCOUNT_TYPES as readonly string[]).includes(value)
  );
}
