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
 * fee_structures — what one grade pays under one fee head, in one year.
 *
 * This is the price list, and it is deliberately per (fee type, grade, year):
 * Class 1 and Class 10 do not pay the same tuition, and last year's rates must
 * survive this year's increase because old challans have to stay explainable.
 *
 * Amounts are NUMERIC, never floating point. Nothing in this application does
 * arithmetic on a float rupee — `lib/fee-calculator.ts` converts to integer
 * paise first.
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
    /** PKR. Stored exact; read as a string and converted to paise in JS. */
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
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
    // The matrix save upserts on this: one price per head per grade per year.
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
