import { index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';

import { feeTypes } from './fee-types';
import { studentConcessions } from './student-concessions';

/**
 * student_concession_fee_types — the heads one *grant* is narrowed to.
 *
 * The per-student twin of `concession_scheme_fee_types`, and it exists for the
 * same reason the grant freezes the rate: a scheme's head list may be edited in
 * March, and February's voucher must not be re-explained by it. When a scheme
 * is applied to a student, its heads are copied here.
 *
 * **No rows means every head, of every category** — the same rule, said in the
 * same place twice on purpose, because the two tables are read by one function
 * and a difference between them would be a difference nobody could see.
 *
 * ── `student_concessions.applies_to_fee_type_id` is not migrated away ────
 * Every grant written before Sprint 18 carries its single head in that column,
 * and there is no backfill. `listActiveConcessions` folds the legacy column
 * into the array on the way out, so one row with `applies_to_fee_type_id` set
 * and no rows here behaves exactly as it did yesterday. Rewriting history to
 * tidy a shape is how a school's oldest vouchers stop matching their own
 * explanations.
 */
export const studentConcessionFeeTypes = pgTable(
  'student_concession_fee_types',
  {
    studentConcessionId: uuid('student_concession_id')
      .notNull()
      .references(() => studentConcessions.id, { onDelete: 'cascade' }),
    feeTypeId: uuid('fee_type_id')
      .notNull()
      .references(() => feeTypes.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.studentConcessionId, table.feeTypeId] }),
    index('student_concession_fee_types_fee_type_id_idx').on(table.feeTypeId),
  ],
);
