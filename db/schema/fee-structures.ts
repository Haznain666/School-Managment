import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { academicYears } from './academic-years';
import { feeTypes } from './fee-types';
import { grades } from './grades';
import { schools } from './schools';

/**
 * fee_structures — what one grade pays under one fee head, in one session.
 *
 * The three-part key is the point: fees differ by grade (Class 10 costs more
 * than Nursery) and change every year, and last year's challans must stay
 * explicable against last year's rates. Editing this year's amount therefore
 * cannot rewrite what was already billed — challans copy the amount onto their
 * own line items at generation time.
 *
 * A missing row means "this grade is not charged this head", which is why the
 * setup matrix leaves cells blank rather than defaulting them to zero.
 *
 * `amount` is NUMERIC and arrives in application code as a *string*. See
 * `lib/money.ts` — money never becomes a JS float here.
 */
export const feeStructures = pgTable(
  'fee_structures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    feeTypeId: uuid('fee_type_id')
      .notNull()
      .references(() => feeTypes.id, { onDelete: 'cascade' }),
    gradeId: uuid('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    /** PKR, exact. Read it with `lib/money.ts`, never with parseFloat. */
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('fee_structures_location_id_idx').on(table.locationId),
    index('fee_structures_grade_id_academic_year_id_idx').on(
      table.gradeId,
      table.academicYearId,
    ),
    // The upsert target for the setup matrix's "save all".
    uniqueIndex('fee_structures_type_grade_year_idx').on(
      table.feeTypeId,
      table.gradeId,
      table.academicYearId,
    ),
    check('fee_structures_amount_check', sql`${table.amount} >= 0`),
  ],
);

export type FeeStructure = typeof feeStructures.$inferSelect;
export type NewFeeStructure = typeof feeStructures.$inferInsert;
