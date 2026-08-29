import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { branches } from './branches';
import { schools } from './schools';

export const FEE_CATEGORIES = ['monthly', 'one_time', 'annual'] as const;
export type FeeCategory = (typeof FEE_CATEGORIES)[number];

export const FEE_CATEGORY_LABELS: Record<FeeCategory, string> = {
  monthly: 'Monthly',
  one_time: 'One time',
  annual: 'Annual',
};

/**
 * fee_types — the heads a school bills under, e.g. Tuition Fee, Transport.
 *
 * `fee_category` is what the challan generator reads: only `monthly` types are
 * picked up by a monthly challan run, while `one_time` (admission fee) and
 * `annual` (annual charges, exam fee) are billed deliberately. That split is
 * the whole reason the column exists — without it a school would be charged
 * their admission fee twelve times a year.
 *
 * Names are unique per school rather than globally: two schools both having a
 * "Tuition Fee" is the normal case.
 */
export const feeTypes = pgTable(
  'fee_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    /**
     * The campus that owns this fee head, or null when the school shares it.
     * See `lib/branch-scope.ts` for the read rule and `db/schema/subjects.ts`
     * for why it is nullable rather than backfilled.
     */
    branchId: uuid('branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description'),
    feeCategory: text('fee_category').notNull().$type<FeeCategory>(),
    isActive: boolean('is_active').notNull().default(true),
    /** Position on the challan and in the structure matrix. */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('fee_types_location_id_idx').on(table.locationId),
    index('fee_types_location_branch_idx').on(table.locationId, table.branchId),
    // Seeding upserts on this, so re-running it cannot duplicate a head.
    uniqueIndex('fee_types_location_id_name_idx').on(table.locationId, table.name),
    check(
      'fee_types_fee_category_check',
      sql`${table.feeCategory} IN ('monthly', 'one_time', 'annual')`,
    ),
  ],
);

export type FeeType = typeof feeTypes.$inferSelect;
export type NewFeeType = typeof feeTypes.$inferInsert;

export function isFeeCategory(value: unknown): value is FeeCategory {
  return (
    typeof value === 'string' && (FEE_CATEGORIES as readonly string[]).includes(value)
  );
}

/** The heads every Pakistani school bills under, seeded on first setup. */
export const DEFAULT_FEE_TYPES: ReadonlyArray<{
  name: string;
  feeCategory: FeeCategory;
  description: string;
  sortOrder: number;
}> = [
  {
    name: 'Tuition Fee',
    feeCategory: 'monthly',
    description: 'Charged every month for the class the student is enrolled in.',
    sortOrder: 1,
  },
  {
    name: 'Admission Fee',
    feeCategory: 'one_time',
    description: 'Charged once, when the student joins the school.',
    sortOrder: 2,
  },
  {
    name: 'Annual Charges',
    feeCategory: 'annual',
    description: 'Yearly maintenance and development charges.',
    sortOrder: 3,
  },
  {
    name: 'Library Fee',
    feeCategory: 'annual',
    description: 'Yearly library membership and book fund.',
    sortOrder: 4,
  },
  {
    name: 'Examination Fee',
    feeCategory: 'annual',
    description: 'Yearly charge for board and internal examinations.',
    sortOrder: 5,
  },
];
