import { integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { academicYears } from './academic-years';
import { schools } from './schools';

/**
 * school_id_sequences — the counter behind student IDs.
 *
 * One row per (school, academic year), so numbering restarts each session:
 * `GVS-2025-0001` and `GVS-2026-0001` are different children.
 *
 * The counter lives in a table rather than a Postgres sequence because it is
 * per-tenant-per-year: a real sequence would need one object created per school
 * per session, and could not be scoped by `location_id`. `lib/student-id.ts`
 * increments it with a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`,
 * which Postgres executes atomically — two concurrent enrolments take a row
 * lock and come out with different numbers.
 */
export const schoolIdSequences = pgTable(
  'school_id_sequences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GHL Location ID — the tenant key. */
    locationId: text('location_id')
      .notNull()
      .references(() => schools.locationId, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    /** Highest sequence number issued so far for this school and year. */
    lastSequence: integer('last_sequence').notNull().default(0),
  },
  (table) => [
    // The upsert target: this is what makes the increment atomic.
    uniqueIndex('school_id_sequences_location_id_academic_year_id_idx').on(
      table.locationId,
      table.academicYearId,
    ),
  ],
);

export type SchoolIdSequence = typeof schoolIdSequences.$inferSelect;
export type NewSchoolIdSequence = typeof schoolIdSequences.$inferInsert;
